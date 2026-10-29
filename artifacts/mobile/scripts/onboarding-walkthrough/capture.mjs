#!/usr/bin/env node
/**
 * End-to-end web walkthrough of account onboarding (buyer + seller), driven
 * against the REAL onboarding screen (app/onboarding.tsx) — no ?bt_preview or
 * dev bypass — with a mocked Clerk (clerk-onboarding-stub.mjs) and a mocked
 * API (fake-api.mjs). Both walkthroughs run at 390x844 and save a
 * screenshot after every step at 390x844 (launch QA rule).
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

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MOBILE_ROOT = path.resolve(HERE, '../..');
const BUILD_DIR = path.join(MOBILE_ROOT, '.onboarding-walkthrough', 'web-build');
const OUTPUT_DIR = path.join(HERE, 'output');
const DEMO_API = 'https://api.brandthread.test';

// Launch QA rule: hands-on at 390x844 only.
const VIEWPORTS = [
  { id: '390x844', width: 390, height: 844, isMobile: true },
];

function parseArgs(argv) {
  const options = { skipBuild: false, role: null };
  for (const arg of argv) {
    if (arg === '--skip-build') options.skipBuild = true;
    else if (arg === '--role=buyer' || arg === '--role=seller') options.role = arg.slice(7);
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
        error.walkthroughRows = [...rows];
        throw error;
      }
    },
  };
}

async function screenshot(page, dir, index, name) {
  mkdirSync(dir, { recursive: true });
  // Let the step slide / fade settle so the frame shows the screen, not the transition.
  await page.waitForTimeout(800);
  const file = path.join(dir, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
}

/** Hold touch down long enough to assert real rendered scale feedback. */
async function pressWithFeedback(page, testId) {
  const button = page.getByTestId(testId);
  await button.click({ trial: true });
  const box = await button.boundingBox();
  if (!box) throw new Error(`No touch target: ${testId}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await page.waitForFunction((element) => {
      for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
        const transform = getComputedStyle(node).transform;
        if (transform !== 'none' && new DOMMatrixReadOnly(transform).a < 0.985) return true;
      }
      return false;
    }, await button.elementHandle(), { timeout: 2_000 });
    console.log(`    press-in scale verified: ${testId}`);
  } finally {
    await page.mouse.up();
  }
}

async function openOnboardingContext(browser, { viewport, origin, api, requireName = false }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    locale: 'en-US',
    colorScheme: 'dark',
    // Exercise the real spring/press behavior, not just static end states.
    reducedMotion: 'no-preference',
  });
  // Preview builds default a fresh browser to the demo seller; this run is a
  // real signed-out person, so pin the explicit guest marker (lib/devPreview).
  await context.addInitScript(() => localStorage.setItem('bt:previewRole:seller-review-v2', 'guest'));
  if (requireName) await context.addInitScript(() => { window.__btRequireName = true; });
  await context.addInitScript(clerkOnboardingStubScript());
  await installFakeBackend(context, { origin, apiOrigin: DEMO_API, api });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`    (browser error: ${message.text().slice(0, 500)})`);
  });
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

/** Welcome → birthday → email → code: the shared sign-up every run starts with. */
async function signUp(page, id, shot, report, { requireName = false } = {}) {
  await report.step('welcome (TikTok sign up)', async () => {
    await page.getByTestId('onboarding-welcome').waitFor({ timeout: 20_000 });
    await dismissCookieBanner(page);
    await shot('welcome');
    await page.getByTestId('onboarding-toggle-mode').click();
    await page.getByText('Log in to', { exact: false }).waitFor({ timeout: 5_000 });
    await shot('welcome-login');
    await page.getByTestId('onboarding-toggle-mode').click();
    await pressWithFeedback(page, 'onboarding-use-email');
  });

  await report.step('birthday (TikTok) with under-13 error', async () => {
    await page.getByTestId('onboarding-dob').waitFor({ timeout: 10_000 });
    await shot('birthday');
    await page.getByTestId('onboarding-dob').fill('01012020');
    await pressWithFeedback(page, 'onboarding-dob-continue');
    await page.getByTestId('onboarding-dob-error').waitFor({ timeout: 5_000 });
    await shot('birthday-error');
    await page.getByTestId('onboarding-dob').fill('');
    await page.getByTestId('onboarding-dob').fill('01152000');
    await page.getByTestId('onboarding-dob-continue').click();
  });

  await report.step('email (Depop sign up or log in)', async () => {
    await page.getByTestId('onboarding-email-input').waitFor({ timeout: 10_000 });
    await page.getByTestId('onboarding-email-input').fill(id.email);
    await shot('email');
    await pressWithFeedback(page, 'onboarding-email-continue');
  });

  await report.step('code with wrong-code error', async () => {
    await page.getByTestId('onboarding-code').waitFor({ timeout: 10_000 });
    const input = page.getByTestId('onboarding-code-input').locator('input');
    await input.fill('123456');
    await page.getByTestId('onboarding-code-error').waitFor({ timeout: 5_000 });
    await shot('code-error');
    await input.fill('');
  });

  await report.step('code: back and "Wrong email? Edit" both return to the editable email', async () => {
    await liveBack(page);
    await page.getByTestId('onboarding-email').waitFor({ timeout: 5_000 });
    await expectValue(page, 'onboarding-email-input', id.email);
    await shot('code-back-to-email');
    await page.getByTestId('onboarding-email-continue').click();
    await page.getByTestId('onboarding-code').waitFor({ timeout: 10_000 });
    await page.getByTestId('onboarding-code-edit-email').click();
    await page.getByTestId('onboarding-email').waitFor({ timeout: 5_000 });
    await expectValue(page, 'onboarding-email-input', id.email);
    await shot('code-edit-email');
    await page.getByTestId('onboarding-email-continue').click();
    await page.getByTestId('onboarding-code').waitFor({ timeout: 10_000 });
  });

  await report.step('reload on the code step resumes it (birthday + email kept)', async () => {
    await page.waitForTimeout(500); // debounced draft save
    await page.reload();
    await page.getByTestId('onboarding-code').waitFor({ timeout: 20_000 });
    await page.getByText(id.email, { exact: false }).waitFor({ timeout: 5_000 });
    await shot('code-after-reload');
    await page.getByTestId('onboarding-code-input').locator('input').fill('000000');
  });

  if (requireName) {
    await report.step('name (Clerk requires it): typed once, survives a reload', async () => {
      await page.getByTestId('onboarding-details').waitFor({ timeout: 15_000 });
      await page.getByTestId('onboarding-first-name').fill(id.firstName);
      await page.getByTestId('onboarding-last-name').fill(id.lastName);
      await shot('details-name');
      await page.waitForTimeout(500);
      await page.reload();
      // The code isn't stored, so a new one is sent; nothing typed is asked again.
      await page.getByTestId('onboarding-email').waitFor({ timeout: 20_000 });
      await expectValue(page, 'onboarding-email-input', id.email);
      await page.getByTestId('onboarding-email-continue').click();
      await page.getByTestId('onboarding-code').waitFor({ timeout: 10_000 });
      await page.getByTestId('onboarding-code-input').locator('input').fill('000000');
      await page.getByTestId('onboarding-details').waitFor({ timeout: 15_000 });
      await expectValue(page, 'onboarding-first-name', id.firstName);
      await expectValue(page, 'onboarding-last-name', id.lastName);
      await shot('details-after-reload-prefilled');
      await page.getByTestId('onboarding-details-continue').click();
    });
  }

  await report.step('username (Depop) with taken + available', async () => {
    await page.getByTestId('onboarding-username').waitFor({ timeout: 15_000 });
    await shot('username-empty');
    await page.getByTestId('onboarding-username-input').fill('taken');
    await page.getByTestId('onboarding-username-error').waitFor({ timeout: 5_000 });
    await shot('username-taken');
    await page.getByTestId('onboarding-username-input').fill(id.username);
    await page.getByText('is available', { exact: false }).waitFor({ timeout: 5_000 });
    await shot('username-available');
    await pressWithFeedback(page, 'onboarding-username-continue');
  });

  await report.step('reload after verification keeps the username', async () => {
    await page.getByTestId('onboarding-photo').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await page.reload();
    await page.getByTestId('onboarding-photo').waitFor({ timeout: 20_000 });
    await liveBack(page);
    await page.getByTestId('onboarding-username').waitFor({ timeout: 5_000 });
    await expectValue(page, 'onboarding-username-input', id.username);
    await shot('username-after-reload');
    await page.getByText('is available', { exact: false }).waitFor({ timeout: 5_000 });
    await page.getByTestId('onboarding-username-continue').click();
  });
}

/** The live header back (the outgoing layer stays mounted briefly, aria-hidden). */
async function liveBack(page) {
  await page.getByRole('button', { name: 'Back', exact: true }).click();
}

async function expectValue(page, testId, expected) {
  const field = page.getByTestId(testId);
  const input = (await field.evaluate((el) => el.tagName)) === 'INPUT' ? field : field.locator('input');
  const value = await input.first().inputValue();
  if (value !== expected) throw new Error(`${testId} = ${JSON.stringify(value)}, expected ${JSON.stringify(expected)}`);
}

/** Proves the birthday typed before verification reached /auth/age (it survived both reloads). */
function expectAgeSent(api) {
  const user = api.getUser();
  if (user?.ageBand !== '18_plus') throw new Error(`birthday never reached /auth/age: ${JSON.stringify(user)}`);
}

async function runBuyerWalkthrough(browser, { viewport, origin, outDir }) {
  const api = createFakeOnboardingApi();
  const { context, page } = await openOnboardingContext(browser, { viewport, origin, api, requireName: true });
  const report = makeReport('buyer', viewport.id);
  const id = identity('buyer', viewport.id);
  let index = 0;
  const shot = (name) => screenshot(page, outDir, ++index, name);

  try {
    await page.goto(`${origin}/onboarding`);
    await waitClerkLoaded(page);
    await signUp(page, id, shot, report, { requireName: true });

    await report.step('photo (Instagram): add, then continue', async () => {
      await page.getByTestId('onboarding-photo').waitFor({ timeout: 10_000 });
      await shot('photo');
      const chooser = page.waitForEvent('filechooser');
      await pressWithFeedback(page, 'onboarding-photo-add');
      await (await chooser).setFiles(path.join(MOBILE_ROOT, 'assets/images/products/leather-ankle-boots.jpg'));
      await page.getByTestId('onboarding-photo-preview').waitFor({ timeout: 10_000 });
      await shot('photo-picked');
      await page.getByTestId('onboarding-photo-continue').click();
    });

    await report.step('interest (Depop): pick a department', async () => {
      await page.getByTestId('onboarding-interest').waitFor({ timeout: 10_000 });
      await shot('interest');
      await pressWithFeedback(page, 'onboarding-interest-Womenswear');
    });

    await report.step('brands (Depop): search, pick, follow', async () => {
      await page.getByTestId('onboarding-brands').waitFor({ timeout: 10_000 });
      await page.getByText('Fixture Brand A').waitFor({ timeout: 10_000 });
      await shot('brands');
      await pressWithFeedback(page, 'onboarding-brand-seller_fixture_0');
      await page.getByTestId('onboarding-brand-seller_fixture_3').click();
      await page.getByTestId('onboarding-brands-search').fill('atelier');
      await shot('brands-picked-search');
      await page.getByTestId('onboarding-brands-search').fill('');
      await page.getByTestId('onboarding-brands-next').click();
    });

    await report.step('sizes (Depop): open the picker sheet, pick', async () => {
      await page.getByTestId('onboarding-sizes').waitFor({ timeout: 10_000 });
      await shot('sizes');
      await page.getByTestId('onboarding-size-tops').click();
      await page.getByTestId('onboarding-size-tops-M').waitFor({ timeout: 5_000 });
      await shot('sizes-sheet');
      await pressWithFeedback(page, 'onboarding-size-tops-M');
      await page.getByTestId('onboarding-size-shoes').click();
      await page.getByTestId('onboarding-size-shoes-9').click();
      await shot('sizes-picked');
      await page.getByTestId('onboarding-sizes-ok').click();
    });

    await report.step('notifications: web shows one honest Continue', async () => {
      await page.getByTestId('onboarding-notifications').waitFor({ timeout: 10_000 });
      await page.getByText('Get alerts in the app', { exact: true }).waitFor({ timeout: 5_000 });
      if (await page.getByTestId('onboarding-notifications-skip').count()) throw new Error('web shows a second, meaningless button');
      await shot('notifications');
      await page.getByTestId('onboarding-notifications-continue').click();
    });

    await report.step('Shop or Sell has a working back control', async () => {
      await page.getByTestId('onboarding-role').waitFor({ timeout: 10_000 });
      await shot('role');
      await liveBack(page);
      await page.getByTestId('onboarding-notifications').waitFor({ timeout: 5_000 });
      await shot('role-back-to-notifications');
      await page.getByTestId('onboarding-notifications-continue').click();
    });

    await report.step('Shop or Sell (Etsy) → finish as buyer', async () => {
      await page.getByTestId('onboarding-role').waitFor({ timeout: 10_000 });
      await pressWithFeedback(page, 'account-type-buyer');
      await shot('role-shop');
      await page.getByTestId('onboarding-role-continue').click();
      await page.waitForURL(/thread-explainer/, { timeout: 20_000 });
      const user = api.getUser();
      if (!user?.onboardingComplete || user.accountType !== 'buyer' || user.username !== id.username) {
        throw new Error(`server row not completed as buyer: ${JSON.stringify(user)}`);
      }
      if (JSON.stringify(user.styleInterests) !== '["Womenswear"]') throw new Error(`department not saved: ${JSON.stringify(user.styleInterests)}`);
      if (user.name !== `${id.firstName} ${id.lastName}`) throw new Error(`name typed before the reload was lost: ${JSON.stringify(user.name)}`);
      expectAgeSent(api);
    });

    await report.step('one welcome headline for buyers (the explainer)', async () => {
      await page.getByRole('button', { name: 'Enter the Thread' }).waitFor({ timeout: 10_000 });
      await page.waitForTimeout(700); // explainer fade-in
      const welcomes = await page.getByText(/Welcome to/).count();
      if (welcomes !== 1) throw new Error(`expected one welcome headline, saw ${welcomes}`);
      await shot('landing');
    });
  } finally {
    await context.close();
  }
  return report.rows;
}

async function runSellerWalkthrough(browser, { viewport, origin, outDir }) {
  const api = createFakeOnboardingApi();
  const { context, page } = await openOnboardingContext(browser, { viewport, origin, api });
  const report = makeReport('seller', viewport.id);
  const id = identity('seller', viewport.id);
  let index = 0;
  const shot = (name) => screenshot(page, outDir, ++index, name);

  try {
    await page.goto(`${origin}/onboarding`);
    await waitClerkLoaded(page);
    await signUp(page, id, shot, report);

    await report.step('skip every optional step', async () => {
      await page.getByTestId('onboarding-photo-skip').click();
      await page.getByTestId('onboarding-interest-skip').click();
      await page.getByTestId('onboarding-brands-skip').click();
      await page.getByTestId('onboarding-sizes-skip').click();
      // Web has one Continue here (nothing to turn on or decline in a browser).
      await page.getByTestId('onboarding-notifications-continue').click();
    });

    await report.step('Shop or Sell: back walks back one step', async () => {
      await page.getByTestId('onboarding-role').waitFor({ timeout: 10_000 });
      await liveBack(page);
      await page.getByTestId('onboarding-notifications').waitFor({ timeout: 5_000 });
      await page.getByTestId('onboarding-notifications-continue').click();
    });

    await report.step('Sell → store name (Depop Start selling)', async () => {
      await pressWithFeedback(page, 'account-type-seller');
      await shot('role-sell');
      await page.getByTestId('onboarding-role-continue').click();
      await page.getByTestId('onboarding-store').waitFor({ timeout: 10_000 });
      await shot('store');
      await liveBack(page);
      await page.getByTestId('onboarding-role').waitFor({ timeout: 5_000 });
      await shot('store-back-to-role');
      await page.getByTestId('onboarding-role-continue').click();
      await page.getByTestId('onboarding-store').waitFor({ timeout: 10_000 });
      await page.getByTestId('onboarding-store-name').fill(id.brandName);
      await page.getByTestId('onboarding-store-continue').click();
    });

    await report.step('brand stage → store is open', async () => {
      await page.getByTestId('onboarding-stage').waitFor({ timeout: 10_000 });
      await page.getByTestId('onboarding-stage-build').click();
      await shot('stage');
      await page.getByTestId('onboarding-stage-continue').click();
      try {
        // The seller shell can open the existing setup checklist on Dashboard
        // instead of leaving the legacy store-brand route in the address bar.
        await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/store-setup-brand', { timeout: 20_000 });
        if (new URL(page.url()).pathname === '/') {
          await page.getByText('Dashboard', { exact: true }).locator('visible=true').first().waitFor({ timeout: 10_000 });
        }
      } catch (error) {
        console.log('Seller finish diagnostic:', JSON.stringify({ url: page.url(), user: api.getUser(), screen: (await page.locator('body').innerText()).slice(-1800) }));
        await shot('finish-error');
        throw error;
      }
      const user = api.getUser();
      if (!user?.onboardingComplete || user.accountType !== 'seller' || user.brandName !== id.brandName || user.brandStage !== 'build') {
        throw new Error(`server row not completed as seller: ${JSON.stringify(user)}`);
      }
      expectAgeSent(api);
      await shot('store-setup');
    });
  } finally {
    await context.close();
  }
  return report.rows;
}

/** Welcome → Log in carries an email typed earlier in the attempt to sign-in, prefilled. */
async function runLoginHandoff(browser, { viewport, origin, outDir }) {
  const api = createFakeOnboardingApi();
  const { context, page } = await openOnboardingContext(browser, { viewport, origin, api });
  const report = makeReport('log-in handoff', viewport.id);
  const email = 'returning@onboarding-walkthrough.test';
  let index = 0;
  const shot = (name) => screenshot(page, outDir, ++index, name);
  try {
    await page.goto(`${origin}/onboarding`);
    await waitClerkLoaded(page);
    await report.step('email typed, then Log in → sign-in prefilled', async () => {
      await page.getByTestId('onboarding-welcome').waitFor({ timeout: 20_000 });
      await dismissCookieBanner(page);
      await page.getByTestId('onboarding-use-email').click();
      await page.getByTestId('onboarding-dob').fill('01152000');
      await page.getByTestId('onboarding-dob-continue').click();
      await page.getByTestId('onboarding-email-input').fill(email);
      await liveBack(page);
      await page.getByTestId('onboarding-birthday').waitFor({ timeout: 5_000 });
      await liveBack(page);
      await page.getByTestId('onboarding-welcome').waitFor({ timeout: 5_000 });
      await page.getByTestId('onboarding-toggle-mode').click();
      await page.getByText('Log in to', { exact: false }).waitFor({ timeout: 5_000 });
      await page.getByTestId('onboarding-use-email').click();
      await page.waitForURL(/\/sign-in\?email=/, { timeout: 10_000 });
      await page.getByTestId('release-check-email').waitFor({ timeout: 10_000 });
      await expectValue(page, 'release-check-email', email);
      await shot('sign-in-prefilled');
    });
  } finally {
    await context.close();
  }
  return report.rows;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.role) rmSync(OUTPUT_DIR, { recursive: true, force: true });

  if (!options.skipBuild || !existsSync(path.join(BUILD_DIR, 'index.html'))) {
    console.log('Building the web app (a few minutes)…');
    buildPreviewWeb(BUILD_DIR);
  }

  const server = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const allRows = [];
  let hadFailure = false;
  try {
    for (const viewport of VIEWPORTS) {
      console.log(`\n=== Viewport ${viewport.id} ===`);

      if (options.role !== 'seller') {
      console.log(`-- buyer walkthrough --`);
      const buyerDir = path.join(OUTPUT_DIR, viewport.id, 'buyer');
      try {
        const rows = await runBuyerWalkthrough(browser, { viewport, origin: server.origin, outDir: buyerDir });
        allRows.push(...rows.map((r) => ({ ...r, viewport: viewport.id, role: 'buyer' })));
      } catch (error) {
        hadFailure = true;
        allRows.push(...(error.walkthroughRows ?? [{ name: 'walkthrough startup', ok: false, message: String(error) }])
          .map((r) => ({ ...r, viewport: viewport.id, role: 'buyer' })));
      }
      }

      if (!options.role) {
        console.log(`-- log-in handoff --`);
        try {
          const rows = await runLoginHandoff(browser, { viewport, origin: server.origin, outDir: path.join(OUTPUT_DIR, viewport.id, 'login') });
          allRows.push(...rows.map((r) => ({ ...r, viewport: viewport.id, role: 'log-in' })));
        } catch (error) {
          hadFailure = true;
          allRows.push(...(error.walkthroughRows ?? [{ name: 'walkthrough startup', ok: false, message: String(error) }])
            .map((r) => ({ ...r, viewport: viewport.id, role: 'log-in' })));
        }
      }

      if (options.role !== 'buyer') {
      console.log(`-- seller walkthrough --`);
      const sellerDir = path.join(OUTPUT_DIR, viewport.id, 'seller');
      try {
        const rows = await runSellerWalkthrough(browser, { viewport, origin: server.origin, outDir: sellerDir });
        allRows.push(...rows.map((r) => ({ ...r, viewport: viewport.id, role: 'seller' })));
      } catch (error) {
        hadFailure = true;
        allRows.push(...(error.walkthroughRows ?? [{ name: 'walkthrough startup', ok: false, message: String(error) }])
          .map((r) => ({ ...r, viewport: viewport.id, role: 'seller' })));
      }
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
