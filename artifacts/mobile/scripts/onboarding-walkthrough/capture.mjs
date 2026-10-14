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
 *
 * Output: scripts/onboarding-walkthrough/output/<viewport>/<buyer|seller>/<NN-step>.png
 * Exit code is non-zero if any step fails to reach its expected screen/text.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildPreviewWeb, launchBrowser, serveBuild } from '../store-screenshots/harness.mjs';
import { clerkOnboardingStubScript } from './clerk-onboarding-stub.mjs';
import { createFakeOnboardingApi, installFakeBackend } from './fake-api.mjs';
import { ensureDemoImages } from '../store-screenshots/demo-images.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MOBILE_ROOT = path.resolve(HERE, '../..');
const BUILD_DIR = path.join(MOBILE_ROOT, '.onboarding-walkthrough', 'web-build');
const OUTPUT_DIR = path.join(HERE, 'output');
const DEMO_API = 'https://api.brandthread.test';

const VIEWPORTS = [
  { id: '393x852', width: 393, height: 852, isMobile: true },
  { id: '1440x900', width: 1440, height: 900, isMobile: false },
];

function parseArgs(argv) {
  const options = { skipBuild: false };
  for (const arg of argv) {
    if (arg === '--skip-build') options.skipBuild = true;
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
  // Let the 200ms step transition settle so no frame is caught mid-fade.
  await page.waitForTimeout(600);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
}

let demoImages = {};

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
  await installFakeBackend(context, { origin, apiOrigin: DEMO_API, api, images: demoImages });
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

/** Splash, then the Sign up screen with the role chosen and a birthday entered. */
async function openSignUp(page, origin, shot, role) {
  await page.goto(`${origin}/splash`);
  await page.getByTestId('splash').waitFor({ timeout: 20_000 });
  await shot('splash');
  await page.goto(`${origin}/onboarding`);
  await waitClerkLoaded(page);
  await page.getByTestId('onboarding-sign-up-email').waitFor({ timeout: 20_000 });
  await dismissCookieBanner(page);
  await page.getByTestId(`onboarding-account-type-${role}`).click();
  await shot('sign-up');
}

/** Email sheet + 6-digit code. */
async function signUpWithEmail(page, id, shot) {
  await page.getByTestId('onboarding-dob-input').fill('01/15/1995');
  await page.getByTestId('onboarding-sign-up-email').click();
  await page.getByLabel('Email', { exact: true }).waitFor({ timeout: 10_000 });
  await page.getByLabel('Email', { exact: true }).fill(id.email);
  await page.getByLabel('Password', { exact: true }).fill(id.password);
  await shot('sign-up-email');
  await page.getByTestId('onboarding-email-next').click();
  await page.getByText('Check your email').waitFor({ timeout: 10_000 });
  await page.getByLabel('Verification code').fill('000000');
  await shot('verify-email');
  await page.getByTestId('onboarding-verify').click();
}

async function fillProfile(page, id, shot, name) {
  await page.getByTestId('onboarding-first-name-input').waitFor({ timeout: 15_000 });
  await shot(`${name}-empty`);
  await page.getByTestId('onboarding-first-name-input').fill(`${id.firstName} ${id.lastName}`);
  await page.getByTestId('onboarding-username-input').fill(id.username);
  await page.getByText('is available', { exact: false }).waitFor({ timeout: 10_000 });
  await shot(name);
  await page.getByTestId('onboarding-next').click();
}

async function runBuyerWalkthrough(browser, { viewport, origin, outDir }) {
  const api = createFakeOnboardingApi({ apiOrigin: DEMO_API });
  const { context, page } = await openOnboardingContext(browser, { viewport, origin, api });
  const report = makeReport('buyer', viewport.id);
  const id = identity('buyer', viewport.id);
  let index = 0;
  const shot = (name) => screenshot(page, outDir, ++index, name);

  try {
    await report.step('splash and sign up', () => openSignUp(page, origin, shot, 'buyer'));
    await report.step('email sign-up and code', () => signUpWithEmail(page, id, shot));
    await report.step('profile: name + @username', () => fillProfile(page, id, shot, 'profile'));

    await report.step('curate your feed', async () => {
      await page.getByTestId('onboarding-brands').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(800);
      await shot('curate-feed');
      const follow = page.getByRole('button', { name: /^Follow / }).first();
      if (await follow.count()) {
        await follow.click();
        await page.waitForTimeout(300);
        await shot('curate-feed-following');
      }
      await page.getByTestId('onboarding-next').click();
    });

    await report.step('sizes', async () => {
      await page.getByTestId('onboarding-sizes').waitFor({ timeout: 10_000 });
      await shot('sizes-empty');
      await page.getByTestId('onboarding-size-tops-M').click();
      await page.getByTestId('onboarding-size-bottoms-32').click();
      await page.getByTestId('onboarding-size-shoes-10').click();
      await shot('sizes');
      await page.getByTestId('onboarding-next').click();
    });

    await report.step('notifications', async () => {
      await page.getByTestId('onboarding-notifications').waitFor({ timeout: 10_000 });
      await shot('notifications');
      await page.getByTestId('onboarding-notifications-continue').click();
    });

    await report.step('lands on the Threads feed', async () => {
      await page.waitForURL((url) => !url.pathname.startsWith('/onboarding'), { timeout: 20_000 });
      await page.waitForTimeout(2500);
      await dismissCookieBanner(page);
      await shot('landing');
    });

    await report.step('server-side data was actually saved', async () => {
      const user = api.getUser();
      if (!user) throw new Error('No /api/auth/sync call was ever recorded — no account was created.');
      if (user.accountType !== 'buyer') throw new Error(`Expected accountType "buyer", got ${JSON.stringify(user.accountType)}`);
      if (user.onboardingComplete !== true) throw new Error('Expected onboardingComplete to be true after finishing onboarding.');
      if (user.username !== id.username.toLowerCase()) throw new Error(`Expected username ${id.username}, got ${JSON.stringify(user.username)}`);
    });
  } finally {
    await context.close();
  }
  return report.rows;
}

async function runSellerWalkthrough(browser, { viewport, origin, outDir }) {
  const api = createFakeOnboardingApi({ apiOrigin: DEMO_API });
  const { context, page } = await openOnboardingContext(browser, { viewport, origin, api });
  const report = makeReport('seller', viewport.id);
  const id = identity('seller', viewport.id);
  let index = 0;
  const shot = (name) => screenshot(page, outDir, ++index, name);

  try {
    await report.step('splash and sign up', () => openSignUp(page, origin, shot, 'seller'));
    await report.step('email sign-up and code', () => signUpWithEmail(page, id, shot));
    await runSellerSteps(page, { id, shot, report, api });

    await report.step('server-side data was actually saved', async () => {
      const user = api.getUser();
      if (!user) throw new Error('No /api/auth/sync call was ever recorded — no account was created.');
      if (user.accountType !== 'seller') throw new Error(`Expected accountType "seller", got ${JSON.stringify(user.accountType)}`);
      if (user.onboardingComplete !== true) throw new Error('Expected onboardingComplete to be true after finishing onboarding.');
      if (user.brandName !== id.brandName) throw new Error(`Expected brandName to have been saved, got ${JSON.stringify(user.brandName)}`);
    });
  } finally {
    await context.close();
  }
  return report.rows;
}

/** Everything after the account exists, through landing on the dashboard. */
async function runSellerSteps(page, { id, shot, report }) {
  await report.step('profile: name + @username', () => fillProfile(page, id, shot, 'profile'));

  await report.step('store name', async () => {
    await page.getByTestId('onboarding-brand-name-input').waitFor({ timeout: 10_000 });
    await page.getByTestId('onboarding-brand-name-input').fill(id.brandName);
    await shot('store-name');
    await page.getByTestId('onboarding-next').click();
  });

  await report.step('notifications', async () => {
    await page.getByTestId('onboarding-notifications').waitFor({ timeout: 10_000 });
    await shot('notifications');
    await page.getByTestId('onboarding-notifications-continue').click();
  });

  await report.step('lands on seller dashboard', async () => {
    await page.waitForURL((url) => !url.pathname.startsWith('/onboarding'), { timeout: 20_000 });
    await page.waitForTimeout(2500);
    await dismissCookieBanner(page);
    await shot('seller-dashboard');
  });
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
  demoImages = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const allRows = [];
  let hadFailure = false;
  try {
    for (const viewport of VIEWPORTS) {
      console.log(`\n=== Viewport ${viewport.id} ===`);

      console.log(`-- buyer walkthrough --`);
      const buyerDir = path.join(OUTPUT_DIR, viewport.id, 'buyer');
      try {
        const rows = await runBuyerWalkthrough(browser, { viewport, origin: server.origin, outDir: buyerDir });
        allRows.push(...rows.map((r) => ({ ...r, viewport: viewport.id, role: 'buyer' })));
      } catch {
        hadFailure = true;
      }

      console.log(`-- seller walkthrough --`);
      const sellerDir = path.join(OUTPUT_DIR, viewport.id, 'seller');
      try {
        const rows = await runSellerWalkthrough(browser, { viewport, origin: server.origin, outDir: sellerDir });
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
