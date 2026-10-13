#!/usr/bin/env node
/**
 * Screenshots of the onboarding profile card at iPhone size (393x852): the
 * Name step as it fills in (name, @handle, photo) and the final screen where
 * the card flips to "Your profile is ready". Real onboarding screen, mocked
 * Clerk + API (same as capture.mjs).
 *
 *   node scripts/onboarding-walkthrough/profile-card-capture.mjs <web-build-dir> <out-dir> [--before]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, serveBuild } from '../store-screenshots/harness.mjs';
import { clerkOnboardingStubScript } from './clerk-onboarding-stub.mjs';
import { createFakeOnboardingApi, installFakeBackend } from './fake-api.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MOBILE_ROOT = path.resolve(HERE, '../..');
const DEMO_API = 'https://api.brandthread.test';
const PHOTO = path.join(MOBILE_ROOT, 'assets/videos/fashion_runway_04.jpg');

const [buildDir, outDir, flag] = process.argv.slice(2);
if (!buildDir || !outDir) throw new Error('usage: profile-card-capture.mjs <web-build-dir> <out-dir> [--before]');
const BEFORE = flag === '--before';

async function shot(page, name) {
  mkdirSync(outDir, { recursive: true });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  ✓ ${name}`);
}

const browser = await launchBrowser();
const server = await serveBuild(path.resolve(buildDir));
try {
  const api = createFakeOnboardingApi();
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce',
  });
  await context.addInitScript(clerkOnboardingStubScript());
  await installFakeBackend(context, { origin: server.origin, apiOrigin: DEMO_API, api });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));

  await page.goto(`${server.origin}/onboarding`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await page.getByTestId('onboarding-welcome-get-started').waitFor({ timeout: 20_000 });
  try { await page.getByText('Necessary only', { exact: true }).click({ timeout: 3_000 }); } catch { /* no banner */ }
  await page.getByTestId('onboarding-welcome-get-started').click();
  await page.getByTestId('onboarding-account-type-buyer').click();
  await page.getByTestId('onboarding-account-type-continue').click();
  await page.getByTestId('onboarding-username-input').waitFor({ timeout: 10_000 });
  await page.getByLabel('Email address', { exact: true }).fill(`card-${Date.now().toString(36)}@walkthrough.test`);
  await page.getByLabel('First name', { exact: true }).fill('Bailey');
  await page.getByLabel('Last name', { exact: true }).fill('Rivera');
  await page.getByLabel('Password', { exact: true }).fill('Walkthrough!Pass1');
  await page.getByLabel('Confirm password', { exact: true }).fill('Walkthrough!Pass1');
  await page.getByTestId('onboarding-username-input').fill('baileyrivera');
  const dob = page.getByLabel('Date of birth', { exact: true });
  if (await dob.count()) await dob.first().pressSequentially('04121998');
  const consent = page.getByTestId('legal-consent-checkbox');
  if (await consent.count()) await consent.first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Verification code').fill('000000');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  const nameInput = page.getByTestId('onboarding-first-name-input');
  await nameInput.waitFor({ timeout: 15_000 });
  await nameInput.fill('');
  await shot(page, '01-name-step-empty');
  await nameInput.fill('Bailey');
  if (!BEFORE) {
    try {
      await page.getByTestId('profile-card-photo').click();
      await page.getByText('Choose from Library', { exact: true }).waitFor({ timeout: 5_000 });
      const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
      await page.getByText('Choose from Library', { exact: true }).click();
      await (await chooser).setFiles(PHOTO);
      await page.waitForTimeout(1500);
      console.log('    photo picked');
    } catch (e) {
      console.log(`    (photo pick skipped: ${String(e.message).split('\n')[0]})`);
    }
  }
  await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
  await shot(page, '02-name-step-filled');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  // Style → (Sizes) → Brands with their footer buttons, then Loading → Notifications.
  for (let i = 0; i < 4; i += 1) {
    if (await page.getByTestId('onboarding-notifications-skip').count()) break;
    const btn = page.getByRole('button', { name: /^(Continue|Skip for now)$/ }).last();
    if (await btn.count()) await btn.click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.getByTestId('onboarding-notifications-skip').waitFor({ timeout: 20_000 });
  await page.getByTestId('onboarding-notifications-skip').click();
  await page.getByRole('button', { name: 'Start exploring', exact: true }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(2500);
  await shot(page, '03-success');
} finally {
  await browser.close();
  server.close();
}
