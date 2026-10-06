/**
 * PR screenshots for the App Store / payments / account-deletion QA fixes
 * (QA-0040/0043/0048/0049/0057/0072-0074/0093/0100/0166/0004), 390x844.
 * Fixtures are served by page.route below (screenshot harness only; the app ships no fake data).
 *
 * Run:  node scripts/store-screenshots/qa-payments-account-verify.mjs
 * Env:  BUILD_DIR=<existing web export> to skip the rebuild.
 */
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/qa-payments-account');
mkdirSync(OUT, { recursive: true });
const BUILD = process.env.BUILD_DIR || path.join(MOBILE_ROOT, '.store-screenshots', 'web-build');
const DEMO_API = 'https://api.brandthread.test';
const DEVICE = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };

const NO_PLAN = { plan: 'starter', status: 'none', renewsOn: null, trialEnd: null, trialBanner: null, amountCents: 0, paymentMethodLabel: null, effectiveProvider: 'none', native: null };
const state = { consent: false, consentAsked: 0 };

function fixtures(method, p) {
  if (p === '/api/team/context') return { role: 'owner', storeOwnerId: 'seller', teamMembershipId: null };
  if (p === '/api/seller/subscription/status') return NO_PLAN;
  if (p === '/api/seller/subscription/invoices') return { invoices: [] };
  if (p === '/api/auth/account/deletion-check') {
    return {
      canDelete: true, accountType: 'seller', graceDays: 30, reauth: 'email_code',
      reauthOptions: { apple: true, recentSignIn: false, emailCode: false },
      subscriptionNotice: {
        provider: 'store', title: 'Cancel your plan in the App Store or Google Play',
        detail: "Your Brandthread plan is billed by Apple or Google. Deleting your account doesn't cancel it, so cancel it in your store subscriptions to stop future charges.",
      },
      deletionCancelledAt: null, blockers: [],
      willDelete: ['Your profile, posts, comments and messages', 'Your saved items, addresses and settings', 'Your storefront and product listings', 'Your sign-in'],
      willRetain: ['Order, payment and tax records, without your name and address, as the law requires'],
    };
  }
  if (p === '/api/featured-slots/availability') {
    const d = (n) => new Date(Date.parse('2026-09-18T23:30:00Z') + n * 86400e3).toISOString();
    return { placement: 'discover_brands', capacity: 4, openSlot: null, options: [
      { durationDays: 3, priceCents: 2900, availableNow: true, startsAt: d(0), endsAt: d(3) },
      { durationDays: 7, priceCents: 5900, availableNow: true, startsAt: d(0), endsAt: d(7) },
      { durationDays: 14, priceCents: 9900, availableNow: true, startsAt: d(0), endsAt: d(14) },
    ] };
  }
  if (p === '/api/featured-slots/mine') {
    return [{ id: 'f1', placement: 'discover_brands', durationDays: 7, priceCents: 5900, startsAt: '2026-09-02T00:00:00Z', endsAt: '2026-09-09T00:00:00Z',
      status: 'rejected', displayState: 'rejected', paid: true, paidVia: 'store', rejectionReason: 'Brand profile incomplete', refundStatus: 'store', createdAt: '2026-09-01T00:00:00Z' }];
  }
  if (p === '/api/notification-prefs') return { digest: 'realtime', role: 'buyer', pushEnabled: true, promotionalPush: false, quietHours: { start: null, end: null, timezone: 'UTC' }, categories: {} };
  if (p === '/api/ai-consent' && method === 'GET') return { granted: state.consent, version: '2026-10-06', grantedAt: null, providers: ['OpenAI', 'fal.ai', 'FASHN'] };
  if (p === '/api/ai/credits' || p === '/api/ai-credits') return { balance: 0, monthlyAllowance: 0, monthlyBalance: 0, rolloverBalance: 0, purchasedBalance: 0, unlimited: false, packs: [], tools: [], resetsAt: null, purchase: { stripe: false } };
  if (p.startsWith('/api/ai/credits/history') || p.startsWith('/api/ai-credits/history')) return { entries: [], nextCursor: null };
  if (p === '/api/giveaways/K7M2QX9A') {
    return { id: 'g1', title: 'Win the Fall capsule', prizeText: 'The full Fall capsule in your size', phase: 'live', status: 'open',
      startsAt: '2026-09-16T00:00:00Z', endsAt: '2026-09-22T00:00:00Z', winnerCount: 1,
      rulesText: 'NO PURCHASE NECESSARY TO ENTER OR WIN.\nApple Inc. and Google LLC are not sponsors of, and are not involved in, this giveaway in any way.',
      seller: { id: 'seller_demo', name: 'Atelier Nord', handle: 'ateliernord' }, product: null, requiresComment: false, winners: [], youWon: false,
      me: { followed: true, commented: false, eligible: true, excludedReason: null }, isOwner: false, shareCode: 'K7M2QX9A' };
  }
  return undefined;
}

