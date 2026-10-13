#!/usr/bin/env node
/**
 * Screenshots of the buyer onboarding taste quiz at iPhone size (393x852),
 * driven through the REAL onboarding screen with the walkthrough's mocked
 * Clerk + API. Quiz products use the app's own bundled photography
 * (assets/videos runway posters + the boots product shot + the hoodie mockup).
 *
 *   node scripts/onboarding-walkthrough/taste-quiz-capture.mjs <web-build-dir> <out-dir> [--before]
 *
 * --before: capture the same path on a build without the quiz (Style → Sizes).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, serveBuild } from '../store-screenshots/harness.mjs';
import { clerkOnboardingStubScript } from './clerk-onboarding-stub.mjs';
import { createFakeOnboardingApi, installFakeBackend } from './fake-api.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MOBILE_ROOT = path.resolve(HERE, '../..');
const REPO_ROOT = path.resolve(MOBILE_ROOT, '../..');
const DEMO_API = 'https://api.brandthread.test';
const IMG = 'https://cdn.brandthread.test';

const [buildDir, outDir, flag] = process.argv.slice(2);
if (!buildDir || !outDir) throw new Error('usage: taste-quiz-capture.mjs <web-build-dir> <out-dir> [--before]');
const BEFORE = flag === '--before';

const PHOTOS = [
  ...Array.from({ length: 10 }, (_, i) => path.join(MOBILE_ROOT, `assets/videos/fashion_runway_${String(i + 1).padStart(2, '0')}.jpg`)),
  path.join(MOBILE_ROOT, 'assets/images/products/leather-ankle-boots.jpg'),
  path.join(REPO_ROOT, 'attached_assets/generated_images/apparel_mockup.png'),
];
const QUIZ = [
  ['Atelier Noire', 'Wool Longline Coat', ['minimalist']],
  ['Maison Vela', 'Bias Slip Dress', ['luxury']],
  ['Saint Rue', 'Archive Bomber', ['vintage', 'streetwear']],
  ['Common Field', 'Boxy Linen Shirt', ['coastal', 'minimalist']],
  ['Ninth Ward', 'Washed Denim Jacket', ['vintage']],
  ['Atelier Noire', 'Tailored Trouser', ['minimalist']],
  ['Lowlight', 'Nylon Utility Vest', ['techwear']],
  ['Saint Rue', 'Oversized Hoodie', ['streetwear']],
  ['Maison Vela', 'Silk Shirt', ['luxury', 'minimalist']],
  ['Common Field', 'Track Jacket', ['athleisure']],
  ['Hollis', 'Leather Ankle Boots', ['minimalist', 'luxury']],
  ['Saint Rue', 'Heavyweight Hoodie', ['streetwear', 'basics']],
].map(([brand, name, styleKeys], i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  brand, name, styleKeys, imageUrl: `${IMG}/quiz/${i}.jpg`,
}));

async function shot(page, name) {
  mkdirSync(outDir, { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  ✓ ${name}`);
}

const browser = await launchBrowser();
const server = await serveBuild(path.resolve(buildDir));
try {
  const api = createFakeOnboardingApi();
  const inner = api.respond;
  api.respond = (req) => {
    const p = req.pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '');
    if (p === '/buyer/taste-quiz' && req.method === 'GET') return { status: 200, body: { products: QUIZ } };
    if (p === '/buyer/taste-quiz/swipes' && req.method === 'POST') return { status: 200, body: { applied: req.body?.swipes?.length ?? 0 } };
    return inner(req);
  };
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce',
  });
  await context.addInitScript(clerkOnboardingStubScript());
  await installFakeBackend(context, { origin: server.origin, apiOrigin: DEMO_API, api });
  // Registered last so it runs before the fake backend's catch-all abort.
  await context.route(`${IMG}/**`, (route) => {
    const i = Number(new URL(route.request().url()).pathname.match(/(\d+)\.jpg$/)?.[1] ?? 0);
    const file = PHOTOS[i % PHOTOS.length];
    return route.fulfill({ status: 200, contentType: file.endsWith('.png') ? 'image/png' : 'image/jpeg', body: readFileSync(file) });
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log(`    (console: ${m.text().slice(0, 200)})`); });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));

  await page.goto(`${server.origin}/onboarding`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await page.getByTestId('onboarding-welcome-get-started').waitFor({ timeout: 20_000 });
  try { await page.getByText('Necessary only', { exact: true }).click({ timeout: 3_000 }); } catch { /* no banner */ }
  await page.getByTestId('onboarding-welcome-get-started').click();
  await page.getByTestId('onboarding-account-type-buyer').click();
  await page.getByTestId('onboarding-account-type-continue').click();
  await page.getByTestId('onboarding-username-input').waitFor({ timeout: 10_000 });
  const tag = Date.now().toString(36);
  await page.getByLabel('Email address', { exact: true }).fill(`quiz-${tag}@walkthrough.test`);
  await page.getByLabel('First name', { exact: true }).fill('Bailey');
  await page.getByLabel('Last name', { exact: true }).fill('Rivera');
  await page.getByLabel('Password', { exact: true }).fill('Walkthrough!Pass1');
  await page.getByLabel('Confirm password', { exact: true }).fill('Walkthrough!Pass1');
  await page.getByTestId('onboarding-username-input').fill(`bailey_${tag}`.slice(0, 20));
  const dob = page.getByLabel('Date of birth', { exact: true });
  if (await dob.count()) await dob.first().pressSequentially('04121998');
  const consent = page.getByTestId('legal-consent-checkbox');
  if (await consent.count()) await consent.first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByText('Check your email').waitFor({ timeout: 10_000 }).catch(async (e) => {
    await page.screenshot({ path: path.join(outDir, 'debug-signup.png') });
    throw e;
  });
  await page.getByLabel('Verification code').fill('000000');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await page.getByTestId('onboarding-first-name-input').waitFor({ timeout: 15_000 });
  await page.getByTestId('onboarding-first-name-input').fill('Bailey');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('What do you', { exact: false }).waitFor({ timeout: 10_000 });
  await shot(page, '01-style-picker');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  if (BEFORE) {
    await page.getByText('What sizes', { exact: false }).waitFor({ timeout: 10_000 });
    await shot(page, '02-next-step-sizes');
  } else {
    await page.getByTestId('taste-quiz-card-0').waitFor({ timeout: 10_000 }).catch(async (e) => {
      await page.screenshot({ path: path.join(outDir, 'debug-quiz.png') });
      throw e;
    });
    await shot(page, '02-quiz-first-card');
    // Like the minimal/luxury pieces, pass the rest.
    for (const p of QUIZ) {
      const like = p.styleKeys.some((k) => k === 'minimalist' || k === 'vintage');
      await page.getByTestId(like ? 'taste-quiz-like' : 'taste-quiz-pass').click();
      await page.waitForTimeout(260);
      if (p === QUIZ[4]) await shot(page, '03-quiz-midway');
    }
    await page.getByTestId('taste-quiz-result').waitFor({ timeout: 10_000 });
    await shot(page, '04-style-identity');
    await page.getByTestId('taste-quiz-continue').click();
    await page.getByText('What sizes', { exact: false }).waitFor({ timeout: 10_000 });
    await shot(page, '05-then-sizes');
  }
} finally {
  await browser.close();
  server.close();
}
