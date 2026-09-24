/**
 * Brandthread — launch-day k6 load test.
 *
 * Simulates realistic launch-day buyer traffic against the api-server as a mix
 * of weighted scenarios: browsing the feed, discovering/searching, viewing a
 * product, adding to cart, running a guest checkout up to a Stripe TEST-mode
 * Checkout Session, and messaging.
 *
 * Endpoints exercised (see artifacts/api-server/src/routes/index.ts for the
 * mount table this was read from):
 *   GET  /api/public/posts               — public Thread feed (no auth)
 *   GET  /api/public/trending            — trending shelf (no auth)
 *   GET  /api/public/search?q=...        — discover / search (no auth)
 *   GET  /api/public/products            — product listing (no auth)
 *   GET  /api/public/products/:id        — product detail (no auth)
 *   GET  /api/public/products/:id/related — related products (no auth)
 *   GET  /api/buyer/cart                 — load cart (requires auth)
 *   POST /api/buyer/cart/sync            — add to cart, full-replace (requires auth)
 *   POST /api/guest/checkout/session     — create a Stripe TEST-mode Checkout
 *                                           Session as a guest (no auth; requires
 *                                           STRIPE_SECRET_KEY=sk_test_... on the
 *                                           server — see docs/launch/load-test.md)
 *   GET  /api/conversations              — list conversations (requires auth)
 *   POST /api/conversations/:id/messages — send a message (requires auth)
 *
 * IMPORTANT — auth limitation:
 * The api-server authenticates with Clerk (`@clerk/express`, `getAuth(req)`).
 * k6 cannot mint a real Clerk session token on its own. The "add to cart" and
 * "messaging" scenarios therefore need a pre-obtained Clerk session JWT passed
 * in via the AUTH_TOKEN env var (e.g. minted by a test Clerk user / Clerk's
 * testing token API against a staging Clerk instance). Without AUTH_TOKEN,
 * those two scenarios run read-only where possible and treat 401 responses as
 * an accepted (not-a-failure) outcome so the rest of the run still produces a
 * useful signal — see docs/launch/load-test.md for how to obtain a real token
 * before running this against staging.
 *
 * Checkout is run "up to a Stripe TEST-mode Checkout Session" only: the guest
 * checkout endpoint creates a real `stripe.checkout.sessions.create(...)` call
 * against Stripe test mode (server-side, using STRIPE_SECRET_KEY=sk_test_...)
 * and returns a hosted Checkout URL. Actually completing payment happens on
 * Stripe's hosted page and is out of scope for an API load test — we stop once
 * the session + hosted checkout URL is created, which is the last step the API
 * itself is responsible for.
 */
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

// ─── Config ────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || ""; // Clerk session JWT, optional (see header comment)
const CHECKOUT_EMAIL = __ENV.CHECKOUT_EMAIL || "loadtest+guest@example.com";
// A product id to use for detail/cart/checkout scenarios when the server has no
// seed data the script can discover on its own. If unset, the script first
// looks up a real active product via /api/public/products.
const SEED_PRODUCT_ID = __ENV.SEED_PRODUCT_ID || "";
const SEARCH_TERMS = ["hoodie", "denim", "sneaker", "jacket", "tee", "cap", "bag"];

