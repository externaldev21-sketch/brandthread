#!/usr/bin/env node
/**
 * Text-fit & alignment check for the Brandthread Pro screens (393x852).
 * Flags, for every visible text-bearing element:
 *   - clipped text   : scrollWidth > clientWidth (ellipsis / overflow)
 *   - overflow       : text box extends past its nearest bordered/filled container
 *                      or past the viewport edge
 *   - tight padding  : text closer than 12px to its container's left/right edge
 *                      (containers with a border or background only)
 *
 *   node scripts/text-fit-check-brandthread-pro.mjs <origin> [outDir]
 * Requires the Expo web dev server (see artifacts/mobile/scripts/store-screenshots/brandthread-pro-verify.mjs).
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.resolve('artifacts/mobile/package.json'));
const { chromium } = require('playwright');

const ORIGIN = process.argv[2] ?? 'http://localhost:8195';
const OUT = path.resolve(process.argv[3] ?? 'docs/pr-assets/brandthread-pro/text-fit');
mkdirSync(OUT, { recursive: true });

const SCREENS = [
  ['analytics-tab', '/analytics?bt_preview=seller&demo=1'],
  ['advanced-analytics', '/analytics-advanced?bt_preview=seller&demo=1'],
  ['advanced-analytics-locked', '/analytics-advanced?bt_preview=seller&demo=1&locked=1'],
  ['plans-pro', '/plans?bt_preview=seller&demo=1&highlight=pro&source=analytics-advanced'],
];

function inspect() {
  const findings = [];
  const vw = window.innerWidth;
  const isBox = (el) => {
    const cs = getComputedStyle(el);
    const hasBorder = parseFloat(cs.borderLeftWidth) > 0 || parseFloat(cs.borderTopWidth) > 0;
    const bg = cs.backgroundColor;
    const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    return hasBorder || hasBg;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const label = text.slice(0, 40);
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') {
      findings.push({ kind: 'clipped', text: label, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    const tr = range.getBoundingClientRect();
    if (tr.right > vw + 0.5 || tr.left < -0.5) findings.push({ kind: 'off-screen', text: label, left: tr.left, right: tr.right });
    let box = el.parentElement;
    while (box && !isBox(box)) box = box.parentElement;
    if (box && box !== document.body && box.getBoundingClientRect().width < vw) {
      const br = box.getBoundingClientRect();
      if (tr.right > br.right + 0.5 || tr.left < br.left - 0.5) {
        findings.push({ kind: 'overflows-container', text: label });
      } else if (tr.width > 0 && (tr.left - br.left < 12 || br.right - tr.right < 12)) {
        // Right-aligned or left-aligned text in a card still needs >= 12px inside.
        findings.push({ kind: 'tight-padding', text: label, left: Math.round(tr.left - br.left), right: Math.round(br.right - tr.right) });
      }
    }
  }
  return findings;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
let failed = 0;
for (const [name, route] of SCREENS) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', colorScheme: 'dark', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('bt_preview_demo', '1'); } catch {} });
  const page = await ctx.newPage();
  await page.route((u) => u.origin !== new URL(ORIGIN).origin, (r) => r.abort());
  await page.goto(`${ORIGIN}${route}`, { waitUntil: 'domcontentloaded', timeout: 240_000 });
  await page.waitForTimeout(9000);
  const findings = await page.evaluate(inspect);
  console.log(`${findings.length === 0 ? 'PASS' : 'FAIL'} ${name}`);
  for (const f of findings) console.log('   ', JSON.stringify(f));
  if (findings.length) failed += 1;
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
