#!/usr/bin/env node
/**
 * Text-fit & alignment check for the live moderation / co-host screens at
 * 393x852 on the web preview (`&demo=1`, no API). Fails (exit 1) when any of:
 *
 *  - a text element is clipped (scrollWidth > clientWidth) or ellipsised
 *  - an element's box overflows its parent's box
 *  - text sits closer than 12px to the left/right edge of its button/chip
 *  - buttons that share a row have different width or height
 *  - the row action buttons (Unmute / Unban / Remove / Invite / Invited) differ in width
 *  - any console error or page error (incl. React nested-button / DOM nesting)
 *
 * It also saves zoomed (3x) crops of every button group to
 * docs/pr-assets/claude/live-moderation-cohost/.
 *
 *   node tests/live-moderation-cohost-fit.web.mjs [--skip-build]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from '../scripts/store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForQuietNetwork,
} from '../scripts/store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/claude/live-moderation-cohost');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SCREENS = [
  ['moderation', '/live-moderation?demo=1&streamId=demo', 'Moderation'],
  ['cohost', '/live-cohost?demo=1&streamId=demo', 'Co-host'],
  ['invitee', '/live-cohost-invite?demo=1', 'Co-host invites'],
];
const ROW_ACTIONS = ['Unmute', 'Unban', 'Remove', 'Invite', 'Invited'];

/** Runs inside the page; returns a list of problem strings and button group boxes. */
function scan({ rowActions, title }) {
  const problems = [];
  const label = (el) => `${el.tagName.toLowerCase()}"${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`;
  // Earlier screens stay mounted under the pushed one: scope to this screen's own root
  // (the parent of its ScreenHeader), so only what the user sees is checked.
  const header = [...document.querySelectorAll('[data-testid="screen-header"]')].find((h) => h.innerText.replace(/[\s\u200b-\u200f\u2060\ufeff\ue000-\uf8ff]/g, '') === title.replace(/\s/g, ''));
  if (!header) return { problems: [`screen "${title}" not found (headers: ${[...document.querySelectorAll('[data-testid="screen-header"]')].map((h) => JSON.stringify(h.innerText) + [...h.innerText].map((c) => c.charCodeAt(0)).join(',')).join(' | ')} title=${JSON.stringify(title)})`], groupBoxes: [] };
  const root = header.parentElement;
  const all = [...root.querySelectorAll('*')].filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed');

  for (const el of all) {
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const cs = getComputedStyle(el);
    if (hasOwnText) {
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`clipped text (scrollWidth ${el.scrollWidth} > ${el.clientWidth}): ${label(el)}`);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) problems.push(`ellipsis: ${label(el)}`);
    }
    const parent = el.parentElement;
    if (parent && parent !== document.body && cs.position !== 'absolute' && cs.position !== 'fixed') {
      const pcs = getComputedStyle(parent);
      const scrolls = /(auto|scroll)/.test(pcs.overflowX + pcs.overflowY);
      const r = el.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      if (!scrolls && r.width > 0 && pr.width > 0 && (r.left < pr.left - 1 || r.right > pr.right + 1)) {
        problems.push(`box overflows parent horizontally: ${label(el)} [${Math.round(r.left)}..${Math.round(r.right)}] in ${label(parent)} [${Math.round(pr.left)}..${Math.round(pr.right)}]`);
      }
    }
  }

  // Padding: text inside a button/chip must keep >= 12px from its left and right edge.
  const buttons = all.filter((el) => ['button', 'radio'].includes(el.getAttribute('role')) && el.innerText.trim());
  for (const b of buttons) {
    // Rect of the label's own text node, not of the whole button subtree.
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent.trim()) node = walker.nextNode();
    if (!node) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const t = range.getBoundingClientRect();
    // The visible pill is the button's first child (the Pressable wrapper can be larger).
    const pill = b.firstElementChild && b.firstElementChild.children.length > 0 ? b.firstElementChild : b;
    const r = pill.getBoundingClientRect();
    if (t.left - r.left < 11.5 || r.right - t.right < 11.5) problems.push(`text closer than 12px to edge: ${label(b)} (${Math.round(t.left - r.left)} / ${Math.round(r.right - t.right)})`);
    const cy = (t.top + t.bottom) / 2 - (r.top + r.bottom) / 2;
    if (Math.abs(cy) > 2) problems.push(`text not vertically centred: ${label(b)} (${cy.toFixed(1)}px)`);
  }

  // Buttons sharing a row (same parent) must be equal width and height.
  const groups = new Map();
  for (const b of buttons) {
    const key = b.parentElement;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const groupBoxes = [];
  for (const [, list] of groups) {
    const rects = list.map((b) => b.getBoundingClientRect());
    if (list.length >= 2) {
      const w = rects.map((r) => Math.round(r.width));
      const h = rects.map((r) => Math.round(r.height));
      if (Math.max(...w) - Math.min(...w) > 1) problems.push(`unequal button widths in a row: ${list.map(label).join(', ')} ${w}`);
      if (Math.max(...h) - Math.min(...h) > 1) problems.push(`unequal button heights in a row: ${list.map(label).join(', ')} ${h}`);
    }
    const left = Math.min(...rects.map((r) => r.left)), right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top)), bottom = Math.max(...rects.map((r) => r.bottom));
    groupBoxes.push({ x: left, y: top, width: right - left, height: bottom - top });
  }

  // Row action buttons across rows share one width.
  const rowBtns = buttons.filter((b) => rowActions.includes(b.innerText.trim()));
  if (rowBtns.length >= 2) {
    const w = rowBtns.map((b) => Math.round(b.getBoundingClientRect().width));
    if (Math.max(...w) - Math.min(...w) > 1) problems.push(`row action buttons differ in width: ${rowBtns.map((b) => b.innerText.trim())} ${w}`);
  }
  return { problems, groupBoxes };
}

