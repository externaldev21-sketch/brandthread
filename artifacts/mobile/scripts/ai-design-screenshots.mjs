#!/usr/bin/env node
/**
 * AI Design 393x852 screenshots + text-fit check. TEST HARNESS ONLY.
 *
 * Runs against a local Expo web dev server (BASE_URL, default :8734) with the
 * Clerk stub from scripts/store-screenshots. `/mockup/generate` is answered by
 * a playwright route with a placeholder gradient labelled "STUB IMAGE" — the
 * app itself contains no demo/fake generation code. Output:
 *   docs/pr-review/ai-design-redesign/*.png  (full screens + zoomed groups)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clerkStubScript } from './store-screenshots/clerk-stub.mjs';
import { SELLER_USER } from './store-screenshots/demo-data.mjs';
import { checkPage, VIEWPORT } from './audit/text-fit-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/pr-review/ai-design-redesign');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8734';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const gp = await (await browser.newContext({ viewport: { width: 512, height: 512 } })).newPage();
await gp.setContent('<body style="margin:0;background:radial-gradient(circle at 40% 30%,#d9d9d9,#3a3a3a 60%,#000);width:512px;height:512px;display:flex;align-items:center;justify-content:center"><div style="font:700 28px Inter,sans-serif;color:#fff;letter-spacing:4px">STUB IMAGE</div></body>');
const b64 = (await gp.screenshot({ type: 'png' })).toString('base64');

const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(clerkStubScript(SELLER_USER));
await ctx.route('**/mockup/generate**', async (r) => {
  await new Promise((x) => setTimeout(x, 1000));
  await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ b64_json: b64 }) });
});
const page = await ctx.newPage();
await page.goto(`${BASE_URL}/design-text-to-design?bt_preview=seller`, { waitUntil: 'load', timeout: 240000 });
await page.waitForTimeout(6000);
try { await page.getByText('Necessary only', { exact: true }).first().click({ timeout: 1500 }); } catch { /* none */ }

let failures = 0;
async function state(name, zooms = {}) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `ai-design-${name}.png`) });
  for (const [zn, sel] of Object.entries(zooms)) {
    const loc = page.locator(sel).first();
    if (await loc.count()) await loc.screenshot({ path: path.join(OUT, `ai-design-${name}-zoom-${zn}.png`) });
  }
  const findings = await checkPage(page);
  console.log(`${findings.length ? 'FAIL' : 'ok  '} ${name}`);
  for (const f of findings) console.log(`   ${f.kind}: ${f.what} — ${f.detail}`);
  failures += findings.length;
}
const ta = page.locator('textarea').last();

await state('1-empty', { tiles: '[data-testid="ai-design-tile-hoodie"] >> xpath=..', composer: '[data-testid="ai-design-composer"]' });
await page.getByTestId('ai-design-tile-hoodie').click();
await page.getByTestId('ai-design-chip-colour').click();
await state('2-colour-options', { composer: '[data-testid="ai-design-composer"]' });
await page.getByLabel('Black', { exact: true }).first().click();
await page.getByTestId('ai-design-chip-placement').click();
await page.getByLabel('Back', { exact: true }).first().click();
await ta.fill('heavyweight, distressed chrome logo');
await state('3-chips-and-text', { composer: '[data-testid="ai-design-composer"]' });
await ta.fill('line one\nline two\nline three\nline four\nline five\nline six');
await state('3b-multiline');
await ta.fill('heavyweight, distressed chrome logo');
await page.getByTestId('ai-design-composer-send').click();
await page.waitForTimeout(300);
await state('4-generating');
await page.waitForTimeout(2500);
await state('5-result-card', { actions: '[data-testid="ai-design-refine"] >> xpath=..', composer: '[data-testid="ai-design-composer"]' });
await page.getByTestId('ai-design-refine').click();
await ta.fill('make the logo bigger');
await state('6-refine', { composer: '[data-testid="ai-design-composer"]' });
await browser.close();
process.exit(failures ? 1 : 0);
