#!/usr/bin/env node
/**
 * End-to-end web walkthrough of account onboarding (buyer + seller), driven
 * against the REAL onboarding screen (app/onboarding.tsx) — no ?bt_preview or
 * dev bypass — with a mocked Clerk (clerk-onboarding-stub.mjs) and a mocked
 * API (fake-api.mjs). Both walkthroughs run at two viewport sizes and save a
 * screenshot after every major step.
 *
 *   pnpm --filter @workspace/mobile run walkthrough:onboarding
 *   node scripts/onboarding-walkthrough/capture.mjs           (from artifacts/mobile)
 *   node scripts/onboarding-walkthrough/capture.mjs --skip-build
 *   node scripts/onboarding-walkthrough/capture.mjs --skip-build --narrow --demo
 *     (--narrow: 390x844 only; --demo: seed brands to follow)
 *
 * Output: scripts/onboarding-walkthrough/output/<viewport>/<buyer|seller>/<NN-step>.png
 * Exit code is non-zero if any step fails to reach its expected screen/text.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildPreviewWeb, launchBrowser, serveBuild } from '../store-screenshots/harness.mjs';
import { clerkOnboardingStubScript } from './clerk-onboarding-stub.mjs';
import { createFakeOnboardingApi, installFakeBackend } from './fake-api.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MOBILE_ROOT = path.resolve(HERE, '../..');
const BUILD_DIR = path.join(MOBILE_ROOT, '.onboarding-walkthrough', 'web-build');
const OUTPUT_DIR = path.join(HERE, 'output');
const DEMO_API = 'https://api.brandthread.test';

const VIEWPORTS = [
  { id: '390x844', width: 390, height: 844, isMobile: true },
  { id: '1440x900', width: 1440, height: 900, isMobile: false },
];

function parseArgs(argv) {
  const options = { skipBuild: false, demo: false, narrowOnly: false };
  for (const arg of argv) {
    if (arg === '--skip-build') options.skipBuild = true;
    else if (arg === '--demo') options.demo = true;
    else if (arg === '--narrow') options.narrowOnly = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

/** Results collector: prints a pass/fail line per step and tracks failures. */
function makeReport(role, viewportId) {
  const rows = [];
  return {
    rows,
    async step(name, fn) {
      const label = `[${viewportId}] ${role} · ${name}`;
      try {
        await fn();
        console.log(`  ✓ ${label}`);
        rows.push({ name, ok: true });
      } catch (error) {
        const message = String(error?.message ?? error).split('\n')[0];
        console.log(`  ✗ ${label} — ${message}`);
        rows.push({ name, ok: false, message });
        throw error;
      }
    },
  };
}