mkdirSync(OUT, { recursive: true });
if (!process.argv.includes('--skip-build')) buildPreviewWeb();
const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
const server = await serveBuild(DEFAULT_BUILD_DIR);
const origin = server.origin;
let failed = 0;
try {
  for (const [name, target, title] of SCREENS) {
    const device = { viewport: VIEWPORT, scale: 3, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text().slice(0, 200)}`);
    });
    await page.addInitScript(() => localStorage.setItem('bt:intro-splash:launched:v1', 'true'));
    for (let attempt = 0; attempt < 3; attempt++) {
      await openScreen(page, activity, origin, 'seller', target);
      const ok = await page.waitForFunction(
        (t) => [...document.querySelectorAll('[data-testid="screen-header"]')].some((h) => h.innerText.includes(t)),
        title, { timeout: 12_000 },
      ).then(() => true).catch(() => false);
      if (ok) break;
    }
    await page.waitForTimeout(1200);
    await waitForQuietNetwork(activity);

    const { problems, groupBoxes } = await page.evaluate(scan, { rowActions: ROW_ACTIONS, title });
    const all = [...problems, ...errors];
    console.log(`${all.length ? 'FAIL' : 'ok  '} ${name}`);
    for (const p of all) console.log('   - ' + p);
    failed += all.length;

    let i = 0;
    for (const box of groupBoxes) {
      if (box.width <= 0 || box.height <= 0) continue;
      const pad = 8;
      const clip = {
        x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
        width: Math.min(VIEWPORT.width, box.width + pad * 2), height: Math.min(VIEWPORT.height - Math.max(0, box.y - pad), box.height + pad * 2),
      };
      if (clip.width <= 0 || clip.height <= 0) continue;
      await page.screenshot({ path: path.join(OUT, `zoom-${name}-${String(++i).padStart(2, '0')}.png`), clip });
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failed) { console.log(`\n${failed} problem(s)`); process.exit(1); }
console.log('\nText-fit check passed.');
