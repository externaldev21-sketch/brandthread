/**
 * TEXT-FIT & ALIGNMENT check (Dev's mandatory UI pass), run against a running
 * Expo web server at 393x852.
 *
 * Flags, per screen:
 *  - clipped/ellipsised text (scrollWidth > clientWidth, scrollHeight > clientHeight,
 *    or text-overflow: ellipsis that is actually truncating)
 *  - text (or its element) sticking out of its container or off the screen
 *  - too little inner padding: < 12px in buttons/chips (container < 80px tall),
 *    < 16px in cards
 *  - a label that wraps to 2+ lines while its row siblings stay on one (step
 *    trackers, tab rows, chips)
 *  - buttons/chips in one row with different widths or heights
 *  - a horizontal scroller whose last item touches the screen edge
 *
 * Usage:
 *   TEXT_FIT_BASE=http://localhost:8171 node tests/text-fit.web.mjs \
 *     '[["buyer-detail","/buyer-order-detail?id=preview-order-01&bt_preview=buyer&demo=1"]]'
 * Exit code 1 when anything is flagged. Screenshots go to TEXT_FIT_OUT (default ./text-fit-out).
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(process.env.TEXT_FIT_REQUIRE_FROM ?? import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.TEXT_FIT_BASE ?? 'http://localhost:8171';
const OUT = process.env.TEXT_FIT_OUT ?? './text-fit-out';
const SCREENS = JSON.parse(process.argv[2] ?? '[]'); // [[name, path, waitMs?]]
mkdirSync(OUT, { recursive: true });

function inPage() {
  const W = window.innerWidth;
  const issues = [];
  const rect = (el) => el.getBoundingClientRect();
  const visible = (el) => {
    const cs = getComputedStyle(el);
    const r = rect(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.width > 0 && r.height > 0;
  };
  const label = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const add = (kind, el, detail) => issues.push({ kind, text: label(el), detail });
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const textRect = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
  };
  const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
  const container = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p); const r = rect(p);
      const boxed = parseFloat(cs.borderLeftWidth) > 0 || alpha(cs.backgroundColor) > 0.04;
      if (boxed && r.width < W - 1) return p;
    }
    return null;
  };

  // The web preview's own "Customize" widget is not app UI.
  const isDevOnly = (el) => /^Customize$/.test((el.innerText || '').trim());
  const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return true; } return false; };
  const inFixed = (el) => { for (let p = el; p; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') return true; return false; };

  const texts = [...document.querySelectorAll('body *')].filter((el) => hasOwnText(el) && visible(el) && !inFixed(el) && !isDevOnly(el));
  const boxes = new Map(); // container -> text elements inside
  for (const el of texts) {
    const cs = getComputedStyle(el);
    const r = rect(el);
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') add('clipped-x', el, `${el.scrollWidth}>${el.clientWidth}`);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) add('ellipsis', el, 'label truncated');
    const webkitClamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    if (webkitClamp && el.scrollHeight > el.clientHeight + 1) add('clamped', el, 'text cut by line clamp');
    if ((r.right > W + 0.5 || r.left < -0.5) && !inScroller(el)) add('off-screen', el, `x ${Math.round(r.left)}..${Math.round(r.right)}`);
    const box = container(el);
    if (box) { const list = boxes.get(box) ?? []; list.push(el); boxes.set(box, list); }
  }
  // Per container: all content (text + icons) must fit inside with padding, and sit centred.
  for (const [box, els] of boxes) {
    const b = rect(box);
    const rects = els.map(textRect).concat([...box.querySelectorAll('svg, img')].filter(visible).map(rect));
    const u = { left: Math.min(...rects.map((x) => x.left)), right: Math.max(...rects.map((x) => x.right)), top: Math.min(...rects.map((x) => x.top)), bottom: Math.max(...rects.map((x) => x.bottom)) };
    const name = els[0];
    if (u.left < b.left - 0.5 || u.right > b.right + 0.5 || u.top < b.top - 0.5 || u.bottom > b.bottom + 0.5) {
      add('overflows-container', name, `content ${Math.round(u.left)}-${Math.round(u.right)} box ${Math.round(b.left)}-${Math.round(b.right)}`); continue;
    }
    const min = b.height < 80 ? 12 : 16;
    const left = u.left - b.left; const right = b.right - u.right;
    const centred = Math.abs(left - right) < 2;
    if (!centred && (left < min - 0.5 || right < min - 0.5) && b.width > 24) add('tight-padding', name, `left ${left.toFixed(0)} right ${right.toFixed(0)} (min ${min})`);
    if (b.height < 64 && !inScroller(box) && Math.abs((u.top - b.top) - (b.bottom - u.bottom)) > 4) add('not-v-centred', name, `top ${(u.top - b.top).toFixed(0)} bottom ${(b.bottom - u.bottom).toFixed(0)}`);
  }

  // Row siblings: one label wraps while others don't; buttons with unequal size.
  const rows = new Set([...document.querySelectorAll('body *')].filter((el) => {
    const cs = getComputedStyle(el);
    return cs.display === 'flex' && cs.flexDirection === 'row' && el.children.length >= 2;
  }));
  for (const row of rows) {
    const kids = [...row.children].filter(visible);
    if (kids.length < 2 || inFixed(row) || inScroller(row) || kids.some((k) => /^Customize$/.test((k.innerText || '').trim()))) continue;
    const lineCount = (el) => {
      const t = [...el.querySelectorAll('*')].concat(el).filter(hasOwnText)[0];
      if (!t) return 0;
      const lh = parseFloat(getComputedStyle(t).lineHeight) || parseFloat(getComputedStyle(t).fontSize) * 1.3;
      return Math.round(rect(t).height / lh);
    };
    const counts = kids.map(lineCount).filter((n) => n > 0);
    if (kids.length >= 3 && counts.length >= 3 && Math.max(...counts) > 1 && Math.min(...counts) === 1) {
      kids.forEach((k) => { if (lineCount(k) > 1) add('wraps-in-row', k, `${lineCount(k)} lines beside one-line siblings`); });
    }
    const buttons = kids.filter((k) => k.getAttribute('role') === 'button' || k.tagName === 'BUTTON' || k.getAttribute('tabindex') === '0');
    if (buttons.length >= 2 && buttons.length === kids.length) {
      const ws = buttons.map((b) => Math.round(rect(b).width)); const hs = buttons.map((b) => Math.round(rect(b).height));
      if (Math.max(...ws) - Math.min(...ws) > 2) add('unequal-widths', buttons[0], `widths ${ws.join('/')}`);
      if (Math.max(...hs) - Math.min(...hs) > 2) add('unequal-heights', buttons[0], `heights ${hs.join('/')}`);
    }
  }
  // Horizontal scrollers: last item must not touch the edge when it fits.
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && el.children.length) {
      const inner = el.firstElementChild; const last = inner?.lastElementChild;
      if (last && el.scrollLeft === 0 && el.scrollWidth - (rect(last).right - rect(el).left + el.scrollLeft) < 8) add('scroller-edge', el, 'last chip has no end padding');
    }
  });
  return issues;
}

const browser = await chromium.launch({ executablePath: process.env.TEXT_FIT_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
let failures = 0;
for (const [name, path, wait] of SCREENS) {
  await page.goto(BASE + path, { waitUntil: 'load', timeout: 240000 });
  await page.waitForTimeout(wait ?? 15000);
  await page.addStyleTag({ content: '#error-overlay{display:none!important}' }).catch(() => {});
  await page.mouse.click(309, 816).catch(() => {}); // dismiss the sandbox-only Clerk toast
  await page.waitForTimeout(300);
  const issues = await page.evaluate(inPage);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  failures += issues.length;
  console.log(`${issues.length ? 'FAIL' : 'ok  '} ${name}${issues.length ? '' : ''}`);
  for (const i of issues) console.log(`   - [${i.kind}] "${i.text}" ${i.detail}`);
}
await browser.close();
process.exit(failures ? 1 : 0);