// Launch-day SLO thresholds — adjust these for your own launch targets.
// Defaults: p95 < 800ms end-to-end per scenario group, error rate < 1%.
export const options = {
  scenarios: {
    // Weighted mix approximating a launch-day traffic split:
    //   browsing (feed/discover) dominates, checkout/messaging are the tail.
    browse_feed: {
      executor: "ramping-vus",
      exec: "browseFeed",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 40 },
        { duration: "3m", target: 40 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
    discover_search: {
      executor: "ramping-vus",
      exec: "discoverSearch",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 20 },
        { duration: "3m", target: 20 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
    view_product: {
      executor: "ramping-vus",
      exec: "viewProduct",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 25 },
        { duration: "3m", target: 25 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
    add_to_cart: {
      executor: "ramping-vus",
      exec: "addToCart",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 10 },
        { duration: "3m", target: 10 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
    checkout_test_mode: {
      executor: "constant-arrival-rate",
      exec: "checkoutTestMode",
      rate: 3, // iterations per timeUnit
      timeUnit: "1m",
      duration: "5m",
      preAllocatedVUs: 5,
      maxVUs: 15,
    },
    messaging: {
      executor: "ramping-vus",
      exec: "messaging",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 5 },
        { duration: "3m", target: 5 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: {
    // Global SLOs — the run fails (non-zero exit) if these are not met.
    http_req_failed: ["rate<0.01"], // <1% error rate overall
    http_req_duration: ["p(95)<800"], // p95 < 800ms overall
    // Per-scenario budgets: browse/discover/product-view are read paths and
    // should be fast; checkout/messaging do more work (Stripe calls, DB
    // writes) so they get a looser budget. Adjust to your own SLOs.
    "http_req_duration{scenario:browse_feed}": ["p(95)<500"],
    "http_req_duration{scenario:discover_search}": ["p(95)<600"],
    "http_req_duration{scenario:view_product}": ["p(95)<600"],
    "http_req_duration{scenario:add_to_cart}": ["p(95)<800"],
    "http_req_duration{scenario:checkout_test_mode}": ["p(95)<1500"],
    "http_req_duration{scenario:messaging}": ["p(95)<800"],
    checkout_success_rate: ["rate>0.95"],
  },
};

// Custom metrics for the checkout flow, since a "success" there is a 401 (no
// AUTH_TOKEN) or a 503 (Stripe not configured on the target server) in a lot
// of environments and we want that visible separately from hard failures.
const checkoutSuccessRate = new Rate("checkout_success_rate");
const checkoutDuration = new Trend("checkout_duration_ms");

function authHeaders(extra) {
  const headers = Object.assign({ "Content-Type": "application/json" }, extra || {});
  if (AUTH_TOKEN) headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  return headers;
}

function thinkTime(min, max) {
  sleep(min + Math.random() * (max - min));
}

function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// ─── Shared helper: pick a real product id ────────────────────────────────

function pickProductId() {
  if (SEED_PRODUCT_ID) return SEED_PRODUCT_ID;
  const res = http.get(`${BASE_URL}/api/public/products?limit=1`, {
    tags: { name: "PickProduct" },
  });
  if (res.status !== 200) return null;
  try {
    const body = JSON.parse(res.body);
    return Array.isArray(body) && body.length > 0 ? body[0].id : null;
  } catch (e) {
    return null;
  }
}

// ─── Scenario: browse feed ─────────────────────────────────────────────────

export function browseFeed() {
  group("browse feed", () => {
    const res = http.get(`${BASE_URL}/api/public/posts?limit=20`, {
      tags: { name: "GET /api/public/posts" },
    });
    check(res, {
      "feed status is 200": (r) => r.status === 200,
      "feed body is an array": (r) => {
        try {
          return Array.isArray(JSON.parse(r.body));
        } catch (e) {
          return false;
        }
      },
    });
    thinkTime(1, 3);

    const trending = http.get(`${BASE_URL}/api/public/trending?limit=20`, {
      tags: { name: "GET /api/public/trending" },
    });
    check(trending, {
      "trending status is 200": (r) => r.status === 200,
      "trending has trending list": (r) => {
        try {
          return Array.isArray(JSON.parse(r.body).trending);
        } catch (e) {
          return false;
        }
      },
    });
    thinkTime(2, 5);
  });
}

// ─── Scenario: discover / search ──────────────────────────────────────────

export function discoverSearch() {
  group("discover / search", () => {
    const q = randomOf(SEARCH_TERMS);
    const res = http.get(
      `${BASE_URL}/api/public/search?q=${encodeURIComponent(q)}&limit=20`,
      { tags: { name: "GET /api/public/search" } },
    );
    check(res, {
      "search status is 200": (r) => r.status === 200,
      "search returns results array": (r) => {
        try {
          return Array.isArray(JSON.parse(r.body).results);
        } catch (e) {
          return false;
        }
      },
    });
    thinkTime(1, 4);

    const drops = http.get(`${BASE_URL}/api/public/drops`, {
      tags: { name: "GET /api/public/drops" },
    });
    check(drops, { "drops status is 200": (r) => r.status === 200 });
    thinkTime(1, 3);
  });
}

// ─── Scenario: view product detail ────────────────────────────────────────

export function viewProduct() {
  group("view product detail", () => {
    const productId = pickProductId();
    if (!productId) {
      // No active product in the target DB (empty/seed-less environment).
      // Not a hard failure of the script; the list call itself is the signal.
      thinkTime(1, 2);
      return;
    }
    const res = http.get(`${BASE_URL}/api/public/products/${productId}`, {
      tags: { name: "GET /api/public/products/:id" },
    });
    check(res, {
      "product detail status is 200": (r) => r.status === 200,
      "product detail has variants": (r) => {
        try {
          return Array.isArray(JSON.parse(r.body).variants);
        } catch (e) {
          return false;
        }
      },
    });
    thinkTime(2, 6);

    const related = http.get(
      `${BASE_URL}/api/public/products/${productId}/related?limit=8`,
      { tags: { name: "GET /api/public/products/:id/related" } },
    );
    check(related, { "related products status is 200": (r) => r.status === 200 });
    thinkTime(1, 3);
  });
}

// ─── Scenario: add to cart ────────────────────────────────────────────────
// Requires auth (Clerk). Without AUTH_TOKEN, we still exercise the endpoint
// shape and accept 401 as a documented, non-failing outcome (see file header).

export function addToCart() {
  group("add to cart", () => {
    const productId = pickProductId();
    if (!productId) {
      thinkTime(1, 2);
      return;
    }

    const payload = JSON.stringify({
      items: [
        {
          variantId: `loadtest-variant-${__VU}-${__ITER}`,
          id: productId,
          quantity: 1,
        },
      ],
      savedItems: [],
    });

    const res = http.post(`${BASE_URL}/api/buyer/cart/sync`, payload, {
      headers: authHeaders(),
      tags: { name: "POST /api/buyer/cart/sync" },
    });

    check(res, {
      "cart sync succeeds or requires auth as expected": (r) =>
        r.status === 200 || (!AUTH_TOKEN && r.status === 401),
    });
    thinkTime(1, 3);

    const cart = http.get(`${BASE_URL}/api/buyer/cart`, {
      headers: authHeaders(),
      tags: { name: "GET /api/buyer/cart" },
    });
    check(cart, {
      "cart read succeeds or requires auth as expected": (r) =>
        r.status === 200 || (!AUTH_TOKEN && r.status === 401),
    });
    thinkTime(1, 2);
  });
}

// ─── Scenario: checkout in Stripe TEST mode ───────────────────────────────
// Uses the *guest* checkout endpoint (POST /api/guest/checkout/session), which
// needs no auth and — on a server configured with a Stripe TEST secret key
// (sk_test_...) — creates a real Stripe Checkout Session in test mode and
// returns its hosted URL. We stop there: actually paying on Stripe's hosted
// page is outside the API's surface and outside this load test.

export function checkoutTestMode() {
  const start = Date.now();
  group("guest checkout (test mode)", () => {
    const productId = pickProductId();
    if (!productId) {
      checkoutSuccessRate.add(false);
      thinkTime(1, 2);
      return;
    }

    // We don't know a real variantId for the picked product without another
    // round trip; fetch the product detail once to grab its first variant.
    const detail = http.get(`${BASE_URL}/api/public/products/${productId}`, {
      tags: { name: "GET /api/public/products/:id (checkout lookup)" },
    });
    let variantId = null;
    try {
      const body = JSON.parse(detail.body);
      variantId = Array.isArray(body.variants) && body.variants.length > 0
        ? body.variants[0].id
        : null;
    } catch (e) {
      variantId = null;
    }
    if (!variantId) {
      checkoutSuccessRate.add(false);
      thinkTime(1, 2);
      return;
    }

    const payload = JSON.stringify({
      items: [{ productId, variantId, quantity: 1 }],
      successUrl: "https://loadtest.brandthread.invalid/checkout/success",
      cancelUrl: "https://loadtest.brandthread.invalid/checkout/cancel",
      contactEmail: CHECKOUT_EMAIL,
      contactPhone: "+15555550100",
      shippingAddress: {
        name: "Load Test Buyer",
        street: "1 Market St",
        city: "San Francisco",
        state: "CA",
        zip: "94105",
        country: "US",
        phone: "+15555550100",
      },
      // Unique per-iteration so the idempotency-key reuse path isn't hit.
      clientIdempotencyKey: `loadtest-${__VU}-${__ITER}-${Date.now()}`,
    });

    const res = http.post(`${BASE_URL}/api/guest/checkout/session`, payload, {
      headers: authHeaders(),
      tags: { name: "POST /api/guest/checkout/session" },
    });

    // A real launch-day pass needs a 201 with a Stripe test-mode session URL.
    // We also accept the documented "Stripe not configured" case (503) and
    // business-rule 4xxs (e.g. seller has no active Stripe account, no stock)
    // as non-fatal to the load test itself, but only 201 counts as a checkout
    // success for the checkout_success_rate SLO.
    const isSuccess = res.status === 201;
    checkoutSuccessRate.add(isSuccess);
    checkoutDuration.add(Date.now() - start);

    check(res, {
      "checkout session created (test mode) or documented non-fatal response": (r) =>
        r.status === 201 || r.status === 503 || r.status === 400 || r.status === 404 || r.status === 409,
      "checkout success returns a hosted session url": (r) => {
        if (r.status !== 201) return true; // not applicable
        try {
          const body = JSON.parse(r.body);
          return typeof body.url === "string" && body.url.startsWith("http");
        } catch (e) {
          return false;
        }
      },
      "checkout success session id looks like a Stripe test-mode session": (r) => {
        if (r.status !== 201) return true; // not applicable
        try {
          const body = JSON.parse(r.body);
          // Stripe Checkout Session ids always start with "cs_"; test vs. live
          // mode is controlled entirely by which secret key the server holds
          // (sk_test_... vs sk_live_...), not by the id shape itself — the
          // server-side key is what actually guarantees "test mode" here.
          return typeof body.sessionId === "string" && body.sessionId.startsWith("cs_");
        } catch (e) {
          return false;
        }
      },
    });
    thinkTime(2, 5);
  });
}

// ─── Scenario: messaging ──────────────────────────────────────────────────
// Requires auth. Lists conversations, then sends a message into the first
// existing one. Without AUTH_TOKEN, 401 is accepted as a documented outcome.

export function messaging() {
  group("messaging", () => {
    const list = http.get(`${BASE_URL}/api/conversations`, {
      headers: authHeaders(),
      tags: { name: "GET /api/conversations" },
    });
    check(list, {
      "conversations list succeeds or requires auth as expected": (r) =>
        r.status === 200 || (!AUTH_TOKEN && r.status === 401),
    });

    if (list.status !== 200) {
      thinkTime(1, 2);
      return;
    }

    let conversationId = null;
    try {
      const conversations = JSON.parse(list.body);
      conversationId = Array.isArray(conversations) && conversations.length > 0
        ? conversations[0].id
        : null;
    } catch (e) {
      conversationId = null;
    }

    if (!conversationId) {
      // No existing conversation for this token — nothing more to exercise.
      thinkTime(1, 2);
      return;
    }

    thinkTime(1, 3);

    const payload = JSON.stringify({
      text: `Load test message ${__VU}-${__ITER} at ${new Date().toISOString()}`,
    });
    const send = http.post(
      `${BASE_URL}/api/conversations/${conversationId}/messages`,
      payload,
      { headers: authHeaders(), tags: { name: "POST /api/conversations/:id/messages" } },
    );
    check(send, {
      "send message succeeds": (r) => r.status === 201,
      "sent message echoes text": (r) => {
        if (r.status !== 201) return true; // not applicable
        try {
          return typeof JSON.parse(r.body).text === "string";
        } catch (e) {
          return false;
        }
      },
    });
    thinkTime(1, 2);
  });
}
