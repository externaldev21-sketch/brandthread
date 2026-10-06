/**
 * QA audit "fake features" verification (QA-0002/0006, 0108/0109/0111,
 * 0079, 0362, 0234). Drives the web preview build with a signed-in demo
 * buyer and a fake API, asserting the real API calls are made (and success
 * is only reported on success), then captures 390x844 screenshots.
 *
 * Run:  node scripts/store-screenshots/qa-fake-features-verify.mjs [--skip-build]
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { clerkStubScript } from './clerk-stub.mjs';
import { BUYER_USER, DEMO_NOW, DEMO_TIME_ZONE, localStorageSeed, respond } from './demo-data.mjs';
import { MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, serveBuild } from './harness.mjs';

const BUILD_DIR = path.join(WORK_DIR, 'qa-fake-features-build');

const OUT = path.resolve(MOBILE_ROOT, '../../screenshots/qa-fake-features');
mkdirSync(OUT, { recursive: true });

const DEVICE = { viewport: { width: 390, height: 844 }, scale: 2 };
const DEMO_API = 'https://api.brandthread.test';
const STREAM_ID = '7b6c1a52-4c1e-4d7e-9a43-2f1d9b3f0a11';
const HOST_ID = 'seller_northline_live';
const POST_UUID = '0f8e6b2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b';

const failures = [];
function check(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures.push(label);
}

async function openPage(browser, origin, { cookieConsent = true, overrides = () => undefined, calls = [] } = {}) {
  const context = await browser.newContext({
    viewport: DEVICE.viewport, deviceScaleFactor: DEVICE.scale, isMobile: true, hasTouch: true,
    locale: 'en-US', timezoneId: DEMO_TIME_ZONE, colorScheme: 'dark', reducedMotion: 'reduce',
  });
  await context.clock.install({ time: DEMO_NOW });
  await context.addInitScript(clerkStubScript(BUYER_USER));
  const seed = localStorageSeed('buyer');
  if (!cookieConsent) delete seed['bt:cookie-consent'];
  seed.user_role = 'buyer';
  await context.addInitScript((s) => {
    if (sessionStorage.getItem('bt:seeded')) return;
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    sessionStorage.setItem('bt:seeded', '1');
  }, seed);
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (url.origin !== DEMO_API) return route.abort();
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const p = url.pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '');
    let body = null;
    try { body = request.postDataJSON(); } catch {}
    calls.push({ method: request.method(), path: p, body });
    const custom = overrides({ method: request.method(), path: p, query: url.searchParams, body });
    if (custom) {
      return route.fulfill({ status: custom.status ?? 200, headers: cors, contentType: 'application/json', body: JSON.stringify(custom.body ?? {}) });
    }
    const fallback = respond({ method: request.method(), path: url.pathname, query: url.searchParams, role: 'buyer', options: {} });
    if (fallback === undefined) {
      return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"code":"NOT_SEEDED","message":"Not part of the demo data"}}' });
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(fallback) });
  });
  const page = await context.newPage();
  globalThis.__lastPage = page;
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  return { context, page };
}

async function liveFeed(browser, origin) {
  const calls = [];
  let giftStatus = 200;
  const comments = [{ id: 'c1', display_name: 'Jules', message: 'that drape though', created_at: '2026-10-06T10:00:00.000Z' }];
  const overrides = ({ method, path: p, body }) => {
    if (p === '/live/active') {
      return { body: { streams: [{ id: STREAM_ID, seller_id: HOST_ID, brand_name: 'Northline Studio', title: 'Drop 05 walkthrough', viewer_count: 312 }] } };
    }
    if (p === `/live/${STREAM_ID}/comments`) return { body: { comments: [...comments].reverse() } };
    if (p === `/live/${STREAM_ID}/comment` && method === 'POST') {
      const c = { id: `c${comments.length + 1}`, display_name: 'Jordan', message: body.message, created_at: '2026-10-06T10:01:00.000Z' };
      comments.push(c);
      return { status: 201, body: { comment: c } };
    }
    if (p === `/social/status/${HOST_ID}`) return { body: { isFollowing: true, isFollowedBy: false, isMutual: false, followersCount: 10 } };
    if (p === '/thread-cash' || p === '/thread-cash/status') return { body: { balanceCents: 2500, config: {} } };
    if (p === '/thread-cash/live-gift') {
      return giftStatus === 200 ? { body: { ok: true, giftId: 'g1' } } : { status: giftStatus, body: { error: 'Not enough Thread Cash' } };
    }
    return undefined;
  };
  const { context, page } = await openPage(browser, origin, { overrides, calls });
  await page.goto(`${origin}/live-feed`, { waitUntil: 'networkidle' });
  await page.getByText('Northline Studio').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  check(await page.getByText('Following', { exact: true }).count() > 0, 'QA-0109 Follow pill starts from the real follow state (Following)');
  check(calls.some((c) => c.path === `/live/${STREAM_ID}/comments`), 'QA-0108 live chat is read from GET /api/live/:id/comments');
  check(await page.getByText('that drape though').count() > 0, 'QA-0108 server chat line is shown');
  await page.screenshot({ path: path.join(OUT, 'live-feed-real-room.png') });

  await page.getByText('Following', { exact: true }).first().click();
  await page.waitForTimeout(600);
  check(calls.some((c) => c.method === 'DELETE' && c.path === `/social/follow/${HOST_ID}`), 'QA-0109 unfollow calls DELETE /api/social/follow/:id');

  const input = page.getByTestId('live-feed-composer').locator('textarea, input').first();
  await input.fill('is this restocking in M?');
  await input.press('Enter');
  await page.waitForTimeout(800);
  const sent = calls.find((c) => c.method === 'POST' && c.path === `/live/${STREAM_ID}/comment`);
  check(!!sent && sent.body?.message === 'is this restocking in M?', 'QA-0108 sending chat calls POST /api/live/:id/comment');
  await page.screenshot({ path: path.join(OUT, 'live-feed-chat-sent.png') });

  // Thread Cash: failure first — must NOT report success.
  giftStatus = 402;
  await page.getByLabel('Send Thread Cash').first().click();
  await page.getByTestId('live-thread-cash-sheet').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.getByText('$5.00', { exact: true }).first().click();
  await page.getByRole('button', { name: /^Send/ }).last().click();
  await page.waitForTimeout(800);
  check(calls.some((c) => c.path === '/thread-cash/live-gift' && c.body?.streamId === STREAM_ID), 'QA-0111 Thread Cash send calls POST /api/thread-cash/live-gift with the stream id');
  check(await page.getByText(/You sent \$5\.00/).count() === 0, 'QA-0111 a failed gift is not reported as sent');
  check(await page.getByTestId('live-thread-cash-error').count() > 0, 'QA-0111 a failed gift shows its error in the sheet');
  await page.screenshot({ path: path.join(OUT, 'live-feed-thread-cash-failed.png') });
  giftStatus = 200;
  await page.getByText('$5.00', { exact: true }).first().click();
  await page.getByRole('button', { name: /^Send/ }).last().click();
  await page.waitForTimeout(800);
  check(await page.getByText(/sent \$5\.00 Thread Cash/).count() > 0, 'QA-0111 a successful gift is reported');
  await page.screenshot({ path: path.join(OUT, 'live-feed-thread-cash-sent.png') });
  await context.close();
}

async function discover(browser, origin) {
  const calls = [];
  const overrides = ({ path: p, query }) => {
    if (p === '/social/status/seller_northline') return { body: { isFollowing: true, isFollowedBy: false, isMutual: false, followersCount: 10 } };
    if (p === '/public/trending') {
      const base = respond({ method: 'GET', path: '/api/public/trending', query, role: 'buyer', options: {} });
      const rows = base.trending.map((r, i) => (i === 0 ? { ...r, id: POST_UUID } : r));
      return { body: { trending: rows } };
    }
    return undefined;
  };
  const { context, page } = await openPage(browser, origin, { overrides, calls });
  await page.goto(`${origin}/discover`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const followBtn = page.getByTestId('follow-button').first();
  if (await followBtn.count()) {
    await followBtn.scrollIntoViewIfNeeded();
    await followBtn.click();
    await page.waitForTimeout(800);
    check(calls.some((c) => c.method === 'POST' && c.path === '/social/follow'), 'QA-0362 Discover Follow calls POST /api/social/follow');
    check(await page.getByTestId('follow-button').first().getByText(/Following|Friends/).count() > 0, 'QA-0362 Discover Follow shows Following');
    await page.screenshot({ path: path.join(OUT, 'discover-follow.png') });
  } else {
    check(false, 'QA-0362 a Follow button is on Discover');
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  const tile = page.getByText('Drop 04 is live', { exact: false }).first();
  await tile.click();
  await page.waitForTimeout(1200);
  await page.getByLabel('4,210', { exact: true }).first().click();
  await page.waitForTimeout(500);
  check(calls.some((c) => c.method === 'POST' && c.path === `/posts/${POST_UUID}/interact` && c.body?.type === 'like'), 'QA-0079 Like calls POST /api/posts/:id/interact');
  await page.getByLabel('bookmark').first().click();
  await page.waitForTimeout(500);
  check(calls.some((c) => c.method === 'POST' && c.path === '/buyer/saved' && c.body?.targetId === POST_UUID), 'QA-0079 Save calls POST /api/buyer/saved');
  check(await page.getByText('Following', { exact: true }).count() > 0, 'Discover viewer Follow pill starts from the real follow state');
  await page.screenshot({ path: path.join(OUT, 'discover-viewer-liked-saved.png') });
  await page.getByLabel('Share').first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'discover-viewer-share.png') });
  await context.close();
}

async function cookieSheet(browser, origin) {
  const { context, page } = await openPage(browser, origin, { cookieConsent: false });
  await page.goto(`${origin}/discover`, { waitUntil: 'networkidle' });
  await page.getByTestId('cookie-consent-sheet').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  const box = await page.getByTestId('cookie-consent-sheet').boundingBox();
  check(!!box && Math.abs(box.y + box.height - DEVICE.viewport.height) < 2, 'QA-0234 consent sheet is docked to the bottom edge');
  await page.screenshot({ path: path.join(OUT, 'cookie-consent-sheet.png') });
  await page.getByTestId('cookie-consent-necessary').click();
  await page.waitForTimeout(500);
  check(await page.getByTestId('cookie-consent-sheet').count() === 0, 'QA-0234 sheet closes after a choice');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check(await page.getByTestId('cookie-consent-sheet').count() === 0, 'QA-0234 sheet is shown once (not again after reload)');
  await page.screenshot({ path: path.join(OUT, 'cookie-consent-after-choice.png') });
  await context.close();
}

async function calls(browser, origin) {
  const convId = 'a3c5d7e9-1111-4222-8333-944455556666';
  const peer = { id: 'user_ava', name: 'Ava Stone', initials: 'AS', color: '#555', avatarUrl: null };
  const ringing = (direction) => ({
    id: 'c0ffee00-0000-4000-8000-000000000001', conversationId: convId, mode: 'voice', status: 'ringing', direction,
    callerId: direction === 'incoming' ? 'user_ava' : BUYER_USER.id, calleeId: direction === 'incoming' ? BUYER_USER.id : 'user_ava',
    peer, createdAt: '2026-10-06T10:00:00.000Z', answeredAt: null, endedAt: null, durationSec: null, endReason: null,
  });
  const conversation = ({ path: p }) => {
    if (p === `/conversations/${convId}`) {
      return { body: { id: convId, type: 'buyer_to_buyer', participants: [
        { userId: BUYER_USER.id, name: 'Jordan Reyes', initials: 'JR', color: '#333' },
        { userId: 'user_ava', name: 'Ava Stone', initials: 'AS', color: '#555' },
      ] } };
    }
    if (p === `/conversations/${convId}/messages`) return { body: [] };
    if (p === `/call/dm/conversations/${convId}/calls`) return { body: { calls: [] } };
    return undefined;
  };

  // 1) Placing a call goes to the server; with no Agora keys the server
  //    refuses and the app says so — no simulated ring.
  {
    const callsMade = [];
    const overrides = (req) => {
      if (req.method === 'POST' && req.path === '/call/dm/calls') {
        return { status: 503, body: { error: 'Calling is unavailable because secure call credentials are not configured', code: 'CALLING_NOT_CONFIGURED' } };
      }
      if (req.path === '/call/dm/incoming') return { body: { call: null } };
      return conversation(req);
    };
    const { context, page } = await openPage(browser, origin, { overrides, calls: callsMade });
    await page.goto(`${origin}/buyer-conversation?id=${convId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    check(await page.getByTestId('conversation-call-voice').count() > 0, 'QA-0002 call buttons are shown (not hidden)');
    await page.screenshot({ path: path.join(OUT, 'buyer-conversation-call-buttons.png') });
    await page.getByTestId('conversation-call-voice').first().click();
    await page.waitForTimeout(1500);
    const create = callsMade.find((c) => c.method === 'POST' && c.path === '/call/dm/calls');
    check(!!create && create.body?.conversationId === convId && create.body?.mode === 'voice', 'QA-0002 placing a call creates a server call (POST /api/call/dm/calls)');
    check(await page.getByText(/Calling isn’t available right now/).count() > 0, 'QA-0002 a refused call says why instead of faking a ring');
    await page.screenshot({ path: path.join(OUT, 'call-refused-not-configured.png') });
    await context.close();
  }

  // 2) A ringing call from the other person shows the incoming screen
  //    anywhere in the app; Decline is recorded on the server.
  {
    const callsMade = [];
    const overrides = (req) => {
      if (req.path === '/call/dm/incoming') return { body: { call: ringing('incoming') } };
      if (req.path === `/call/dm/calls/${ringing('incoming').id}`) return { body: { call: ringing('incoming') } };
      if (req.method === 'POST' && req.path === `/call/dm/calls/${ringing('incoming').id}/decline`) {
        return { body: { call: { ...ringing('incoming'), status: 'declined', endedAt: '2026-10-06T10:00:04.000Z', endReason: 'declined' } } };
      }
      return conversation(req);
    };
    const { context, page } = await openPage(browser, origin, { overrides, calls: callsMade });
    await page.goto(`${origin}/discover`, { waitUntil: 'networkidle' });
    await page.getByLabel('Accept call').first().waitFor({ timeout: 20_000 });
    check(await page.getByText('Ava Stone').count() > 0, 'QA-0006 an incoming call from the server rings with the caller’s name');
    await page.screenshot({ path: path.join(OUT, 'call-incoming.png') });
    await page.getByLabel('Decline call').first().click();
    await page.waitForTimeout(1200);
    check(callsMade.some((c) => c.method === 'POST' && c.path === `/call/dm/calls/${ringing('incoming').id}/decline`), 'QA-0006 Decline is recorded on the server (POST …/decline)');
    await page.screenshot({ path: path.join(OUT, 'call-declined.png') });
    await context.close();
  }
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb(BUILD_DIR);
  const { origin, close } = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const runs = { liveFeed, discover, cookieSheet, calls };
  try {
    for (const [name, fn] of Object.entries(runs)) {
      if (only && !only.split(',').includes(name)) continue;
      console.log(`\n── ${name}`);
      try { await fn(browser, origin); } catch (e) { await globalThis.__lastPage?.screenshot({ path: path.join(OUT, `debug-${name}.png`) }).catch(() => {}); check(false, `${name} crashed: ${e.message.split('\n')[0]}`); }
    }
  } finally {
    await browser.close();
    close();
  }
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
