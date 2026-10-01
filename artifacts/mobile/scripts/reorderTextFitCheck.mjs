#!/usr/bin/env node
/**
 * Text-fit & alignment check for the Expo web preview (393x852).
 *
 *   node scripts/reorderTextFitCheck.mjs --port 8151 \
 *     --url "/orders?bt_preview=buyer&demo=1" --wait "text=DELIVERED" \
 *     [--url ...] [--click "Reorder"] [--shots out/dir]
 *
 * Each --url may be followed by its own --wait / --click (applied in order).
 * Exit code 1 when anything is flagged.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const steps = [];
let port = '8081';
let shotsDir = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const v = args[i + 1];
  if (a === '--port') { port = v; i++; }
  else if (a === '--shots') { shotsDir = v; i++; }
  else if (a === '--url') { steps.push({ url: v }); i++; }
  else if (a === '--wait' && steps.length) { steps[steps.length - 1].wait = v; i++; }
  else if (a === '--click' && steps.length) { steps[steps.length - 1].click = v; i++; }
}
if (steps.length === 0) {
  console.error('usage: reorderTextFitCheck.mjs --port N --url /path [--wait selector] [--click text]');
  process.exit(2);
}

function inPage() {
  const findings = [];
  const vw = window.innerWidth;
  const label = (el) => `${el.tagName.toLowerCase()}[${(el.innerText || el.textContent || '').trim().slice(0, 40)}]`;
  const scrolls = (el) => {
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowX);
  };
  const all = [...document.body.querySelectorAll('*')];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText) {
      if (el.scrollWidth > el.clientWidth + 1 && !scrolls(el)) {
        findings.push({ kind: 'text-wider-than-box', el: label(el), detail: `${el.scrollWidth}>${el.clientWidth}` });
      }
      if (cs.textOverflow === 'ellipsis' && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
        findings.push({ kind: 'ellipsis-truncated', el: label(el), detail: '' });
      }
      const p = el.parentElement;
      if (p) {
        const ps = getComputedStyle(p);
        const boxed = parseFloat(ps.borderLeftWidth) > 0 || (ps.backgroundColor !== 'rgba(0, 0, 0, 0)' && ps.backgroundColor !== 'transparent');
        if (boxed && p.getBoundingClientRect().width < vw - 8) {
          const pr = p.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          const tr = range.getBoundingClientRect();
          const left = tr.left - pr.left;
          const right = pr.right - tr.right;
          if (tr.width > 0 && (left < 8 || right < 8) && pr.width > tr.width) {
            findings.push({ kind: 'text-touches-box-edge', el: label(el), detail: `left ${left.toFixed(1)} right ${right.toFixed(1)}` });
          }
        }
      }
    }
    if (r.right > vw + 1 || r.left < -1) {
      let ancestorScrolls = false;
      for (let a = el.parentElement; a; a = a.parentElement) if (scrolls(a)) { ancestorScrolls = true; break; }
      if (!ancestorScrolls && hasText) findings.push({ kind: 'outside-viewport', el: label(el), detail: `${r.left.toFixed(0)}..${r.right.toFixed(0)}` });
    }
    const parent = el.parentElement;
    if (parent && hasText && !scrolls(parent)) {
      const pr = parent.getBoundingClientRect();
      if (pr.width > 0 && (r.right > pr.right + 1 || r.left < pr.left - 1)) {
        findings.push({ kind: 'overflows-parent', el: label(el), detail: `${r.left.toFixed(0)}..${r.right.toFixed(0)} in ${pr.left.toFixed(0)}..${pr.right.toFixed(0)}` });
      }
    }
  }
  const buttons = [...document.querySelectorAll('[role="button"], button')].filter((b) => b.getBoundingClientRect().height > 0);
  const rows = new Map();
  for (const b of buttons) {
    const r = b.getBoundingClientRect();
    const key = Math.round(r.top / 4);
    rows.set(key, [...(rows.get(key) || []), { b, h: r.height }]);
  }
  for (const group of rows.values()) {
    if (group.length > 1 && new Set(group.map((g) => Math.round(g.h))).size > 1) {
      findings.push({ kind: 'row-buttons-unequal-height', el: group.map((g) => label(g.b)).join(' | '), detail: group.map((g) => g.h.toFixed(0)).join(',') });
    }
  }
  return findings;
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
let total = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', reducedMotion: 'reduce' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  let n = 0;
  for (const step of steps) {
    n += 1;
    await page.goto(`http://localhost:${port}${step.url}`, { waitUntil: 'commit', timeout: 240_000 });
    if (step.wait) await page.waitForSelector(step.wait, { timeout: 120_000 });
    await page.waitForTimeout(1500);
    const accept = page.getByText('Accept all').first();
    if (await accept.isVisible().catch(() => false)) await accept.click();
    if (step.click) {
      await page.getByText(step.click, { exact: true }).first().click();
      await page.waitForTimeout(3000);
    }
    const findings = await page.evaluate(inPage);
    total += findings.length;
    console.log(`\n${step.url}${step.click ? `  (after tapping "${step.click}")` : ''}`);
    if (findings.length === 0) console.log('  text-fit: clean');
    for (const f of findings) console.log(`  FLAG ${f.kind}: ${f.el} ${f.detail}`);
    if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `textfit-${n}.png`) });
  }
} finally {
  await browser.close();
}
console.log(total === 0 ? '\nTEXT-FIT RESULT: clean' : `\nTEXT-FIT RESULT: ${total} flag(s)`);
process.exit(total === 0 ? 0 : 1);