async function main() {
  if (!existsSync(path.join(BUILD, 'index.html'))) buildPreviewWeb(BUILD);
  const { origin, close } = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const run = async (role, steps) => {
    const { context, page, activity } = await openContext(browser, { device: DEVICE, role, origin, images: {} });
    page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
    await page.route(`${DEMO_API}/**`, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fallback();
      const u = new URL(req.url());
      const p = u.pathname.replace(/^\/api\/v1/, '/api');
      const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
      // AI tools refuse until the person allows sending content to the providers (QA-0043).
      if (p === '/api/techpack/generate' && !state.consent) {
        state.consentAsked += 1;
        return route.fulfill({ status: 403, contentType: 'application/json', headers,
          body: JSON.stringify({ error: 'Allow AI data sharing to use Brandthread AI. You can change this in Settings.', code: 'ai_consent_required' }) });
      }
      const res = fixtures(req.method(), p);
      if (process.env.DEBUG_ROUTES) console.log(req.method(), p, res === undefined ? 'UNMATCHED' : 'ok');
      if (res === undefined) return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(res), headers });
    });
    const shot = async (name, { scroll = false } = {}) => {
      await waitForQuietNetwork(activity, 500, 8000);
      await page.waitForTimeout(700);
      if (scroll) await page.evaluate(() => document.querySelectorAll('*').forEach((e) => { if (e.scrollHeight > e.clientHeight + 50) e.scrollTop = e.scrollHeight; }));
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      console.log('shot', name);
    };
    const go = async (url, expect) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await openScreen(page, activity, origin, role, url);
        await page.waitForTimeout(1200);
        if (!expect || await page.getByText(expect, { exact: false }).first().isVisible().catch(() => false)) return true;
      }
      console.log(`WARN: "${expect}" not visible on ${url}`);
      return false;
    };
    await steps({ page, go, shot });
    await context.close();
  };

  try {
    await run('seller', async ({ page, go, shot }) => {
      await go('/subscription', 'No plan'); await shot('01-subscription-no-plan');
      await go('/finance', 'Platform subscription'); await shot('02-finance-no-plan');
      await go('/billing', 'Upcoming bill'); await shot('03-billing-owner');
      await go('/ai-credits', 'Available credits'); await shot('04-ai-credits-signed-in');
      await go('/delete-account', 'Cancel your plan'); await shot('05-delete-account-store-plan-notice');
      await shot('06-delete-account-overview-bottom', { scroll: true });
      await page.getByText('Continue', { exact: true }).last().click().catch(() => console.log('WARN: no Continue'));
      await page.waitForTimeout(800); await shot('07-delete-account-sso-reauth');
      await go('/featured-slot', 'History'); await shot('08-featured-store-refund', { scroll: true });
      await go('/ai-data-sharing', 'Allow Brandthread AI'); await shot('09-ai-data-sharing-setting');
      await go('/tech-pack-generator', '');
      for (let i = 0; i < 6; i += 1) {
        const gen = page.getByText('Generate tech pack', { exact: true }).first();
        if (await gen.isVisible().catch(() => false)) { await gen.click(); break; }
        const next = page.getByText(/^(Next|Continue)$/).last();
        if (!(await next.isVisible().catch(() => false))) break;
        await next.click(); await page.waitForTimeout(500);
      }
      await page.waitForTimeout(1200);
      await shot('10-ai-consent-sheet');
      console.log('consent refusals served:', state.consentAsked);
    });
    await run('buyer', async ({ go, shot }) => {
      await go('/notifications-settings', 'Order updates'); await shot('11-buyer-notifications');
      await shot('12-buyer-notifications-bottom', { scroll: true });
      await go('/push-notifications', 'Order updates'); await shot('13-buyer-legacy-route-redirects');
      await go('/giveaway?code=K7M2QX9A', 'How does it work'); await shot('14-giveaway-apple-disclaimer');
    });
  } finally {
    await browser.close();
    await close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
