/**
 * Signed-out API policy — the single answer to "may this request leave the
 * device without a signed-in account?".
 *
 * It is an ALLOWLIST: a request with no session (or any request made from the
 * dev web preview, `?bt_preview=…`) may only reach the endpoints below, which
 * the API server serves without `requireAuth`. Everything else — account
 * data, seller tools, uploads, Stripe, and every paid AI/generation path,
 * including ones added later — is blocked by default, so a new protected
 * route can never leak through a stale denylist (the `ai` vs `ai-helpers`
 * prefix gap in QA-0102 was exactly that).
 *
 * The list was built by probing every path lib/api.ts calls against the real
 * API server with no session: the ones below answered without a 401; every
 * other one answered 401. lib/__tests__/signedOutApiPolicy.test.ts pins it.
 *
 * Pure (no React Native / storage imports) so it can be unit tested and
 * reused by any request path (lib/api.ts doRequest, uploads).
 */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

type Rule = { methods: readonly Method[] | 'any'; pattern: RegExp };

const READ: readonly Method[] = ['GET', 'HEAD'];
const SEG = '[^/]+';

/** Endpoints the server answers for anonymous callers (paths after `/api[/vN]/`). */
const PUBLIC_RULES: readonly Rule[] = [
  { methods: READ, pattern: /^healthz$/ },
  { methods: READ, pattern: /^config\/features$/ },

  // Public browse surface (search, profiles, products, drops, discover…), minus
  // the per-account pieces that live under the same prefix but need a session.
  {
    methods: 'any',
    pattern: new RegExp(
      `^public(?:/|$)(?!search/recent(?:/|$))(?!drops/${SEG}/notify$)(?!sellers/${SEG}/visit$)`,
    ),
  },

  // Guest checkout (Stripe session for a signed-out buyer is the product).
  { methods: 'any', pattern: /^guest\/checkout(?:\/|$)/ },

  // Password reset is, by definition, used while signed out.
  { methods: ['POST'], pattern: /^auth\/password-reset\/(?:request|confirm)$/ },

  // Read-only public detail pages.
  { methods: READ, pattern: new RegExp(`^bundles/public/${SEG}$`) },
  { methods: READ, pattern: /^communities\/public$/ },
  { methods: READ, pattern: new RegExp(`^communities/invite/${SEG}$`) },
  { methods: READ, pattern: /^freelancers$/ },
  { methods: READ, pattern: new RegExp(`^freelancers/(?!me$|connect$|apply$)${SEG}$`) },
  { methods: READ, pattern: /^live\/(?:active|feed)$/ },
  { methods: READ, pattern: new RegExp(`^live/(?!start$)${SEG}(?:/comments)?$`) },
  { methods: READ, pattern: /^manufacturers\/public(?:\/[^/]+)?$/ },
  { methods: ['POST'], pattern: /^manufacturers\/public\/apply$/ },
  { methods: READ, pattern: new RegExp(`^manufacturers/invite-tokens/resolve/${SEG}$`) },
  {
    methods: READ,
    pattern: new RegExp(`^posts/(?!mine$|feed$|watched-videos$|repost-context$)${SEG}(?:/comments)?$`),
  },
  { methods: READ, pattern: /^posts\/media\/.+$/ },
  { methods: READ, pattern: new RegExp(`^reviews/(?:product|seller)/${SEG}$`) },
  { methods: READ, pattern: /^shipping-rates\/calculate$/ },
  { methods: READ, pattern: /^shipping-zones\/resolve$/ },
  { methods: READ, pattern: new RegExp(`^team/invite/accept/${SEG}$`) },

  // IP / copyright reports can be filed by rights holders without an account.
  { methods: ['POST'], pattern: /^ip-cases$/ },
  { methods: READ, pattern: new RegExp(`^ip-cases/${SEG}/status$`) },
];

/** `/api/v1/foo/bar?x=1` → `foo/bar` (also accepts `/api/foo`, full URLs). */
export function normalizeApiPath(path: string): string {
  let p = path;
  const scheme = p.indexOf('://');
  if (scheme !== -1) {
    const slash = p.indexOf('/', scheme + 3);
    p = slash === -1 ? '/' : p.slice(slash);
  }
  p = p.split('#')[0].split('?')[0];
  return p.replace(/^\/api(?:\/v\d+)?(?:\/|$)/, '').replace(/\/+$/, '');
}

/** True when the server serves this request to an anonymous caller. */
export function isPublicApiRequest(method: string | undefined, path: string): boolean {
  const m = (method ?? 'GET').toUpperCase() as Method;
  const p = normalizeApiPath(path);
  return PUBLIC_RULES.some(
    (rule) => (rule.methods === 'any' || rule.methods.includes(m)) && rule.pattern.test(p),
  );
}

/** Error code carried by the local 401 a blocked request rejects with. */
export const SIGNED_OUT_ERROR_CODE = 'auth_required';

/** JSON body matching the server's own 401 envelope, so existing error parsing keeps working. */
export function signedOutErrorBody(): string {
  return JSON.stringify({ error: { code: SIGNED_OUT_ERROR_CODE, message: 'Sign in to continue.' } });
}
