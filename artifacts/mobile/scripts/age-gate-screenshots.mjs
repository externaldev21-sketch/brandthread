#!/usr/bin/env node
/**
 * Verification for the age gate: drives the local Expo web preview
 * (`expo start --web --port <N>`, ?bt_preview=buyer so no Clerk session is needed),
 * opens the sign-up form, and captures the date-of-birth field in its empty and
 * under-13 error states at 393x852, plus a text-fit check that flags any text
 * element that is truncated or overflows its parent.
 *
 *   node scripts/age-gate-screenshots.mjs --port <N> [--role seller|buyer]
 *
 * Output: screenshots/trust-age-gate/*.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'screenshots/trust-age-gate');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const PORT = arg('port', '8193');
const ROLE = arg('role', 'seller');
const ORIGIN = `http://localhost:${PORT}`;

/** Flags text that is clipped (scrollWidth > clientWidth) or whose box leaves its parent. */
async function overflowReport(page) {
  return page.evaluate(() => {
    const bad = [];
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const clipped = el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible';
      const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      const p = el.parentElement?.getBoundingClientRect();
      const escapes = p && (r.left < p.left - 1 || r.right > p.right + 1);
      if (clipped || ellipsis || escapes) bad.push({ text: el.textContent.trim().slice(0, 50), clipped, ellipsis, escapes: !!escapes });
    }
    return bad;
  });
}

async function shot(page, name, clip) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
  console.log(`  saved ${name}`);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/?bt_preview=buyer`, { waitUntil: 'load', timeout: 240000 });
    await page.waitForTimeout(20000);
    // The placeholder Clerk key cannot load Clerk JS; dismiss the dev error overlay.
    for (let i = 0; i < 4; i++) { await page.mouse.click(28, 109); await page.waitForTimeout(600); }
    await page.evaluate(() => { window.history.pushState({}, '', '/onboarding?bt_preview=buyer'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.waitForTimeout(3000);
    await page.getByText('Get started', { exact: true }).first().click();
    await page.waitForTimeout(2000);
    await page.getByText(ROLE === 'seller' ? "I'm building a brand" : "I'm here to shop", { exact: true }).first().click();
    await page.getByText('Continue', { exact: true }).first().click();
    await page.waitForTimeout(2500);

    const dob = page.getByTestId(ROLE === 'seller' ? 'onboarding-dob-input' : 'age-dob-input').first();
    await dob.scrollIntoViewIfNeeded();
    await shot(page, `${ROLE}-signup-dob-empty`);
    console.log('  overflow (empty):', JSON.stringify(await overflowReport(page)));

    // The field is a native <input type="date"> on web (components/ui/NativeDateTimeField.tsx).
    await dob.fill((await dob.getAttribute('type')) === 'date' ? '2020-01-01' : '01012020');
    await shot(page, `${ROLE}-signup-dob-typed`);
    console.log('  typed value:', await dob.inputValue());
    console.log('  overflow (typed):', JSON.stringify(await overflowReport(page)));

    if (ROLE === 'seller') {
      // Under-13: the error shows inline under the field and no account is created.
      const inputs = page.locator('input');
      const vals = ['kid@example.com', 'Kid', 'Tester', 'password123', 'password123', 'kid_tester'];
      for (let i = 0; i < vals.length; i++) await inputs.nth(i).fill(vals[i]);
      await page.getByText(/I agree to the Terms/).first().click();
      await page.getByText('Create account', { exact: true }).first().click();
      await page.waitForTimeout(800);
      await dob.scrollIntoViewIfNeeded();
      await shot(page, 'seller-signup-dob-under13-error');
      console.log('  error text:', await page.getByTestId(/^(age-dob-error|age-dob-input-error|onboarding-dob-input-error)$/).first().innerText().catch(() => '(none)'));
      console.log('  overflow (error):', JSON.stringify(await overflowReport(page)));
    }
  } finally {
    await browser.close();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
