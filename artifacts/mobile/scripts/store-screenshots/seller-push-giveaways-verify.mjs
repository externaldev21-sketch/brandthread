/**
 * Screenshots + text-fit audit for follower push and giveaways (393x852).
 * Fixtures are served by the page.route below (screenshot harness only; the app ships no fake data).
 *
 * Run:  node scripts/store-screenshots/seller-push-giveaways-verify.mjs
 * Env:  BUILD_DIR=<existing web export> to skip the rebuild.
 */
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../screenshots/seller-push-giveaways');
mkdirSync(OUT, { recursive: true });
const BUILD = process.env.BUILD_DIR || path.join(MOBILE_ROOT, '.store-screenshots', 'web-build');
const DEMO_API = 'https://api.brandthread.test';
const DEVICE = {
  viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const now = Date.now();
const iso = (ms) => new Date(now + ms).toISOString();
const baseGiveaway = {
  id: 'g1', shareCode: 'K7M2QX9A', shareUrl: 'https://brandthread.app/g/K7M2QX9A', sellerId: 'seller_demo',
  title: 'Win the Nord black jacket', prizeText: 'The Nord jacket in any size', productId: null, postId: 'p1',
  startsAt: iso(-2 * 86400e3), endsAt: iso(3 * 86400e3 + 4 * 3600e3), rulesText: 'NO PURCHASE NECESSARY TO ENTER OR WIN. A purchase will not improve your chances of winning.\n\nSponsor: Atelier Nord.',
  eligibility: '', region: 'United States', winnerCount: 2, status: 'open', phase: 'live', drawnAt: null, createdAt: iso(-2 * 86400e3),
};
const winners = [
  { id: 'w1', userId: 'a', position: 1, status: 'active', name: 'Maya Chen', handle: 'mayachen', avatarUrl: null, shippedAt: null, replacedReason: null },
  { id: 'w2', userId: 'b', position: 2, status: 'active', name: 'Jordan Ellis', handle: 'jordane', avatarUrl: null, shippedAt: iso(-3600e3), replacedReason: null },
  { id: 'w0', userId: 'c', position: 2, status: 'replaced', name: 'Sam Rivera', handle: 'samr', avatarUrl: null, shippedAt: null, replacedReason: 'Did not respond in 48 hours' },
];
const state = { push: 'open', giveawayPhase: 'live' };

function fixtures(method, p, body) {
  if (p === '/api/seller/push-broadcasts' && method === 'GET') {
    const history = [{ id: 'b1', title: 'Restock: the black hoodie', body: 'Back in all sizes.', status: 'sent', recipientCount: 412, sentCount: 409, skippedCount: 38, createdAt: iso(-26 * 3600e3) }];
    return state.push === 'open'
      ? { canSendNow: true, nextSendAt: null, limits: { titleMax: 50, bodyMax: 178 }, audience: { followers: 450, recipients: 412 }, history }
      : { canSendNow: false, nextSendAt: iso(21 * 3600e3), limits: { titleMax: 50, bodyMax: 178 }, audience: { followers: 450, recipients: 412 }, history: [{ ...history[0], createdAt: iso(-3 * 3600e3) }] };
  }
  if (p === '/api/seller/push-broadcasts/preview') return { notification: { title: body.title, body: body.body }, audience: { followers: 450, recipients: 412 }, canSendNow: true, nextSendAt: null };
  if (p === '/api/seller/push-broadcasts/b1') return { id: 'b1', title: 'Restock: the black hoodie', body: 'Back in all sizes.', recipientCount: 412, sentCount: 409, skippedCount: 38, opened: 97, createdAt: iso(-26 * 3600e3) };
  if (p === '/api/seller/giveaways') return { giveaways: [{ ...baseGiveaway, entryCount: 184 }, { ...baseGiveaway, id: 'g0', title: 'Spring tee giveaway', phase: 'drawn', status: 'drawn', entryCount: 96 }] };
  if (p === '/api/seller/giveaways/rules-template') return { rulesText: 'NO PURCHASE NECESSARY TO ENTER OR WIN. A purchase will not improve your chances of winning.\n\nSponsor: Atelier Nord. This giveaway is not sponsored, endorsed or administered by Brandthread.\nHow to enter: Follow Atelier Nord on Brandthread and comment on the featured post.' };
  if (p === '/api/seller/giveaways/g1') {
    const phase = state.giveawayPhase;
    const drawn = phase === 'drawn';
    return { ...baseGiveaway, phase, status: drawn ? 'drawn' : 'open', endsAt: phase === 'live' ? baseGiveaway.endsAt : iso(-3600e3),
      entries: { total: 231, eligible: 184 }, winners: drawn ? winners : [],
      draws: drawn ? [{ id: 'd1', drawNumber: 1, eligibleCount: 184, eligibleHash: '9f2c41ab77e0d3c1a8b5', winnerIds: ['a', 'c'], reason: null, drawnAt: iso(-1800e3) }, { id: 'd2', drawNumber: 2, eligibleCount: 182, eligibleHash: '5be10c9d2a7f44e6b801', winnerIds: ['b'], reason: 'Did not respond in 48 hours', drawnAt: iso(-900e3) }] : [] };
  }
  if (p === '/api/posts/mine') return [{ id: 'p1', caption: 'New season lookbook', postStatus: 'published' }, { id: 'p2', caption: 'Behind the seams', postStatus: 'published' }];
  if (p === '/api/giveaways/K7M2QX9A') return { ...baseGiveaway, seller: { id: 'seller_demo', name: 'Atelier Nord', handle: 'ateliernord' }, product: null, requiresComment: true, winners: [], youWon: false, me: { followed: true, commented: false, eligible: false, excludedReason: 'no_comment' }, isOwner: false };
  if (p.startsWith('/api/giveaways/seller/')) return { giveaway: { ...baseGiveaway, seller: { id: 'seller_demo', name: 'Atelier Nord' } } };
  return undefined;
}

const AUDIT = () => {
  const out = [];
  const vw = window.innerWidth;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const label = el.textContent.trim().slice(0, 40);
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible' ) out.push(`clipped: "${label}"`);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`ellipsis: "${label}"`);
    if (r.right > vw + 1 || r.left < -1) out.push(`off-screen: "${label}"`);
    const parent = el.parentElement;
    if (parent) {
      const pr = parent.getBoundingClientRect();
      const pcs = getComputedStyle(parent);
      if (pcs.overflow !== 'visible' && (r.right > pr.right + 1 || r.left < pr.left - 1)) out.push(`overflows parent: "${label}"`);
    }
  }
  return [...new Set(out)];
};

