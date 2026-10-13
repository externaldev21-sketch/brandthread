/**
 * A tiny fake backend for the onboarding walkthrough: just enough of
 * artifacts/api-server's `/api/auth/*`, `/api/seller/onboarding/*` and
 * `/api/onboarding-sample/logo` surface for the real onboarding screen
 * (app/onboarding.tsx) to complete a full sign-up, and for a following
 * `GET /api/auth/me` to prove the answers were actually saved.
 *
 * Modeled on scripts/store-screenshots/demo-data.mjs's `respond()`: strip the
 * `/api` (and optional `/v1`) prefix, match on the remaining path, default
 * unmatched GETs to 404 and unmatched writes to `{ ok: true }` so screens that
 * poll unrelated endpoints during boot don't hard-fail the walkthrough.
 *
 * `createFakeOnboardingApi()` returns a fresh in-memory "DB user" per call —
 * the capture script makes one per browser context (one per buyer/seller run)
 * so the two walkthroughs never share state.
 */

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** Pulls the Clerk user id back out of an `Authorization: Bearer stub-token.<id>` header. */
function clerkIdFromAuthHeader(authorization) {
  const match = /^Bearer stub-token\.(.+)$/.exec(authorization || '');
  return match ? match[1] : null;
}

export function createFakeOnboardingApi() {
  /** @type {any} */
  let dbUser = null;
  const calls = [];

  function ensureUser(name, clerkId) {
    if (!dbUser) {
      dbUser = {
        // Must match the signed-in Clerk user's own id, or screens that
        // compare "who's signed in" against "whose record is this"
        // (app/thread-explainer.tsx) bounce back to onboarding. clerkId is
        // parsed out of the `stub-token.<id>` bearer token that
        // clerk-onboarding-stub.mjs's session.getToken() returns — see
        // clerkIdFromAuthHeader() below.
        clerkId: clerkId || `user_stub_${Math.random().toString(36).slice(2, 10)}`,
        email: null,
        name: name || '',
        displayName: name || '',
        bio: '',
        username: null,
        accountType: null,
        brandName: null,
        brandStage: null,
        goals: null,
        styleInterests: null,
        appThemeId: null,
        appIconId: null,
        onboardingComplete: false,
      };
    } else if (name) {
      dbUser.name = name;
      dbUser.displayName = name;
    }
    return dbUser;
  }

  /**
   * @returns {{ status: number, body: any } | undefined} undefined means "not
   * handled here" — the caller defaults it (404 for GET, 200 ok for writes).
   */
  function respond({ method, pathname, query, body, authorization }) {
    calls.push({ method, pathname, body });
    const p = pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '');
    const get = method === 'GET';
    const clerkId = clerkIdFromAuthHeader(authorization);

    if (p === '/auth/sync' && method === 'POST') {
      const user = ensureUser(body?.name, clerkId);
      return { status: 200, body: user };
    }
    if (p === '/auth/me' && get) {
      if (!dbUser) return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'No account yet' } } };
      return { status: 200, body: dbUser };
    }
    if (p === '/auth/onboarding' && method === 'PATCH') {
      const user = ensureUser();
      if (body?.brandName != null) user.brandName = body.brandName;
      if (body?.brandStage != null) user.brandStage = body.brandStage;
      if (body?.username != null) user.username = body.username;
      return { status: 200, body: { ok: true } };
    }
    if (p === '/auth/profile' && method === 'PATCH') {
      const user = ensureUser();
      if (body?.name != null) user.name = body.name;
      if (body?.displayName != null) user.displayName = body.displayName;
      if (body?.accountType != null) user.accountType = body.accountType;
      if (body?.username != null) user.username = body.username;
      if (body?.brandName != null) user.brandName = body.brandName;
      return { status: 200, body: user };
    }
    if (p === '/auth/onboarding/buyer-preferences' && method === 'PATCH') {
      const user = ensureUser();
      user.styleInterests = body?.styleInterests ?? [];
      return { status: 200, body: { ok: true } };
    }
    if (p === '/auth/onboarding/complete' && method === 'POST') {
      const user = ensureUser();
      user.onboardingComplete = true;
      if (body?.accountType) user.accountType = body.accountType;
      return { status: 200, body: user };
    }
    if (p === '/seller/onboarding/data' && method === 'POST') {
      const user = ensureUser();
      if (body?.goals != null) user.goals = body.goals;
      if (body?.brandStage != null) user.brandStage = body.brandStage;
      return { status: 200, body: { ok: true } };
    }
    if (p === '/auth/username/check' && get) {
      return { status: 200, body: { available: true } };
    }
    if (p === '/onboarding-sample/logo' && method === 'POST') {
      return { status: 200, body: { b64_json: TINY_PNG_BASE64 } };
    }
    if (p === '/ai/brand-memory/rebuild' && method === 'POST') {
      return { status: 200, body: { fields: {} } };
    }
    if (p === '/referrals/apply' && method === 'POST') {
      return { status: 200, body: { ok: true, inviterId: 'seller_stub' } };
    }
    if (p === '/public/brands/discover' && get) {
      // Empty is a valid, gracefully-handled state for BrandsToFollowStep.
      return { status: 200, body: [] };
    }
    if (p === '/config/features' && get) {
      return { status: 200, body: { flags: { aiPhotoShoot: true, outfitSwap: true, boosts: true, manufacturerHub: true }, updatedAt: null } };
    }

    // Everything below is only there so the screen the walkthrough *lands on*
    // after finishing (buyer feed / seller dashboard) can render its first
    // paint without erroring on a completely empty fake account — none of it
    // is what the onboarding steps themselves assert against.
    if (get && (p === '/public/products/high-demand' || p === '/public/products')) return { status: 200, body: [] };
    if (get && p === '/public/drops') return { status: 200, body: [] };
    if (get && p === '/public/trending') return { status: 200, body: { trending: [] } };
    if (get && (p === '/posts/feed' || p === '/public/posts')) return { status: 200, body: [] };
    if (get && p === '/posts/repost-context') return { status: 200, body: {} };
    if (get && p === '/live/active') return { status: 200, body: { streams: [] } };
    if (get && p === '/buyer/cart') return { status: 200, body: { items: [], savedItems: [] } };
    if (get && p === '/buyer/notifications') return { status: 200, body: [] };
    if (get && p.startsWith('/social/status/')) return { status: 200, body: { isFollowing: false, followersCount: 0 } };
    if (get && p === '/analytics/home') return { status: 200, body: { range: 'today', totalCents: 0, orderCount: 0, visitorCount: 0, toFulfill: 0, toCapture: 0, buckets: [] } };
    if (get && p === '/finance/balance') {
      return {
        status: 200,
        body: {
          available: { amount: 0, currency: 'usd', formatted: '$0.00' },
          pending: { amount: 0, currency: 'usd', formatted: '$0.00' },
          connected: false, payoutsEnabled: false, bankConnected: false, processingCashout: null,
        },
      };
    }
    if (get && p === '/orders') return { status: 200, body: [] };
    if (get && p === '/conversations') return { status: 200, body: [] };
    if (get && p === '/seller/subscription/status') {
      return { status: 200, body: { plan: 'starter', status: 'trialing', trialEnd: null, trialStartAt: null, trialEndAt: null, trialBanner: null, renewsOn: null, amountCents: 0, paymentMethodLabel: null, effectiveProvider: 'stripe' } };
    }
    if (get && p === '/team/context') return { status: 200, body: { role: 'owner', storeOwnerId: dbUser?.clerkId ?? null, teamMembershipId: null } };
    if (get && p === '/team/my-memberships') return { status: 200, body: { memberships: [] } };
    if (get && p === '/products') return { status: 200, body: [] };
    if (get && p === '/manufacturers/public') return { status: 200, body: [] };

    return undefined;
  }

  return {
    respond,
    /** The in-memory row this run has written, or null before /auth/sync. */
    getUser: () => dbUser,
    /** Every request this instance has handled, for debugging a failed run. */
    getCalls: () => calls,
  };
}

/**
 * Installs the fake API (and blocks everything else external) on a Playwright
 * BrowserContext, mirroring scripts/store-screenshots/harness.mjs's
 * `openContext` routing but for a signed-OUT onboarding run.
 */
export async function installFakeBackend(context, { origin, apiOrigin, api }) {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (url.origin === apiOrigin) {
      const cors = {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization,content-type,x-store-context',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      let body;
      const raw = request.postData();
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = undefined; }
      }
      const authorization = request.headers()['authorization'];
      const result = api.respond({ method: request.method(), pathname: url.pathname, query: url.searchParams, body, authorization });
      if (result) {
        return route.fulfill({ status: result.status, headers: cors, contentType: 'application/json', body: JSON.stringify(result.body) });
      }
      if (request.method() === 'GET') {
        return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"code":"NOT_SEEDED","message":"Not part of the onboarding walkthrough fake API"}}' });
      }
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true}' });
    }
    // Everything else (analytics, fonts CDNs, Clerk, images, …) stays offline
    // so the walkthrough is fast and repeatable — the onboarding screens this
    // script exercises don't need real images.
    return route.abort();
  });
}
