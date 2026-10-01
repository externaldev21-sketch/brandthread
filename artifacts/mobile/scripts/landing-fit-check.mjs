#!/usr/bin/env node
/**
 * Text-fit and alignment check for the static landing page.
 *
 *   node scripts/landing-fit-check.mjs [--shots <dir>]
 *
 * Builds the page into a temp folder, serves it with server/serve.js, opens it
 * at 393x852 and 1440x900 in Chromium and fails if any of these is violated:
 *  - a text element has scrollWidth > clientWidth, or uses text-overflow
 *  - an element's box leaves its parent's box
 *  - buttons/chips have < 12px inner horizontal padding, cards < 16px
 *  - buttons or badges in one group differ in width or height
 *  - a step title or description wraps to a second line, or any text is under 12px
 *  - a wrapped paragraph or heading ends with a single word (orphan)
 *  - anything overflows the viewport horizontally
 * With --shots it also writes a zoomed screenshot of every card and button group.
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
const { writeLandingPage } = require('./landing-page.js');

const shotsIndex = process.argv.indexOf('--shots');
const shotsDir = shotsIndex > -1 ? path.resolve(process.argv[shotsIndex + 1]) : null;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-fit-'));
fs.copyFileSync(path.join(projectRoot, 'assets/images/brandthread-logo.png'), path.join(root, 'brandthread-logo.png'));
fs.writeFileSync(path.join(root, 'index.html'), '<html><body>APP</body></html>');
// Both badges on: the worst case for fit.
writeLandingPage(root, projectRoot, {
  EXPO_PUBLIC_APP_STORE_URL: 'https://apps.apple.com/app/id0000000000',
  EXPO_PUBLIC_PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=example',
});
const port = 39800 + Math.floor(Math.random() * 150);
const server = spawn(process.execPath, [path.join(projectRoot, 'server/serve.js')], {
  env: { ...process.env, PORT: String(port), EXPO_WEB_BUILD_DIR: root },
  stdio: 'ignore',
});

function inPage() {
  const problems = [];
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${(el.textContent || '').trim().slice(0, 28)}"`;
  const px = (v) => parseFloat(v) || 0;
  const visible = (el) => el.getClientRects().length > 0;
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw) problems.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`);

  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el) || el.closest('.skip')) continue;
    const cs = getComputedStyle(el);
    if (hasOwnText(el)) {
      if (el.scrollWidth > el.clientWidth + 0.5 && cs.display !== 'inline') problems.push(`text overflows its box: ${label(el)}`);
      if (cs.textOverflow !== 'clip') problems.push(`text-overflow set: ${label(el)}`);
      if (px(cs.fontSize) < 12) problems.push(`font under 12px: ${label(el)}`);
    }
    const parent = el.parentElement;
    if (parent && parent !== document.body && parent !== document.documentElement && cs.position !== 'absolute') {
      const a = el.getBoundingClientRect();
      const b = parent.getBoundingClientRect();
      if (a.width && (a.left < b.left - 0.5 || a.right > b.right + 0.5)) problems.push(`box leaves parent horizontally: ${label(el)}`);
    }
  }

  for (const el of document.querySelectorAll('.btn, .badge, .screen li')) {
    const cs = getComputedStyle(el);
    const min = 12;
    if (px(cs.paddingLeft) < min || px(cs.paddingRight) < min) problems.push(`inner padding < ${min}px: ${label(el)}`);
    const text = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (Math.abs((r.left + r.right) / 2 - (text.left + text.right) / 2) > 1.5) problems.push(`text not centred horizontally: ${label(el)}`);
    if (Math.abs((r.top + r.bottom) / 2 - (text.top + text.bottom) / 2) > 1.5) problems.push(`text not centred vertically: ${label(el)}`);
  }
  for (const el of document.querySelectorAll('.card')) {
    const cs = getComputedStyle(el);
    if (px(cs.paddingLeft) < 16 || px(cs.paddingRight) < 16) problems.push(`card padding < 16px: ${label(el)}`);
  }

  for (const group of document.querySelectorAll('.ctas, .badges')) {
    const items = [...group.children].map((c) => c.querySelector('a') || c).map((c) => c.getBoundingClientRect());
    const w = new Set(items.map((r) => Math.round(r.width)));
    const h = new Set(items.map((r) => Math.round(r.height)));
    if (w.size > 1) problems.push(`unequal widths in ${group.className}: ${[...w]}`);
    if (h.size > 1) problems.push(`unequal heights in ${group.className}: ${[...h]}`);
  }
  // Same row: CTA buttons and badges share one height.
  const heights = new Set([...document.querySelectorAll('.hero .btn, .hero .badge')].map((e) => Math.round(e.getBoundingClientRect().height)));
  if (heights.size > 1) problems.push(`hero buttons and badges differ in height: ${[...heights]}`);

  for (const h of document.querySelectorAll('.steps h3, .steps p')) {
    const cs = getComputedStyle(h);
    const lh = px(cs.lineHeight) || px(cs.fontSize) * 1.5;
    if (h.getBoundingClientRect().height > lh * 1.3) problems.push(`step text wraps: ${label(h)}`);
  }

  // Orphans: last line holds a single word.
  for (const el of document.querySelectorAll('h1, h2, h3, p, .foot a')) {
    if (!visible(el)) continue;
    const words = (el.textContent || '').trim().split(/\s+/);
    if (words.length < 3) continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const last = nodes[nodes.length - 1];
    const tail = last.textContent.replace(/\s+$/, '');
    const start = tail.search(/\S+$/);
    const r1 = document.createRange();
    r1.setStart(last, start);
    r1.setEnd(last, tail.length);
    const lastTop = r1.getBoundingClientRect().top;
    const r2 = document.createRange();
    r2.setStart(last, Math.max(0, start - 1));
    r2.setEnd(last, start);
    const prevTop = r2.getBoundingClientRect().top;
    if (lastTop > prevTop + 2) problems.push(`orphan word "${tail.slice(start)}": ${label(el)}`);
  }
  return problems;
}

let failed = false;
try {
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${port}/status`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const [name, viewport, mobile] of [['393x852', { width: 393, height: 852 }, true], ['1440x900', { width: 1440, height: 900 }, false]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const problems = await page.evaluate(inPage);
    console.log(`${name}: ${problems.length ? 'FAIL' : 'ok'}`);
    for (const p of problems) console.log(`  - ${p}`);
    if (problems.length) failed = true;
    if (shotsDir) {
      fs.mkdirSync(shotsDir, { recursive: true });
      const targets = [
        ['cards', '.cards'],
        ['hero-buttons', '.hero .ctas'],
        ['hero-badges', '.hero .badges'],
        ['sell-steps', '.steps'],
        ['final-buttons', '.final .ctas'],
        ['final-badges', '.final .badges'],
        ['footer', 'footer .foot'],
      ];
      for (const [id, selector] of targets) {
        const el = page.locator(selector).first();
        await el.scrollIntoViewIfNeeded();
        const box = await el.boundingBox();
        await page.screenshot({
          path: path.join(shotsDir, `fit-${name}-${id}.png`),
          clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y + (await page.evaluate(() => scrollY)) - 12), width: Math.min(viewport.width, box.width + 24), height: box.height + 24 },
          fullPage: true,
        });
      }
    }
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
  fs.rmSync(root, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
