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

async function openOnboardingContext(browser, { viewport, origin, api }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    locale: 'en-US',
    colorScheme: 'dark',
    // Exercise the real spring/press behavior, not just static end states.
    reducedMotion: 'no-preference',
  });
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
async function signUp(page, id, shot, report) {
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
    await input.fill('000000');
  });

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
}

async function runBuyerWalkthrough(browser, { viewport, origin, outDir }) {
  const api = createFakeOnboardingApi();
  const { context, page } = await openOnboardingContext(browser, { viewport, origin, api });
  const report = makeReport('buyer', viewport.id);
  const id = identity('buyer', viewport.id);
  let index = 0;
  const shot = (name) => screenshot(page, outDir, ++index, name);

  try {
    await page.goto(`${origin}/onboarding`);
    await waitClerkLoaded(page);
    await signUp(page, id, shot, report);

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

    await report.step('notifications (Cash App)', async () => {
      await page.getByTestId('onboarding-notifications').waitFor({ timeout: 10_000 });
      await shot('notifications');
      await page.getByTestId('onboarding-notifications-continue').click();
    });

    await report.step('Shop or Sell (Etsy) → finish as buyer', async () => {
      await page.getByTestId('onboarding-role').waitFor({ timeout: 10_000 });
      await shot('role');
      await pressWithFeedback(page, 'account-type-buyer');
      await shot('role-shop');
      await page.getByTestId('onboarding-role-continue').click();
      await page.waitForURL(/thread-explainer/, { timeout: 20_000 });
      const user = api.getUser();
      if (!user?.onboardingComplete || user.accountType !== 'buyer' || user.username !== id.username) {
        throw new Error(`server row not completed as buyer: ${JSON.stringify(user)}`);
      }
      if (JSON.stringify(user.styleInterests) !== '["Womenswear"]') throw new Error(`department not saved: ${JSON.stringify(user.styleInterests)}`);
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
      await page.getByTestId('onboarding-notifications-skip').click();
    });

    await report.step('back button walks back one step', async () => {
      await page.getByTestId('onboarding-role').waitFor({ timeout: 10_000 });
      // The outgoing layer remains mounted briefly but is aria-hidden/inert.
      // Target the accessible live control, not both transient testIDs.
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByTestId('onboarding-notifications').waitFor({ timeout: 5_000 });
      await page.getByTestId('onboarding-notifications-skip').click();
    });

    await report.step('Sell → store name (Depop Start selling)', async () => {
      await pressWithFeedback(page, 'account-type-seller');
      await shot('role-sell');
      await page.getByTestId('onboarding-role-continue').click();
      await page.getByTestId('onboarding-store').waitFor({ timeout: 10_000 });
      await shot('store');
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
          await page.getByText('Dashboard', { exact: true }).waitFor({ timeout: 10_000 });
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
      await shot('store-setup');
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
