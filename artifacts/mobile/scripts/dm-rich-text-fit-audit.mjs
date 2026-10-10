#!/usr/bin/env node
/**
 * Text-fit / alignment / console-error audit for DM rich content
 * (voice bubble, video/photo bubbles, order card, attach sheet Order tab,
 * video viewer) at 393x852 on the Expo web preview.
 *
 *   expo start --web --port 8181   (separately)
 *   node scripts/dm-rich-text-fit-audit.mjs --port 8181
 *
 * Fails (exit 1) on:
 *   - any console error / pageerror (incl. React "<button> cannot contain a nested <button>")
 *   - any nested <button> in the DOM
 *   - any text element with scrollWidth > clientWidth (clipped / ellipsised)
 *   - any text element whose box overflows its parent's box
 *   - any element using text-overflow: ellipsis or -webkit-line-clamp that is actually truncating
 *
 * Output: docs/pr-assets/claude-dm-rich-messages/*.png (+ zoomed element shots)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'docs/pr-assets/claude-dm-rich-messages');
mkdirSync(OUT, { recursive: true });
const portArg = process.argv.indexOf('--port');
const ORIGIN = `http://localhost:${portArg >= 0 ? process.argv[portArg + 1] : '8181'}`;
const VIEWPORT = { width: 393, height: 852 };

let failures = 0;
const fail = (m) => { failures++; console.error(`  FAIL ${m}`); };

/** Runs inside the page. Returns offenders. */
function fitAudit() {
  const out = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const label = (el) => `${el.tagName.toLowerCase()}[${(el.getAttribute('data-testid') || el.getAttribute('aria-label') || '').slice(0, 30)}] "${(el.textContent || '').trim().slice(0, 40)}"`;
  const all = Array.from(document.body.querySelectorAll('*'));
  for (const el of all) {
    if (!vis(el)) continue;
    const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasOwnText) continue;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' || el.scrollWidth > el.clientWidth + 1 && cs.textOverflow === 'ellipsis') {
      out.push(`clipped: ${label(el)} (${el.scrollWidth}>${el.clientWidth})`);
    }
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`ellipsis: ${label(el)}`);
    const lc = cs.webkitLineClamp;
    if (lc && lc !== 'none' && el.scrollHeight > el.clientHeight + 1) out.push(`line-clamped: ${label(el)}`);
    const r = el.getBoundingClientRect();
    const p = el.parentElement;
    if (p) {
      const pr = p.getBoundingClientRect();
      const pcs = getComputedStyle(p);
      if (pr.width > 0 && (r.left < pr.left - 1 || r.right > pr.right + 1) && pcs.overflow !== 'visible') {
        out.push(`overflows parent: ${label(el)}`);
      }
    }
    if (r.right > window.innerWidth + 1 || r.left < -1) out.push(`off-screen: ${label(el)}`);
  }
  // Inner padding (interactive/testid containers only — avatars, status badges and
  // duration pills are intentionally tight): text must sit >=12px (>=16px in wide cards) from the edge of
  // its nearest bordered / filled container (chips, buttons, cards).
  const isBox = (e) => { const c = getComputedStyle(e); return (parseFloat(c.borderLeftWidth) > 0 && c.borderLeftStyle !== 'none') || (c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== 'transparent'); };
  for (const el of all) {
    if (!vis(el)) continue;
    const textNode = Array.from(el.childNodes).find((n) => n.nodeType === 3 && /[\p{L}\p{N}]/u.test(n.textContent));
    if (!textNode) continue;
    const range = document.createRange(); range.selectNodeContents(textNode);
    const tr = range.getBoundingClientRect();
    let box = el.parentElement; let hops = 0;
    while (box && hops < 5 && !(isBox(box) && box.getBoundingClientRect().width > tr.width + 4 && (box.matches('button, [role="button"]') || box.matches('[data-testid]')))) { box = box.parentElement; hops++; }
    if (!box || box === document.body || hops >= 5) continue;
    const br = box.getBoundingClientRect();
    if (br.width >= window.innerWidth - 2 || br.height > 400) continue; // page / sheet surfaces
    if ((box.getAttribute('data-testid') || '').startsWith('conversation-bubble')) continue;
    const need = br.width > 200 ? 16 : 12;
    const left = tr.left - br.left; const right = br.right - tr.right;
    if (left < need - 0.5 && right < need - 0.5 || Math.min(left, right) < need - 0.5 && Math.abs(left - right) < 4) out.push(`padding ${Math.round(Math.min(left, right))}px < ${need}px: ${label(el)} text=${JSON.stringify(textNode.textContent.slice(0, 20))} box=${box.tagName}[${box.getAttribute('data-testid') || box.getAttribute('aria-label') || ''}]`);
  }
  // Buttons sharing a row must have equal width and height.
  const rows = new Map();
  document.querySelectorAll('[role="button"], button').forEach((b) => {
    if (!vis(b) || !/[\p{L}\p{N}]{3,}/u.test(b.textContent || '') || b.querySelector('[data-testid="screen-header-title"]') || b.getAttribute('aria-label')?.startsWith('Message')) return;
    let p = b.parentElement; if (p && p.children.length === 1) p = p.parentElement; if (!p) return;
    (rows.get(p) || rows.set(p, []).get(p)).push(b);
  });
  rows.forEach((bs, parent) => {
    if (bs.length < 2 || bs.length !== Array.from(parent.querySelectorAll('[role="button"], button')).filter((x) => /[\p{L}\p{N}]{3,}/u.test(x.textContent || '')).length) return;
    const rects = bs.map((b) => b.getBoundingClientRect());
    if (Math.max(...rects.map((r) => r.top)) - Math.min(...rects.map((r) => r.top)) > 2) return; // not a single row
    const w = rects.map((r) => Math.round(r.width)); const hh = rects.map((r) => Math.round(r.height));
    if (Math.max(...w) - Math.min(...w) > 2) out.push(`unequal button widths in row: ${w.join('/')} (${bs.map((b) => (b.textContent || '').trim().slice(0, 12)).join(', ')})`);
    if (Math.max(...hh) - Math.min(...hh) > 2) out.push(`unequal button heights in row: ${hh.join('/')}`);
  });
  const nested = Array.from(document.querySelectorAll('button')).filter((b) => b.querySelector('button'));
  nested.forEach((b) => out.push(`nested button: ${b.outerHTML.slice(0, 80)}`));
  return out;
}

