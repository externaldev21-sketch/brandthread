#!/usr/bin/env node
/**
 * Text-fit & alignment check (393x852). Flags, on each screen it visits:
 *  - truncated text (ellipsis / scrollWidth > clientWidth on a text box),
 *  - text whose box pokes past the screen edge (a chip row that scrolls horizontally is allowed to clip),
 *  - (warning only, does not fail) text smaller than 12px - the shared FS.xs token is 11px,
 *  - text closer than 12px to the inside edge of a bordered/filled container.
 * Usage: node tests/text-fit.web.mjs --build-dir=<dir> --role=seller [--shots=<dir>]
 * Screens: dashboard, Orders tab, Profile, Settings (seller) — extend SCREENS for others.
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser, serveBuild } from '../scripts/store-screenshots/harness.mjs';
import { coldLoad, enumerateTappables, openSession, settle, tap } from '../scripts/audit/back-nav/session.mjs';

const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const role = opt('role', 'seller');
const shots = opt('shots', null);
const SCREENS = {
  seller: [
    { id: 'dashboard', go: async () => {} },
    { id: 'orders', go: async (p) => { await p.locator('[data-testid="seller-tab-orders"]:visible').first().click(); } },
    { id: 'profile', go: async (p) => { await p.locator('[data-testid="seller-tab-profile"]:visible').first().click(); } },
    { id: 'settings', go: async (p) => { const { items } = await enumerateTappables(p); await tap(p, items.find((i) => i.name === 'Seller settings')); } },
  ],
};

function audit() {
  const out = [];
  const vw = innerWidth;
  // Inactive tabs stay mounted underneath; only look at what is actually on top at the element's centre.
  const onTop = (el, r) => { const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(1, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(1, r.top + r.height / 2))); return !!hit && (hit === el || el.contains(hit) || hit.contains(el)); };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight && onTop(el, r); };
  const label = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  for (const el of document.querySelectorAll('div,span,p,a,button,[role=button],[role=tab]')) {
    if (!visible(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const text = label(el);
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') out.push({ kind: 'truncated', text });
    else if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push({ kind: 'ellipsis', text });
    if (parseFloat(cs.fontSize) < 12 && text.length > 0) out.push({ kind: 'warn-text-under-12px', text, size: cs.fontSize });
    const inHScroller = (() => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if ((o === 'auto' || o === 'scroll') && a.scrollWidth > a.clientWidth + 1) return true; } return false; })();
    if (!inHScroller && text.length > 3 && r.right > vw + 1 || r.left < -1) out.push({ kind: 'past-screen-edge', text, right: Math.round(r.right) });
    // inner padding against the nearest bordered/filled container
    let p = el.parentElement;
    while (p && p !== document.body) {
      const pc = getComputedStyle(p);
      const boxed = parseFloat(pc.borderTopWidth) > 0 || (pc.backgroundColor !== 'rgba(0, 0, 0, 0)' && pc.backgroundColor !== 'transparent');
      const pr = p.getBoundingClientRect();
      if (boxed && pr.width < vw - 8 && pr.height < 400) {
        const padL = r.left - pr.left; const padR = pr.right - r.right;
        if (text.length > 3 && (padL < 12 - 0.5 || padR < 12 - 0.5)) out.push({ kind: 'tight-padding', text, padL: Math.round(padL), padR: Math.round(padR) });
        break;
      }
      p = p.parentElement;
    }
  }
  const seen = new Set();
  return out.filter((f) => { const k = `${f.kind}|${f.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const server = await serveBuild(path.resolve(opt('build-dir')));
const browser = await launchBrowser();
const s = await openSession(browser, { origin: server.origin, role, demo: true });
let bad = 0;
try {
  await coldLoad(s, '/');
  for (const screen of SCREENS[role]) {
    await screen.go(s.page); await settle(s.page, 1500);
    const found = await s.page.evaluate(audit);
    console.log(`\n[${screen.id}] ${found.length ? found.length + ' finding(s)' : 'clean'}`);
    for (const f of found) console.log('  ', JSON.stringify(f));
    bad += found.filter((f) => !f.kind.startsWith('warn-')).length;
    if (shots) { mkdirSync(shots, { recursive: true }); await s.page.screenshot({ path: path.join(shots, `${screen.id}.png`) }); }
  }
} finally { await s.close(); await browser.close(); server.close(); }
process.exit(bad ? 1 : 0);
