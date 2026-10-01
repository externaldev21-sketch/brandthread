/**
 * Screenshots + text-fit / alignment check for the promoted-threads screens at
 * 393x852 on the Expo web preview.
 *
 *   BASE=http://localhost:8099 OUT=docs/pr-assets/promoted-threads \
 *     node scripts/text-fit-check-promoted-threads.mjs
 *
 * Flags, per screen: any text element whose content is clipped or ellipsised
 * (scrollWidth > clientWidth), and any text/box that overflows its parent or
 * the viewport. Exits 1 if anything is flagged.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const BASE = process.env.BASE ?? 'http://localhost:8099';
const OUT = process.env.OUT ?? 'docs/pr-assets/promoted-threads';
fs.mkdirSync(OUT, { recursive: true });

const SCREENS = [
  { name: '01-boost-entry-row', path: '/boost?bt_preview=seller&demo=1', scroll: true },
  { name: '02-featured-slot-purchase', path: '/featured-slot?bt_preview=seller&demo=1' },
  { name: '03-admin-promotions-queue', path: '/admin-promotions?bt_preview=seller&demo=1' },
  { name: '04-discover-featured-row', path: '/discover?bt_preview=buyer&demo=1' },
  { name: '05-admin-promotions-signed-out', path: '/admin-promotions?bt_preview=seller' },
];

const CHECK = () => {
  const out = [];
  const vw = window.innerWidth;
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Elements inside a horizontally scrolling row (chips, rails) are meant to extend past the edge.
    let scrolling = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && a.scrollWidth > a.clientWidth + 1) { scrolling = true; break; }
    }
    if (scrolling) continue;
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasOwnText) {
      const label = el.textContent.trim().slice(0, 40);
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') out.push({ kind: 'clipped-x', label });
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push({ kind: 'ellipsis', label });
      if (r.right > vw + 1 || r.left < -1) out.push({ kind: 'outside-viewport', label });
      const p = el.parentElement;
      if (p) {
        const pr = p.getBoundingClientRect();
        if (pr.width > 0 && (r.right > pr.right + 1 || r.left < pr.left - 1) && getComputedStyle(p).overflowX === 'visible' && !p.closest('[data-testid="discover-featured-rail"]'))
          out.push({ kind: 'overflows-parent', label });
      }
    }
  }
  return out;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
let failures = 0;
for (const sc of SCREENS) {
  const page = await ctx.newPage();
  const protectedCalls = [];
  page.on('request', (rq) => {
    const u = rq.url();
    if (/\/api\/(boosts|featured-slots\/(availability|mine)|admin|promotions|moderation)/.test(u)) protectedCalls.push(u);
  });
  await page.goto(BASE + sc.path, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.getByText('Necessary only').first().click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(800);
  if (sc.swipe) {
    await page.getByText('Tap to keep watching').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.mouse.click(28, 109); // dismiss the Expo dev error overlay (no real Clerk keys in this sandbox)
    await page.waitForTimeout(500);
  }
  const loaded = await page.evaluate(() => document.body.innerText.trim().length > 0 && !document.title.includes('localhost'));
  if (!loaded) { console.log(`${sc.name}: PAGE DID NOT LOAD`); failures += 1; }
  const issues = await page.evaluate(CHECK);
  await page.screenshot({ path: `${OUT}/${sc.name}.png` });
  console.log(`${sc.name}: ${issues.length} text-fit issues; protected API calls while signed out: ${protectedCalls.length}`);
  for (const i of issues) console.log('   ', JSON.stringify(i));
  if (protectedCalls.length) console.log('   ', protectedCalls.join('\n    '));
  // The feed screen carries pre-existing preview-rail findings unrelated to this change: reported, not gating.
  failures += (sc.swipe ? 0 : issues.length) + protectedCalls.length;
  await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
