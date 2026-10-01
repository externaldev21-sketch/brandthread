#!/usr/bin/env node
/**
 * Live verification for Private account / Follow requests / Close friends.
 * Drives the local Expo web dev server in ?bt_preview=buyer mode at 393x852.
 * The preview has no backend, so the three /api/* surfaces these screens read
 * are answered by Playwright route stubs (shapes identical to the real routes);
 * everything rendered is the real app code.
 *
 *   node scripts/private-account-screenshots.mjs --port <N>
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'screenshots/private-account');
const portArg = process.argv.indexOf('--port');
const ORIGIN = `http://localhost:${portArg >= 0 ? process.argv[portArg + 1] : '8187'}`;

const person = (id, name, handle) => ({ userId: id, name, username: handle, handle: `@${handle}`, avatarUrl: null, initials: name.slice(0, 2).toUpperCase(), color: '#64748B', followedAt: '2026-01-01T00:00:00Z', isFollowingBack: false, isFollowing: false, followsMe: false });
const state = { isPrivate: false, requests: [person('u1', 'Maya Chen', 'maya'), person('u2', 'Jordan Lee', 'jordan')], closeFriends: ['u3'] };
const people = [person('u3', 'Ava Stone', 'ava'), person('u4', 'Noah Reed', 'noah'), person('u5', 'Lena Park', 'lena')];
const calls = [];

async function stub(context) {
  // Clerk's remote script is unreachable in the sandbox; its load failure raises the dev LogBox overlay
  // over the screen. Answer it with an inert stub so the preview renders unobstructed.
  await context.route(/clerk\.browser\.js|clerk\.[a-z-]*\.js/, (route) => route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: 'window.Clerk={loaded:true,load:async()=>{},addListener:()=>()=>{},session:null,user:null,client:{sessions:[]},__unstable__onBeforeRequest(){},__unstable__onAfterResponse(){}};',
  }));
  await context.route(/\/api\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace('/api/v1/', '/api/');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    calls.push(`${req.method()} ${p}`);
    if (p === '/api/auth/privacy' && req.method() === 'GET') return json({ dmPrivacy: 'requests', isPrivate: state.isPrivate, canBePrivate: true });
    if (p === '/api/auth/privacy') { const b = req.postDataJSON(); if (typeof b.isPrivate === 'boolean') state.isPrivate = b.isPrivate; return json({ dmPrivacy: 'requests', isPrivate: state.isPrivate }); }
    if (p === '/api/social/follow-requests') return json(state.requests.map(({ userId, name, username, handle, avatarUrl }) => ({ userId, name, username, handle, avatarUrl, requestedAt: '2026-01-01T00:00:00Z' })));
    const m = p.match(/^\/api\/social\/follow-requests\/([^/]+)\/(approve|decline)$/);
    if (m) { state.requests = state.requests.filter((r) => r.userId !== m[1]); return json({ ok: true, status: m[2] === 'approve' ? 'approved' : 'declined' }); }
    if (p === '/api/social/close-friends' && req.method() === 'GET') return json({ friendIds: state.closeFriends, friends: people.filter((x) => state.closeFriends.includes(x.userId)) });
    if (p === '/api/social/close-friends') { state.closeFriends = req.postDataJSON().friendIds; return json({ ok: true, friendIds: state.closeFriends, skipped: [] }); }
    if (p === '/api/social/followers') return json(people);
    if (p === '/api/social/following') return json([]);
    if (p === '/api/social/suggested') return json([]);
    return json([]);
  });
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark', reducedMotion: 'reduce' });
    await stub(context);
    const page = await context.newPage();
    page.on('console', (m) => { if (/api|privacy|request/i.test(m.text()) && m.type() !== 'log') console.log('  [console]', m.text().slice(0, 200)); });
    // Text-fit check: flags any text node that is clipped (scrollWidth > clientWidth), ellipsised,
    // or whose box leaves its parent / the 393px viewport.
    const problems = [];
    const checkFit = async (name) => {
      const found = await page.evaluate(() => {
        const out = [];
        const vw = document.documentElement.clientWidth;
        for (const el of document.querySelectorAll('#root *')) {
          if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          const label = (el.textContent || '').trim().slice(0, 40);
          if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') out.push(`clipped: "${label}"`);
          if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`ellipsis: "${label}"`);
          if (r.right > vw + 0.5 || r.left < -0.5) out.push(`outside viewport: "${label}"`);
          const p = el.parentElement;
          if (p) {
            const pr = p.getBoundingClientRect();
            if (pr.width > 0 && (r.left < pr.left - 1 || r.right > pr.right + 1)) out.push(`overflows parent: "${label}"`);
          }
        }
        return out;
      });
      console.log(`  fit[${name}]:`, found.length === 0 ? 'ok' : found.join(' | '));
      problems.push(...found.map((f) => `${name}: ${f}`));
    };
    const shot = async (name) => {
      await page.waitForTimeout(600); await checkFit(name); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('  ok', name); };
    await page.addInitScript(() => { const st = document.createElement('style'); st.textContent = '#error-toast{display:none !important}'; document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st)); });
    const zoom = async (name, clip) => { await page.screenshot({ path: path.join(OUT, `${name}.png`), clip }); console.log('  ok', name); };
    const dismissCookies = async () => { const b = page.getByText('Accept all').first(); if (await b.isVisible().catch(() => false)) await b.click(); };

    await page.goto(`${ORIGIN}/buyer-privacy-settings?bt_preview=buyer`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.getByText('Private account').first().waitFor({ timeout: 60_000 });
    await dismissCookies();
    await shot('01-privacy-private-off');
    await page.getByRole('switch').first().click();
    await page.waitForTimeout(3500); // api token wait (Clerk is offline in the sandbox) + PATCH
    await shot('02-privacy-private-on');
    await zoom('02z-private-switch-card', { x: 0, y: 140, width: 393, height: 230 });
    console.log('  PATCH sent:', calls.filter((c) => c.startsWith('PATCH')).length > 0, 'isPrivate:', state.isPrivate);

    // In-app navigation (no reload): a reload re-runs Clerk's remote script, which is unreachable here.
    const navTo = async (p) => { await page.evaluate((u) => { window.history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate')); }, p); };
    await navTo('/buyer-friend-requests?bt_preview=buyer');
    await page.getByText('Follow requests').first().waitFor({ timeout: 60_000 }).catch(async (e) => { console.log('  calls:', JSON.stringify(calls)); await page.screenshot({ path: path.join(OUT, 'debug.png') }); throw e; });
    await shot('03-follow-requests');
    await zoom('03z-follow-request-rows', { x: 0, y: 200, width: 393, height: 200 });
    await page.getByText('Confirm').first().click();
    await page.waitForTimeout(3500);
    await shot('04-follow-requests-after-confirm');

    await navTo('/buyer-close-friends?bt_preview=buyer');
    await page.getByText('Ava Stone').first().waitFor({ timeout: 60_000 });
    await shot('05-close-friends');
    await zoom('05z-close-friends-rows', { x: 0, y: 270, width: 393, height: 190 });
    await page.getByText('Noah Reed').first().click();
    await page.getByText('Save').last().click();
    await page.waitForTimeout(3500);
    console.log('  PUT close-friends ids:', JSON.stringify(state.closeFriends));
    if (problems.length) { console.error('TEXT-FIT PROBLEMS:\n' + problems.join('\n')); process.exitCode = 1; }
  } finally {
    await browser.close();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
