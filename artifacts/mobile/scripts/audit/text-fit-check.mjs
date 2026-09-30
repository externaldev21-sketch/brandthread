#!/usr/bin/env node
/**
 * Text-fit & alignment check (Playwright, 393x852).
 *
 * Flags, for every visible text run on a page:
 *   - overflow:    element scrollWidth > clientWidth (clipped / ellipsised text)
 *   - ellipsis:    text-overflow: ellipsis that is actually truncating
 *   - viewport:    text box crossing the left/right edge of the viewport
 *   - clipped:     text box partly hidden by an overflow-clipping ancestor
 *                  (e.g. a chip cut off at the edge of a scroll row)
 *   - padding:     text closer than 12px (buttons/chips, boxes < 60px tall) or
 *                  16px (cards) to its bordered/filled container's edge
 *   - escapes:     text box outside its container's box
 *
 * Usage (from artifacts/mobile, Expo web dev server on :8734, Clerk stubbed):
 *   node scripts/audit/text-fit-check.mjs '<json [{name,url,role?:"buyer"|"seller",steps?}]>'
 *   steps: [{click:'[data-testid=x]'} | {fill:{sel,text}} | {wait:ms}] run before checking.
 * Exits 1 when anything is flagged. Importable: `checkPage(page)` returns findings.
 */
import { chromium } from '@playwright/test';
import { clerkStubScript } from '../store-screenshots/clerk-stub.mjs';
import { BUYER_USER, SELLER_USER } from '../store-screenshots/demo-data.mjs';

export const VIEWPORT = { width: 393, height: 852 };

export async function checkPage(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    const isBox = (cs) =>
      (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') ||
      (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent');
    const label = (el) => (el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.tagName.toLowerCase());
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const txt = node.textContent.trim();
      if (!txt) continue;
      if (/^[\uE000-\uF8FF]+$/.test(txt)) continue; // icon-font glyphs, not text
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
      if (el.closest('textarea, input, script, style, [aria-hidden="true"]')) continue;
      const er = el.getBoundingClientRect();
      if (er.width === 0 || er.height === 0) continue;
      seen.add(el);
      const range = document.createRange();
      range.selectNodeContents(node);
      const tr = range.getBoundingClientRect();
      const tag = `"${txt.slice(0, 40)}" <${label(el)}>`;
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible')
        out.push({ kind: 'overflow', what: tag, detail: `${el.scrollWidth}>${el.clientWidth}` });
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1)
        out.push({ kind: 'ellipsis', what: tag, detail: txt });
      if (tr.left < -0.5 || tr.right > vw + 0.5)
        out.push({ kind: 'viewport', what: tag, detail: `${tr.left.toFixed(0)}..${tr.right.toFixed(0)} of ${vw}` });
      // clipped by an ancestor that clips overflow
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        if (ar.width === 0) continue;
        if (tr.right > ar.right + 0.5 || tr.left < ar.left - 0.5) {
          out.push({ kind: 'clipped', what: tag, detail: `text ${tr.left.toFixed(0)}..${tr.right.toFixed(0)} vs ${label(a)} ${ar.left.toFixed(0)}..${ar.right.toFixed(0)}` });
          break;
        }
      }
      // container padding
      let box = null;
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        if (isBox(getComputedStyle(a))) { box = a; break; }
      }
      if (box) {
        const br = box.getBoundingClientRect();
        // Avatars, dots and count badges are not text containers.
        const tiny = br.width < 56 || Math.abs(br.width - br.height) < 2;
        if (tiny) continue;
        const need = br.height < 60 ? 12 : 16;
        const isRounded = parseFloat(getComputedStyle(box).borderTopLeftRadius) >= br.height / 2 - 1;
        const padNeed = isRounded ? Math.min(need, 12) : need;
        // chat bubbles (radius >= 12, free-flowing text) keep 12px; other cards 16px
        const bubble = parseFloat(getComputedStyle(box).borderTopLeftRadius) >= 12 && br.height >= 60 && br.width < vw - 40;
        const padNeed2 = bubble ? Math.min(padNeed, 12) : padNeed;
        if (br.width < vw - 1 && br.width > 0) {
          const l = tr.left - br.left, r = br.right - tr.right;
          if (l < padNeed2 - 1.5 || r < padNeed2 - 1.5)
            out.push({ kind: 'padding', what: tag, detail: `in ${label(box)} left ${l.toFixed(0)} right ${r.toFixed(0)} (need ${padNeed2})` });
          if (tr.top < br.top - 0.5 || tr.bottom > br.bottom + 0.5)
            out.push({ kind: 'escapes', what: tag, detail: `text ${tr.top.toFixed(0)}..${tr.bottom.toFixed(0)} box ${br.top.toFixed(0)}..${br.bottom.toFixed(0)}` });
        }
      }
    }
    return out;
  });
}

async function runSteps(page, steps = []) {
  for (const st of steps) {
    if (st.click) await page.locator(st.click).first().click();
    if (st.fill) await page.locator(st.fill.sel).last().fill(st.fill.text);
    if (st.wait) await page.waitForTimeout(st.wait);
  }
}

async function main() {
  const targets = JSON.parse(process.argv[2] || '[]');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  let bad = 0;
  for (const t of targets) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.addInitScript(clerkStubScript(t.role === 'buyer' ? BUYER_USER : SELLER_USER));
    const page = await ctx.newPage();
    await page.goto(t.url, { waitUntil: 'load', timeout: 240000 });
    await page.waitForTimeout(6000);
    try { await page.getByText('Necessary only', { exact: true }).first().click({ timeout: 1500 }); } catch { /* no banner */ }
    await runSteps(page, t.steps);
    await page.waitForTimeout(500);
    const findings = await checkPage(page);
    console.log(`${findings.length ? 'FAIL' : 'ok  '} ${t.name} (${findings.length})`);
    for (const f of findings) console.log(`   ${f.kind}: ${f.what} — ${f.detail}`);
    bad += findings.length;
    await ctx.close();
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
