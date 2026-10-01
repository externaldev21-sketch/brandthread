#!/usr/bin/env node
/**
 * One-off verification for the legal pages PR: the sign-up form shows a single
 * linked line ("By continuing you agree to our Terms, Privacy Policy and
 * Community Guidelines") under the Create account button, with no checkbox.
 * Drives the real onboarding screen with the walkthrough's mocked Clerk/API.
 *
 *   node scripts/store-screenshots/legal-signup-line-verify.mjs   (after legal-pages-verify built the web export)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { checkTextFit } from './text-fit-check.mjs';
import { DEFAULT_BUILD_DIR, MOBILE_ROOT, launchBrowser, serveBuild } from './harness.mjs';
import { clerkOnboardingStubScript } from '../onboarding-walkthrough/clerk-onboarding-stub.mjs';
import { createFakeOnboardingApi, installFakeBackend } from '../onboarding-walkthrough/fake-api.mjs';

const OUT = path.join(MOBILE_ROOT, 'screenshots/legal-pages');
mkdirSync(OUT, { recursive: true });

async function main() {
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce',
  });
  await context.addInitScript(clerkOnboardingStubScript());
  await installFakeBackend(context, { origin, apiOrigin: 'https://api.brandthread.test', api: createFakeOnboardingApi() });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/onboarding`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await page.getByTestId('onboarding-welcome-get-started').waitFor({ timeout: 20_000 });
    const necessary = page.getByText('Necessary only', { exact: true });
    await necessary.click({ timeout: 3_000 }).catch(() => {});
    await page.getByTestId('onboarding-welcome-get-started').click();
    await page.getByTestId('onboarding-account-type-buyer').click();
    await page.getByTestId('onboarding-account-type-continue').click();
    await page.getByTestId('onboarding-username-input').waitFor({ timeout: 10_000 });
    await page.getByTestId('legal-consent-line').waitFor({ timeout: 5_000 });
    const checkbox = await page.getByTestId('legal-consent-checkbox').count();
    if (checkbox !== 0) throw new Error('a checkbox is still rendered on the sign-up form');
    await page.evaluate(() => {
      const line = document.querySelector('[data-testid="legal-consent-line"]');
      line?.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(600);
    const problems = await checkTextFit(page, { label: 'signup-form' });
    if (problems.length) process.exitCode = 1;
    await page.screenshot({ path: path.join(OUT, 'signup-line.png'), animations: 'disabled', caret: 'hide' });
    console.log('Captured signup-line.png (no checkbox present)');
  } finally {
    await browser.close();
    await close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
