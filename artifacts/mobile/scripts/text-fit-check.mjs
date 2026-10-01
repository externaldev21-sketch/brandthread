#!/usr/bin/env node
/**
 * Text-fit & alignment check for Expo web previews at 393x852.
 *
 * Flags, for every visible text node on the page:
 *   - truncated text (scrollWidth > clientWidth, or an ellipsis that is active)
 *   - text whose box overflows its parent's box or the viewport
 *   - text closer than MIN_PAD px to its container's edge when the container
 *     draws its own border or background (button / chip / card padding)
 *
 *   node scripts/text-fit-check.mjs --port 8181 "/ai-credits?bt_preview=seller&demo=1" [...more paths]
 *
 * Exits 1 when anything is flagged, so it can gate a PR.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? args.splice(portIdx, 2)[1] : '8181';
const PATHS = args.length ? args : ['/'];
const VIEWPORT = { width: 393, height: 852 };
const MIN_PAD = 12;

async function inspect(page) {
  return page.evaluate(({ MIN_PAD, vw }) => {
    const issues = [];
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    };
    const drawsBox = (el) => {
      const s = getComputedStyle(el);
      const hasBg = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
      const hasBorder = parseFloat(s.borderTopWidth) > 0.4 && s.borderTopStyle !== 'none';
      // Scroll containers clip by design; text below the fold is not an overflow.
      const scrolls = /(auto|scroll)/.test(s.overflowY) || el.scrollHeight > el.clientHeight + 1;
      return (hasBg || hasBorder) && !scrolls;
    };
    const label = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent.trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || seen.has(el) || !visible(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1) {
        issues.push({ kind: 'truncated', text: label(el), detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}` });
      }
      if (r.left < -0.5 || r.right > vw + 0.5) {
        issues.push({ kind: 'off-screen', text: label(el), detail: `left ${Math.round(r.left)} right ${Math.round(r.right)}` });
      }
      // Walk up to the nearest ancestor that draws a box.
      let box = el.parentElement;
      const isScroller = (n) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1;
      while (box && box !== document.body && !drawsBox(box)) {
        // Text inside a scroller is clipped by design; only boxes inside it count.
        if (isScroller(box)) { box = null; break; }
        box = box.parentElement;
      }
      if (box && box !== document.body && visible(box)) {
        const b = box.getBoundingClientRect();
        if (r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) {
          issues.push({ kind: 'overflows-container', text: label(el), detail: 'text box leaves its container' });
        } else {
          const padL = r.left - b.left;
          const padR = b.right - r.right;
          // Ignore full-bleed rows (container as wide as the viewport) and tiny badges with radius pills.
          if (b.width < vw - 2 && (padL < MIN_PAD - 0.5 || padR < MIN_PAD - 0.5) && text.length > 1) {
            issues.push({ kind: 'tight-padding', text: label(el), detail: `left ${Math.round(padL)}px right ${Math.round(padR)}px (min ${MIN_PAD})` });
          }
        }
      }
    }
    const doc = document.scrollingElement;
    if (doc && doc.scrollWidth > vw + 1) issues.push({ kind: 'horizontal-scroll', text: '(page)', detail: `scrollWidth ${doc.scrollWidth}` });
    return issues;
  }, { MIN_PAD, vw: VIEWPORT.width });
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce' });
let total = 0;
for (const p of PATHS) {
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}${p}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByText('Accept all').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(12000);
  const issues = await inspect(page);
  total += issues.length;
  console.log(`\n${p}\n  ${issues.length === 0 ? 'OK - no text-fit issues' : `${issues.length} issue(s)`}`);
  for (const i of issues) console.log(`  [${i.kind}] "${i.text}" ${i.detail}`);
  await page.close();
}
await browser.close();
process.exit(total ? 1 : 0);