async function main() {
  if (!existsSync(path.join(BUILD, 'index.html'))) buildPreviewWeb(BUILD);
  const { origin, close } = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const problems = [];
  try {
    const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {} });
    await page.route(`${DEMO_API}/**`, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fallback();
      const u = new URL(req.url());
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      const res = fixtures(req.method(), u.pathname.replace(/^\/api\/v1/, '/api'), body);
      if (process.env.DEBUG_ROUTES) console.log(req.method(), u.pathname, res === undefined ? 'UNMATCHED' : 'ok');
      if (res === undefined) return route.fallback();
      return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(res),
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
      });
    });

    const shot = async (name, { scroll = false } = {}) => {
      await waitForQuietNetwork(activity, 500, 8000);
      await page.waitForTimeout(600);
      if (scroll) await page.evaluate(() => document.querySelectorAll('*').forEach((e) => { if (e.scrollHeight > e.clientHeight + 50) e.scrollTop = e.scrollHeight; }));
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      const issues = await page.evaluate(AUDIT);
      console.log(`[${name}] text-fit issues: ${issues.length ? issues.join(' | ') : 'none'}`);
      for (const i of issues) problems.push(`${name}: ${i}`);
    };
    const go = async (url, role = 'seller', expect) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await openScreen(page, activity, origin, role, url);
        await page.waitForTimeout(1200);
        if (!expect || await page.getByText(expect, { exact: false }).first().isVisible().catch(() => false)) return;
      }
    };
    page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
    process.on('uncaughtException', async () => { await page.screenshot({ path: path.join(OUT, 'debug.png') }).catch(() => {}); });

    await go('/(tabs)/marketing', 'seller', 'Referral Program'); await page.waitForTimeout(800); await shot('01-marketing-entry-rows', { scroll: true });

    state.push = 'open';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await go('/seller-push-broadcast', 'seller', 'Past pushes'); await page.waitForTimeout(1200);
      if (await page.getByLabel('Push title').isVisible().catch(() => false)) break;
    }
    await page.getByLabel('Push title').fill('New drop Friday');
    await page.getByLabel('Push message').fill('Doors open at 6pm. Limited stock, one per customer.');
    await shot('02-push-compose');
    await page.getByRole('button', { name: 'Review' }).click(); await page.waitForTimeout(800);
    await shot('03-push-review');

    state.push = 'limited';
    await go('/seller-push-broadcast', 'seller', 'Past pushes'); await page.waitForTimeout(800); await shot('04-push-rate-limited');
    await go('/seller-push-broadcast-results?id=b1', 'seller', 'Opened'); await page.waitForTimeout(800); await shot('05-push-results');

    await go('/seller-giveaways', 'seller', 'Win the Nord'); await page.waitForTimeout(800); await shot('06-giveaways-list');
    await go('/seller-giveaway-create', 'seller', 'Official rules'); await page.waitForTimeout(800);
    await page.getByLabel('Title').fill('Win the Nord black jacket');
    await page.getByLabel('Prize', { exact: true }).fill('The Nord jacket in any size');
    await page.waitForTimeout(800);
    await shot('07-giveaway-create');
    await shot('08-giveaway-create-bottom', { scroll: true });

    state.giveawayPhase = 'live'; await go('/seller-giveaway-detail?id=g1', 'seller', 'Share link'); await page.waitForTimeout(800); await shot('09-giveaway-detail-live');
    state.giveawayPhase = 'ended'; await go('/seller-giveaway-detail?id=g1', 'seller', 'Share link'); await page.waitForTimeout(800); await shot('10-giveaway-detail-ended');
    state.giveawayPhase = 'drawn'; await go('/seller-giveaway-detail?id=g1', 'seller', 'Share link'); await page.waitForTimeout(800); await shot('11-giveaway-detail-winners');
    await shot('12-giveaway-detail-winners-bottom', { scroll: true });

    await go('/giveaway?code=K7M2QX9A', 'buyer', 'How does it work'); await page.waitForTimeout(800); await shot('13-giveaway-buyer-entry');
    await context.close();
  } finally {
    await browser.close();
    close();
  }
  console.log(problems.length ? `\nTEXT-FIT PROBLEMS (${problems.length}):\n${problems.join('\n')}` : '\nText-fit audit: no problems found');
  if (problems.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