async function screenshot(page, dir, index, name) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(index).padStart(2, '0')}-${name}.png`);
  // Let the 230ms step transition finish so the shot isn't mid-fade.
  await page.waitForTimeout(450);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
}

async function openOnboardingContext(browser, { viewport, origin, api }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    locale: 'en-US',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  await context.addInitScript(clerkOnboardingStubScript());
  await installFakeBackend(context, { origin, apiOrigin: DEMO_API, api });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  return { context, page };
}

async function dismissCookieBanner(page) {
  const button = page.getByText('Necessary only', { exact: true });
  try {
    await button.waitFor({ timeout: 3_000 });
    await button.click();
  } catch {
    // Not shown (already dismissed, or suppressed) — nothing to do.
  }
}

async function waitClerkLoaded(page) {
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
}

/** Unique-per-run identity so the buyer and seller runs never collide. */
function identity(role, viewportId) {
  const tag = `${role}-${viewportId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    email: `${tag}@onboarding-walkthrough.test`,
    password: 'Walkthrough!Pass1',
    username: `wt_${tag}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 28),
    firstName: role === 'seller' ? 'Sasha' : 'Bailey',
    lastName: 'Rivera',
    brandName: 'Noir Field Studio',
  };
}

/** The account steps shared by both paths (Instagram's sign-up). */
async function accountSteps(page, report, shot, id, { seller }) {
  await report.step('email', async () => {
    await page.getByTestId('onboarding-email-input').waitFor({ timeout: 10_000 });
    await shot('email-empty');
    await page.getByTestId('onboarding-email-input').fill(id.email.split('@')[0]);
    await page.getByTestId('onboarding-email-domains').waitFor({ timeout: 5_000 });
    await shot('email-domain-chips');
    await page.getByTestId('onboarding-email-input').fill(id.email);
    await page.getByTestId('onboarding-email-next').click();
  });

  await report.step('confirmation code', async () => {
    await page.getByTestId('onboarding-code-input').waitFor({ timeout: 10_000 });
    await page.getByTestId('onboarding-code-input').fill('000000');
    await shot('code');
    await page.getByTestId('onboarding-code-next').click();
  });

  await report.step('password', async () => {
    await page.getByTestId('onboarding-password-input').waitFor({ timeout: 10_000 });
    await page.getByTestId('onboarding-password-input').fill(id.password);
    await shot('password');
    await page.getByTestId('onboarding-password-next').click();
  });

  await report.step('birthday (age gate blocks a child, then passes)', async () => {
    await page.getByTestId('onboarding-birthday-wheel').waitFor({ timeout: 10_000 });
    await shot('birthday-today');
    await page.getByTestId('onboarding-birthday-next').click();
    await page.getByTestId('onboarding-step-error').waitFor({ timeout: 5_000 });
    // Scroll the year wheel back ~30 years (36pt rows) and let it settle.
    const year = page.getByTestId('onboarding-birthday-year');
    const box = await year.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -36 * 30);
    await page.waitForTimeout(600);
    await shot(seller ? 'birthday-adult' : 'birthday-set');
    await page.getByTestId('onboarding-birthday-next').click();
  });

  await report.step('terms', async () => {
    await page.getByTestId('onboarding-terms-agree').waitFor({ timeout: 10_000 });
    await shot('terms');
    await page.getByTestId('onboarding-terms-agree').click();
  });

  await report.step('name (account now exists)', async () => {
    await page.getByTestId('onboarding-first-name-input').waitFor({ timeout: 20_000 });
    await shot('name-empty');
    await page.getByTestId('onboarding-first-name-input').fill(`${id.firstName} ${id.lastName}`);
    await page.getByTestId('onboarding-name-next').click();
  });
}

async function runBuyerWalkthrough(browser, { viewport, origin, outDir, demo }) {
  const api = createFakeOnboardingApi({ demo });
  const { context, page } = await openOnboardingContext(browser, { viewport, origin, api });
  const report = makeReport('buyer', viewport.id);
  const id = identity('buyer', viewport.id);
  let index = 0;
  const shot = (name) => screenshot(page, outDir, ++index, name);

  try {
    await report.step('welcome screen loads', async () => {
      await page.goto(`${origin}/onboarding`);
      await waitClerkLoaded(page);
      await page.getByTestId('onboarding-welcome-get-started').waitFor({ timeout: 20_000 });
      await dismissCookieBanner(page);
      await shot('welcome');
    });

    await report.step('choose buyer account type', async () => {
      await page.getByTestId('onboarding-welcome-get-started').click();
      await page.getByTestId('onboarding-account-type-buyer').waitFor({ timeout: 10_000 });
      await shot('account-type');
      await page.getByTestId('onboarding-account-type-buyer').click();
      await shot('account-type-selected');
      await page.getByTestId('onboarding-account-type-continue').click();
    });

    await accountSteps(page, report, shot, id, { seller: false });

    await report.step('username (suggested, available)', async () => {
      await page.getByTestId('onboarding-username-input').waitFor({ timeout: 10_000 });
      await page.getByTestId('onboarding-username-available').waitFor({ timeout: 10_000 });
      await shot('username');
      await page.getByTestId('onboarding-username-input').fill(id.username);
      await page.getByTestId('onboarding-username-available').waitFor({ timeout: 10_000 });
      await page.getByTestId('onboarding-username-next').click();
    });

    await report.step('profile picture (skip)', async () => {
      await page.getByTestId('onboarding-photo-skip').waitFor({ timeout: 15_000 });
      await shot('photo');
      await page.getByTestId('onboarding-photo-skip').click();
    });

    await report.step('welcome, @username', async () => {
      await page.getByTestId('onboarding-welcome-user').waitFor({ timeout: 10_000 });
      await shot('welcome-user');
    });

    await report.step('pick styles', async () => {
      await page.getByTestId('onboarding-style-step').waitFor({ timeout: 10_000 });
      await page.getByTestId('onboarding-style-streetwear').click();
      await shot('styles');
      await page.getByTestId('onboarding-style-next').click();
    });

    await report.step('sizes', async () => {
      await page.getByTestId('onboarding-sizes-step').waitFor({ timeout: 10_000 });
      await shot('sizes-empty');
      await page.getByTestId('onboarding-sizes-skip').click();
    });

    await report.step('brands to follow', async () => {
      await page.getByTestId('onboarding-brands-step').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(800);
      if (demo) {
        await page.locator('[data-testid^="onboarding-brand-card-"]').first().click();
        await page.waitForTimeout(400);
      }
      await shot('brands-to-follow');
      await page.getByTestId(demo ? 'onboarding-brands-next' : 'onboarding-brands-skip').click();
    });

    await report.step('lands on thread explainer', async () => {
      await page.getByText('Enter the Thread', { exact: false }).waitFor({ timeout: 20_000 });
      await shot('thread-explainer');
    });

    await report.step('server-side data was actually saved', async () => {
      const user = api.getUser();
      if (!user) throw new Error('No /api/auth/sync call was ever recorded — no account was created.');
      if (user.accountType !== 'buyer') throw new Error(`Expected accountType "buyer", got ${JSON.stringify(user.accountType)}`);
      if (user.onboardingComplete !== true) throw new Error('Expected onboardingComplete to be true after finishing onboarding.');
      if (user.username !== id.username.toLowerCase()) throw new Error(`Expected username ${id.username}, got ${JSON.stringify(user.username)}`);
      if (!api.getCalls().some((c) => c.pathname.endsWith('/auth/age'))) throw new Error('Expected the birthday to be sent to /api/auth/age.');
    });

    // Dev P0: "Create an account" while a session is still on the device, then
    // the email that really exists vs. a brand-new one.
    await report.step('create another account: taken email shows "Switch to it", a new one goes to the code', async () => {
      await page.goto(`${origin}/onboarding?start=account-type`);
      await waitClerkLoaded(page);
      await page.getByTestId('onboarding-account-type-buyer').waitFor({ timeout: 20_000 });
      await page.getByTestId('onboarding-account-type-buyer').click();
      await page.getByTestId('onboarding-account-type-continue').click();
      await page.getByTestId('onboarding-email-input').waitFor({ timeout: 10_000 });
      await page.getByTestId('onboarding-email-input').fill(id.email);
      await page.getByTestId('onboarding-email-next').click();
      await page.getByTestId('onboarding-email-switch').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(450);
      await shot('email-already-has-account');
      await page.getByTestId('onboarding-email-use-different').click();
      await page.getByTestId('onboarding-email-input').fill(`new-${id.email}`);
      await page.getByTestId('onboarding-email-next').click();
      await page.getByTestId('onboarding-code-input').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(450);
      await shot('new-email-goes-to-code');
    });
  } finally {
    await context.close();
  }
  return report.rows;
}

async function runSellerWalkthrough(browser, { viewport, origin, outDir, demo }) {
  const api = createFakeOnboardingApi({ demo });
  const { context, page } = await openOnboardingContext(browser, { viewport, origin, api });
  const report = makeReport('seller', viewport.id);
  const id = identity('seller', viewport.id);
  let index = 0;
  const shot = (name) => screenshot(page, outDir, ++index, name);

  try {
    await report.step('welcome screen loads', async () => {
      await page.goto(`${origin}/onboarding`);
      await waitClerkLoaded(page);
      await page.getByTestId('onboarding-welcome-get-started').waitFor({ timeout: 20_000 });
      await dismissCookieBanner(page);
      await shot('welcome');
    });

    await report.step('choose seller account type', async () => {
      await page.getByTestId('onboarding-welcome-get-started').click();
      await page.getByTestId('onboarding-account-type-seller').waitFor({ timeout: 10_000 });
      await page.getByTestId('onboarding-account-type-seller').click();
      await shot('account-type-selected');
      await page.getByTestId('onboarding-account-type-continue').click();
    });

    await report.step('brand stage question', async () => {
      await page.getByTestId('onboarding-stage-step').waitFor({ timeout: 10_000 });
      await shot('stage-empty');
      await page.getByTestId('onboarding-choice-build').click();
      await shot('stage-selected');
      await page.getByTestId('onboarding-question-next').click();
    });

    await report.step('goals question', async () => {
      await page.getByTestId('onboarding-goals-step').waitFor({ timeout: 10_000 });
      await page.getByTestId('onboarding-choice-find-manufacturers').click();
      await page.getByTestId('onboarding-choice-launch-my-store').click();
      await shot('goals');
      await page.getByTestId('onboarding-question-next').click();
    });

    await report.step('location', async () => {
      await page.getByTestId('onboarding-location-step').waitFor({ timeout: 10_000 });
      await shot('location');
      await page.getByTestId('onboarding-question-next').click();
    });

    await accountSteps(page, report, shot, id, { seller: true });

    await report.step('brand name', async () => {
      await page.getByTestId('onboarding-brand-name-input').waitFor({ timeout: 10_000 });
      await page.getByTestId('onboarding-brand-name-input').fill(id.brandName);
      await shot('brand-name');
      await page.getByTestId('onboarding-brand-name-next').click();
    });

    await report.step('username (suggested from brand)', async () => {
      await page.getByTestId('onboarding-username-available').waitFor({ timeout: 10_000 });
      await shot('username');
      await page.getByTestId('onboarding-username-next').click();
    });

    await report.step('building your store', async () => {
      await page.getByTestId('onboarding-store-preview').waitFor({ timeout: 15_000 });
      await page.getByTestId('onboarding-building-done').waitFor({ timeout: 15_000 });
      await shot('store-ready');
      await page.getByTestId('onboarding-generate-sample').click();
      await page.getByTestId('onboarding-generate-sample').waitFor({ state: 'detached', timeout: 15_000 });
      await shot('store-ready-with-logo');
      await page.getByTestId('onboarding-building-done').click();
    });

    await report.step('lands on seller dashboard', async () => {
      await page.waitForURL(/\/\(tabs\)|\/$/, { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await shot('seller-dashboard');
    });

    await report.step('server-side data was actually saved', async () => {
      const user = api.getUser();
      if (!user) throw new Error('No /api/auth/sync call was ever recorded — no account was created.');
      if (user.accountType !== 'seller') throw new Error(`Expected accountType "seller", got ${JSON.stringify(user.accountType)}`);
      if (user.onboardingComplete !== true) throw new Error('Expected onboardingComplete to be true after finishing onboarding.');
      if (user.brandName !== id.brandName) throw new Error(`Expected brandName to have been saved, got ${JSON.stringify(user.brandName)}`);
      if (!user.goals || !user.goals.includes('Find manufacturers')) throw new Error('Expected the chosen goals to have been saved via /api/seller/onboarding/data.');
      if (user.brandStage !== 'build') throw new Error(`Expected brandStage "build", got ${JSON.stringify(user.brandStage)}`);
      if (!user.username) throw new Error('Expected a username to have been saved.');
      if (!user.shipFromCountry) throw new Error('Expected the business location to have been saved as the ship-from country.');
    });
  } finally {
    await context.close();
  }
  return report.rows;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  rmSync(OUTPUT_DIR, { recursive: true, force: true });

  if (!options.skipBuild || !existsSync(path.join(BUILD_DIR, 'index.html'))) {
    console.log('Building the web app (a few minutes)…');
    buildPreviewWeb(BUILD_DIR);
  }

  const server = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const allRows = [];
  let hadFailure = false;
  try {
    for (const viewport of options.narrowOnly ? VIEWPORTS.slice(0, 1) : VIEWPORTS) {
      console.log(`\n=== Viewport ${viewport.id} ===`);

      console.log(`-- buyer walkthrough --`);
      const buyerDir = path.join(OUTPUT_DIR, viewport.id, 'buyer');
      try {
        const rows = await runBuyerWalkthrough(browser, { viewport, origin: server.origin, outDir: buyerDir, demo: options.demo });
        allRows.push(...rows.map((r) => ({ ...r, viewport: viewport.id, role: 'buyer' })));
      } catch {
        hadFailure = true;
      }

      console.log(`-- seller walkthrough --`);
      const sellerDir = path.join(OUTPUT_DIR, viewport.id, 'seller');
      try {
        const rows = await runSellerWalkthrough(browser, { viewport, origin: server.origin, outDir: sellerDir, demo: options.demo });
        allRows.push(...rows.map((r) => ({ ...r, viewport: viewport.id, role: 'seller' })));
      } catch {
        hadFailure = true;
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  const passed = allRows.filter((r) => r.ok).length;
  const failed = allRows.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Onboarding walkthrough: ${passed}/${allRows.length} steps passed.`);
  if (failed.length) {
    console.log('Failed steps:');
    for (const row of failed) console.log(`  - [${row.viewport}] ${row.role} · ${row.name}: ${row.message}`);
  }
  console.log(`Screenshots: ${path.relative(process.cwd(), OUTPUT_DIR) || '.'}/`);

  if (hadFailure || failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n✖ ${error.stack || error.message}`);
  process.exit(1);
});
