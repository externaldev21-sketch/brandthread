/**
 * Accessibility touch-target scan for the web preview.
 *
 * For each route, reports controls whose effective tap area is under 44×44pt
 * (own box plus its working hitSlop — see shims/web-hit-slop.js — clipped by
 * any overflow-clipping ancestor), controls with no accessible name, and
 * nested-<button> DOM warnings. Elements under aria-hidden are skipped.
 *
 * Needs a running web dev server (`pnpm exec expo start --web --port 8191`).
 * Usage:
 *   node scripts/audit/a11y-touch-scan.mjs <outdir> <S1|S0|B1|B0>[,...] /route [/route ...]
 *   (S1 seller demo, S0 seller fresh, B1 buyer demo, B0 buyer fresh)
 * Env: PORT (default 8191), WAIT (ms after load, default 4500), VERBOSE=1, SHOT=1.
 */




import { chromium } from 'playwright';
import fs from 'node:fs';

// Signed-in preview stub (no network): same shape the repo's other web tests use.
async function stub(ctx, consent = true) {
  await ctx.addInitScript((consent) => {
    const clerkUser = { id: 'user_jordan', primaryEmailAddress: { emailAddress: 'jordan@example.com' } };
    const session = { id: 'sess_demo', user: clerkUser, getToken: async () => 'demo-token' };
    window.Clerk = { loaded: true, user: clerkUser, session, addListener: () => () => {}, load: async () => {}, signOut: async () => {} };
    if (consent) try { localStorage.setItem('bt:cookie-consent', JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false })); } catch {}
  }, consent);
}

const [outdir, modeArg, ...routes] = process.argv.slice(2);
const PORT = process.env.PORT || '8191';
const MODES = { S1: 'bt_preview=seller&demo=1', S0: 'bt_preview=seller', B1: 'bt_preview=buyer&demo=1', B0: 'bt_preview=buyer' };
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch();
const results = {};
for (const mode of modeArg.split(',')) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }); await stub(ctx, !process.env.NOCONSENT);
  for (const route of routes) {
    const page = await ctx.newPage();
    const nested = [];
    page.on('console', (m) => { const t = m.text(); if (/cannot (?:contain a nested|be a descendant of)/i.test(t)) nested.push(t.slice(0, 1500)); });
    const sep = route.includes('?') ? '&' : '?';
    try {
      await page.goto(`http://127.0.0.1:${PORT}${route}${sep}${MODES[mode]}`, { waitUntil: 'load', timeout: 90000 });
    } catch (e) { console.log('nav fail', route, e.message); }
    await page.waitForTimeout(Number(process.env.WAIT || 4500));
    const data = await page.evaluate(() => {
      const out = { small: [], unnamed: [] };
      const sel = 'button, a[href], [role="button"], [role="switch"], [role="link"], [role="checkbox"], [role="tab"], [role="radio"], input, textarea, [tabindex="0"]';
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (el.closest('[aria-hidden="true"]')) continue; // not exposed to assistive tech
        // effective hit area: own rect unioned with hit-slop child
        let L = r.left, T = r.top, R = r.right, B = r.bottom;
        for (const s of el.querySelectorAll(':scope > [data-hitslop]')) {
          const q = s.getBoundingClientRect(); L = Math.min(L, q.left); T = Math.min(T, q.top); R = Math.max(R, q.right); B = Math.max(B, q.bottom);
        }
        // clip the slop by any ancestor that clips overflow (scroll views, overflow:hidden)
        let doneX = false, doneY = false; // past the nearest scroll container an axis is scrolled into view, stop clipping it
        if (!process.env.NOCLIP) for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ac = getComputedStyle(a);
          const q = a.getBoundingClientRect();
          const scrollX = ac.overflowX === 'auto' || ac.overflowX === 'scroll';
          const scrollY = ac.overflowY === 'auto' || ac.overflowY === 'scroll';
          // A scroll container clips to its scrollable content extent along the scroll axis, its box otherwise.
          const cl = scrollX ? q.left - a.scrollLeft : q.left, cr = scrollX ? q.left - a.scrollLeft + a.scrollWidth : q.right;
          const ct = scrollY ? q.top - a.scrollTop : q.top, cb = scrollY ? q.top - a.scrollTop + a.scrollHeight : q.bottom;
          if (!doneX && ac.overflowX !== 'visible') { L = Math.max(L, Math.min(cl, r.left)); R = Math.min(R, Math.max(cr, r.right)); }
          if (!doneY && ac.overflowY !== 'visible') { T = Math.max(T, Math.min(ct, r.top)); B = Math.min(B, Math.max(cb, r.bottom)); }
          if (scrollX) doneX = true; if (scrollY) doneY = true;
        }
        const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder') || '').trim();
        const tag = el.tagName.toLowerCase();
        const isField = tag === 'input' || tag === 'textarea';
        if (!isField && ((R - L) < 43.5 || (B - T) < 43.5)) out.small.push(`${name.slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)} eff ${Math.round(R - L)}x${Math.round(B - T)} @${Math.round(r.left)},${Math.round(r.top)}`);
        if (!name && !el.getAttribute('aria-labelledby')) out.unnamed.push(`${tag}[${el.getAttribute('role') || ''}] ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} testid=${el.getAttribute('data-testid') || ''}`);
      }
      return out;
    });
    data.nested = nested.length;
    data.nestedSample = nested.slice(0, 1);
    const fname = `${mode}__${route.replace(/[^a-z0-9]+/gi, '_')}`;
    if (process.env.SHOT) await page.screenshot({ path: `${outdir}/${fname}.png` });
    results[`${mode} ${route}`] = data;
    console.log(`== ${mode} ${route}: small=${data.small.length} unnamed=${data.unnamed.length} nested=${data.nested}`);
    if (process.env.VERBOSE) { for (const s of data.small) console.log('   S', s); for (const s of data.unnamed) console.log('   U', s); if (nested[0]) console.log('   N', nested[0].slice(0, 600)); }
    await page.close();
  }
  await ctx.close();
}
fs.writeFileSync(`${outdir}/results-${Date.now()}.json`, JSON.stringify(results, null, 1));
await browser.close();
