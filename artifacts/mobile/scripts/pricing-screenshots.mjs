#!/usr/bin/env node
/**
 * Screenshots + checks for the public seller pricing (landing "Pricing"
 * section and /pricing) at 393x852 and 1440x900.
 *
 *   node scripts/pricing-screenshots.mjs [outDir]
 *
 * Builds landing.html + pricing.html into a temp folder exactly as the web
 * build does, serves them with server/serve.js and captures:
 *   landing-pricing-<w>.png   the landing page's Pricing section
 *   pricing-<w>.png           /pricing, full page
 *   landing-header-before/after-1440.png, landing-footer-before/after-393.png
 *                             the two existing landing spots that gained a link
 * It fails when the trial line does not show today + trial days ("Oct 20"),
 * when the page scrolls sideways, or when the optional yearly toggle shows
 * without a configured web price (the API is stubbed: empty, then one offer
 * to check the toggle swaps price and button; that state is not captured).
 * Set CHROMIUM_PATH to use a specific browser binary.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const { writeLandingPage, renderLandingHtml } = require('./landing-page.js');
const { chargeDateLabel } = require('./pricing-page.js');
const { loadPlanCatalogue } = require('./plan-catalogue.js');

const out = path.resolve(process.argv[2] ?? path.join(projectRoot, '../../docs/pr-assets/pricing'));
fs.mkdirSync(out, { recursive: true });

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-pricing-'));
fs.copyFileSync(path.join(projectRoot, 'assets/images/brandthread-logo.png'), path.join(root, 'brandthread-logo.png'));
fs.writeFileSync(path.join(root, 'index.html'), '<html><body>APP</body></html>');
writeLandingPage(root, projectRoot, {});
// The landing page as it is on dev today (no pricing), for before/after.
fs.writeFileSync(path.join(root, 'before.html'), renderLandingHtml({}));

const port = 40100 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [path.join(projectRoot, 'server/serve.js')], {
  env: { ...process.env, PORT: String(port), EXPO_WEB_BUILD_DIR: root },
  stdio: 'ignore',
});
const origin = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) {
  try { await fetch(`${origin}/status`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
}

const catalogue = loadPlanCatalogue();
const expectedDate = chargeDateLabel(catalogue.trialDays, new Date());
const problems = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function open(width, height, url, annual = { plans: [] }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 500 ? 2 : 1, isMobile: width < 500, hasTouch: width < 500, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.route('**/api/public/web-annual-plans', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(annual) }));
  await page.goto(`${origin}${url}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (sideways > 0) problems.push(`${url} @${width}: scrolls sideways by ${sideways}px`);
  return { context, page };
}

async function checkTrialLine(page, label) {
  const lines = await page.locator('.plan .trial').allTextContents();
  if (!lines.length) problems.push(`${label}: no trial line`);
  for (const line of lines) {
    const want = `Free for ${catalogue.trialDays} days. You won’t be charged until ${expectedDate}. We’ll remind you ${catalogue.reminderDaysBefore} days before. Cancel anytime.`;
    if (line.trim() !== want) problems.push(`${label}: trial line "${line.trim()}"`);
  }
}

for (const [w, h] of [[393, 852], [1440, 900]]) {
  {
    const { context, page } = await open(w, h, '/welcome');
    await checkTrialLine(page, `landing @${w}`);
    await page.locator('#pricing').screenshot({ path: path.join(out, `landing-pricing-${w}.png`) });
    await context.close();
  }
  {
    const { context, page } = await open(w, h, '/pricing');
    await checkTrialLine(page, `/pricing @${w}`);
    if (await page.locator('.billing').isVisible()) problems.push(`/pricing @${w}: yearly toggle visible with no web yearly price`);
    await page.screenshot({ path: path.join(out, `pricing-${w}.png`), fullPage: true });
    await page.screenshot({ path: path.join(out, `pricing-${w}-top.png`) });
    await context.close();
  }
}

// Before/after for the two existing landing spots that changed.
for (const [name, file] of [['before', '/before.html'], ['after', '/welcome']]) {
  const desk = await open(1440, 900, file);
  await desk.page.locator('header').screenshot({ path: path.join(out, `landing-header-${name}-1440.png`) });
  await desk.context.close();
  const phone = await open(393, 852, file);
  await phone.page.locator('header').screenshot({ path: path.join(out, `landing-header-${name}-393.png`) });
  await phone.page.locator('footer').screenshot({ path: path.join(out, `landing-footer-${name}-393.png`) });
  await phone.context.close();
}

// Optional yearly web price: check the toggle wiring with a stubbed offer.
{
  const growth = catalogue.plans.find((p) => p.id === 'growth');
  const { context, page } = await open(393, 852, '/pricing', { plans: [{ planId: 'growth', amountCents: growth.priceCents * 10 }] });
  if (!(await page.locator('.billing').isVisible())) problems.push('yearly toggle hidden with a web yearly price');
  await page.getByRole('button', { name: 'Yearly on the web' }).click();
  const price = await page.locator('[data-price-for="growth"]').textContent();
  const href = await page.locator('[data-cta-for="growth"]').getAttribute('href');
  if (!price.includes('USD/year') || !href.includes(encodeURIComponent('billing=annual'))) problems.push(`yearly toggle did not switch Growth (${price} / ${href})`);
  const starterHref = await page.locator('[data-cta-for="starter"]').getAttribute('href');
  if (starterHref !== '/onboarding') problems.push('plan without a yearly price changed its button');
  await page.getByRole('button', { name: 'Monthly' }).click();
  if ((await page.locator('[data-cta-for="growth"]').getAttribute('href')) !== '/onboarding') problems.push('monthly did not restore Growth');
  await context.close();
}

await browser.close();
server.kill();
fs.rmSync(root, { recursive: true, force: true });
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Pricing screenshots written to ${out} (trial date ${expectedDate}).`);