async function open(browser, url, name) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Network noise from the signed-out preview (no backend) is not a UI bug.
    if (/Failed to load resource|net::ERR|ERR_CONNECTION|401|403|404|fetch/i.test(t)) return;
    errors.push(`console.error: ${t.slice(0, 160)}`);
  });
  await page.goto(`${ORIGIN}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForTimeout(22_000);
  const accept = page.getByText('Accept all').first();
  if (await accept.isVisible().catch(() => false)) await accept.click();
  await page.waitForTimeout(800);
  return { ctx, page, errors, name };
}

async function check(h, step) {
  const offenders = await h.page.evaluate(fitAudit);
  offenders.forEach((o) => fail(`${h.name}/${step}: ${o}`));
  h.errors.splice(0).forEach((e) => fail(`${h.name}/${step}: ${e}`));
  console.log(`  ${h.name}/${step}: ${offenders.length ? offenders.length + ' offenders' : 'clean'}`);
}

async function zoom(h, locator, file) {
  const el = h.page.locator(locator).first();
  if (!(await el.count())) { console.log(`  (no ${locator} to zoom)`); return; }
  await el.screenshot({ path: path.join(OUT, file) }).catch(() => {});
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  // Buyer: voice + video + photo messages, composer visible.
  let h = await open(browser, '/buyer-conversation?id=preview-conversation-07&bt_preview=buyer&demo=1', 'buyer-media');
  await h.page.screenshot({ path: path.join(OUT, 'buyer-thread.png') });
  await check(h, 'thread');
  await zoom(h, '[aria-label="Play video"]', 'zoom-buyer-video-bubble.png');
  await h.page.locator('[aria-label="Play video"]').first().click().catch(() => {});
  await h.page.waitForTimeout(1500);
  await h.page.screenshot({ path: path.join(OUT, 'buyer-video-viewer.png') });
  await check(h, 'video-viewer');
  await h.ctx.close();

  // Buyer with linked order: attach sheet -> Order tab.
  h = await open(browser, '/buyer-conversation?id=preview-conversation-05&bt_preview=buyer&demo=1', 'buyer-order');
  await h.page.screenshot({ path: path.join(OUT, 'buyer-order-thread.png') });
  await check(h, 'thread');
  await zoom(h, '[data-testid="order-card-attachment"]', 'zoom-buyer-order-card.png');
  {
    // Composer's Attach (camera circle) opens the Add-to-message sheet.
    await h.page.locator('[data-testid="conversation-attach"]').click();
    await h.page.waitForTimeout(800);
    await h.page.screenshot({ path: path.join(OUT, 'buyer-attach-menu.png') });
    await check(h, 'attach-menu');
    await zoom(h, '[data-testid="conversation-attach"] >> xpath=ancestor::*[4]', 'zoom-buyer-media-sheet.png');
    const row = h.page.getByText('Product or post').first();
    if (await row.count()) { await row.click(); await h.page.waitForTimeout(800); }
    const tab = h.page.locator('[data-testid="attach-tab-order"]');
    if (await tab.count()) {
      await tab.click();
      await h.page.waitForTimeout(500);
      await h.page.screenshot({ path: path.join(OUT, 'buyer-attach-order-tab.png') });
      await check(h, 'order-tab');
      await zoom(h, '[data-testid="attach-order-row"]', 'zoom-buyer-attach-order-row.png');
    } else fail('buyer-order: Order tab not reachable');
  }
  await h.ctx.close();

  // Seller: photo/video/voice + order.
  h = await open(browser, '/seller-conversation?id=preview-seller-conversation-01&bt_preview=seller&demo=1', 'seller');
  await h.page.screenshot({ path: path.join(OUT, 'seller-thread.png') });
  await check(h, 'thread');
  await zoom(h, '[aria-label="Play video"]', 'zoom-seller-video-bubble.png');
  await h.ctx.close();
} finally {
  await browser.close();
}
if (failures) { console.error(`\n${failures} text-fit / console problem(s)`); process.exit(1); }
console.log('\nAll text-fit checks clean');
