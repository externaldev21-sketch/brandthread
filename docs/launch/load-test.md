# Launch-day load test

`scripts/loadtest/launch-day.js` is a [k6](https://k6.io) script that simulates
launch-day buyer traffic against the api-server: browsing the feed, discover /
search, viewing a product, adding to cart, guest checkout up to a Stripe
**test-mode** Checkout Session, and messaging.

It is part of the launch-hardening effort. This document covers prerequisites,
how to run it, and how to read the results. **It does not itself change any
application code.**

## Status: not yet run against a live server

This script has been validated for correctness (k6 parses it, all scenarios
execute, checks/thresholds fire as designed) with a dry run against an
unreachable port — see "What was actually verified" below. It has **not**
been run against a real api-server with a real database in this environment:
there was no way here to provision Clerk test credentials, a Stripe test
secret key, or (given sandbox restrictions on privilege-escalating DB setup
commands) a seeded database for the api-server to serve from. Treat every
number this script produces as **unmeasured until you run it against a real
staging deploy**. Do not report numbers from this environment — there are
none; only run the script yourself and read its own output.

## Prerequisites

1. **k6** installed locally or in CI.
   - macOS: `brew install k6`
   - Linux: see https://k6.io/docs/get-started/installation/ (a static binary
     release also works — no root install required, e.g. download the
     `k6-vX.Y.Z-linux-amd64.tar.gz` asset from
     https://github.com/grafana/k6/releases and put the `k6` binary on `PATH`)
   - Verify: `k6 version`

2. **A running api-server** (`artifacts/api-server`) pointed at a **test or
   staging database**, never production. From the repo root:
   ```bash
   pnpm install
   pnpm --filter @workspace/api-server run build
   pnpm --filter @workspace/api-server run start
   ```
   or for a dev loop: `pnpm --filter @workspace/api-server run dev`.
   The server needs at minimum (see `.env.example` at the repo root):
   - `DATABASE_URL` — a test/staging Postgres instance with the schema
     migrated (`pnpm --filter @workspace/db run migrate`) and, ideally, some
     seed products/posts so the read scenarios have real data to return.
   - `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` — Clerk **test** instance
     keys, only needed for the auth-gated scenarios (see below).
   - `STRIPE_SECRET_KEY=sk_test_...` — a Stripe **test-mode** secret key. This
     is what makes the checkout scenario run in test mode: the api-server does
     not have a separate "test mode" flag of its own — mode is controlled
     entirely by which Stripe secret key it holds (`sk_test_...` vs.
     `sk_live_...`, see `artifacts/api-server/src/lib/stripe.ts`). **Never
     point this script at a server configured with a live (`sk_live_...`)
     key** — the checkout scenario creates real Stripe Checkout Sessions.
   - `SESSION_SECRET` — required for guest checkout's access-token signing.

3. **Some seed data.** At minimum one active product so the product-detail,
   add-to-cart, and checkout scenarios have something to exercise
   (`GET /api/public/products?limit=1` must return at least one row). The
   seller who owns it needs an active Stripe Connect account
   (`stripeAccountStatus = "active"`) for the checkout scenario to reach a
   real Checkout Session instead of a 400.

4. **A Clerk session token, for the auth-gated scenarios only.** The
   `add_to_cart` and `messaging` scenarios call endpoints behind
   `requireAuth` (Clerk). k6 cannot log in through Clerk's UI/SDK itself, so
   you need to mint a real session JWT for a test buyer account ahead of time
   (e.g. via Clerk's Testing Tokens / Backend API against your **test** Clerk
   instance) and pass it in as `AUTH_TOKEN`. **Without `AUTH_TOKEN`** those
   two scenarios still run and hit the real endpoints, but the script treats
   the resulting `401 Unauthorized` as an accepted (non-failing) outcome so
   the rest of the run still produces a usable signal — you just won't be
   measuring authenticated add-to-cart / messaging latency. For a full
   launch-day signal, provide a real token.

## Running it

From the repo root:

```bash
BASE_URL=https://staging.brandthread.example \
AUTH_TOKEN=eyJhbGciOi... \
CHECKOUT_EMAIL=loadtest+guest@example.com \
k6 run scripts/loadtest/launch-day.js
```

Environment variables:

| Variable          | Required | Default                     | Purpose                                                                 |
|--------------------|----------|------------------------------|--------------------------------------------------------------------------|
| `BASE_URL`         | recommended | `http://localhost:5000`   | Base URL of the api-server under test.                                  |
| `AUTH_TOKEN`       | no       | (empty)                     | Clerk session JWT for a test buyer. Enables the authenticated scenarios.|
| `CHECKOUT_EMAIL`   | no       | `loadtest+guest@example.com`| Contact email used on guest checkout sessions.                          |
| `SEED_PRODUCT_ID`  | no       | (empty — auto-discovered)   | Force a specific product id instead of picking the first active one.    |

Never pass a real user's Clerk token or a production Stripe key. Use a
disposable test buyer account and a `sk_test_...` server key.

### Useful k6 flags

- `k6 run --out json=results.json scripts/loadtest/launch-day.js` — dump raw
  metrics for later analysis.
- `k6 run --vus 1 --iterations 1 scripts/loadtest/launch-day.js` — **does not
  reduce this script's own scenarios** (k6 ignores `--vus`/`--iterations`
  whenever `options.scenarios` is defined, which this script uses for its
  weighted mix). To do a quick smoke run instead, temporarily shrink the
  `duration`/`stages` values in `scripts/loadtest/launch-day.js`, or scope a
  single scenario with `k6 run --tag testid=smoke -e ... scripts/loadtest/launch-day.js`
  and Ctrl-C once you've seen a handful of iterations succeed.

## What the test simulates

A weighted mix of six scenarios running concurrently for ~5 minutes
(ramp up → steady state → ramp down), approximating a launch-day traffic
split — read-heavy browsing dominates, checkout and messaging are a smaller
slice:

| Scenario              | Executor               | Approx. peak concurrency | Endpoints |
|------------------------|-------------------------|---------------------------|-----------|
| `browse_feed`          | ramping-vus             | 40 VUs                   | `GET /api/public/posts`, `GET /api/public/trending` |
| `discover_search`      | ramping-vus             | 20 VUs                   | `GET /api/public/search`, `GET /api/public/drops` |
| `view_product`         | ramping-vus             | 25 VUs                   | `GET /api/public/products`, `GET /api/public/products/:id`, `GET /api/public/products/:id/related` |
| `add_to_cart`          | ramping-vus             | 10 VUs                   | `POST /api/buyer/cart/sync`, `GET /api/buyer/cart` (auth) |
| `checkout_test_mode`   | constant-arrival-rate   | 3 iterations/min         | `GET /api/public/products/:id`, `POST /api/guest/checkout/session` (Stripe test mode) |
| `messaging`            | ramping-vus             | 5 VUs                    | `GET /api/conversations`, `POST /api/conversations/:id/messages` (auth) |

Each iteration includes realistic think-time (`sleep()` between 1–6 seconds)
between requests, mimicking a real user reading a page before acting.

### Checkout scope

The checkout scenario calls the **guest** checkout endpoint
(`POST /api/guest/checkout/session`), because that path needs no Clerk auth
and so can run without an `AUTH_TOKEN`. It validates the cart, resolves the
seller's charge plan, and calls `stripe.checkout.sessions.create(...)` in
test mode (assuming the server holds an `sk_test_...` key), returning a
hosted Stripe Checkout URL. **The script stops there.** Actually completing
payment happens on Stripe's own hosted checkout page (card entry, 3DS, etc.),
which is outside the api-server's surface and outside the scope of an API
load test — see `artifacts/api-server/src/routes/guest-checkout.ts`.

### Messaging scope

`messaging` lists the authenticated buyer's existing conversations and, if
one exists, sends a message into it (`POST /api/conversations/:id/messages`).
It does not create a brand-new conversation (`POST /api/conversations`)
because that call needs a real second user's id/handle to message, which this
script doesn't try to fabricate — seed the test buyer with at least one
existing conversation for full coverage.

## Interpreting the output

k6 prints a summary at the end of the run. The important pieces:

- **`http_req_duration`** — request latency, broken out per scenario via the
  `{scenario:...}` tags. `p(95)` is the number the thresholds below check
  against.
- **`http_req_failed`** — the fraction of requests k6 considers failed
  (network errors, or non-2xx/3xx responses that aren't wrapped in a
  passing `check()`).
- **`checks`** — pass rate of the explicit `check()` assertions in the
  script (status codes, response-shape checks). A drop here often points to
  a specific behavioral regression even when latency looks fine.
- **`checkout_success_rate`** (custom metric) — fraction of checkout
  iterations that got a real `201` with a Stripe test-mode session URL, as
  opposed to a documented non-fatal outcome (missing seed data, Stripe not
  configured, seller not payment-ready, etc.). This is tracked separately
  from `http_req_failed` because a 503/400 checkout response is a valid,
  non-crashing server behavior that should not count as a load-test
  "failure" the same way a 500 or timeout would — but the run should still
  fail if it happens too often, hence the `checkout_success_rate` threshold.

## Thresholds (pass/fail)

Defined in `options.thresholds` in the script:

```js
http_req_failed: ["rate<0.01"],           // <1% error rate overall
http_req_duration: ["p(95)<800"],         // p95 < 800ms overall
"http_req_duration{scenario:browse_feed}": ["p(95)<500"],
"http_req_duration{scenario:discover_search}": ["p(95)<600"],
"http_req_duration{scenario:view_product}": ["p(95)<600"],
"http_req_duration{scenario:add_to_cart}": ["p(95)<800"],
"http_req_duration{scenario:checkout_test_mode}": ["p(95)<1500"],
"http_req_duration{scenario:messaging}": ["p(95)<800"],
checkout_success_rate: ["rate>0.95"],
```

If **any** threshold is crossed, k6 exits non-zero and prints which
threshold(s) failed — this is what makes the script useful in CI/CD as a
launch-day go/no-go gate, not just an informational report.

These numbers are starting defaults, not settled SLOs — adjust them to match
your actual launch-day targets and infrastructure (e.g. tighten
`browse_feed`'s budget if it's served from a CDN/cache, loosen
`checkout_test_mode`'s if Stripe round-trips are inherently slower than you'd
like your own DB calls to be). Edit `options.thresholds` in
`scripts/loadtest/launch-day.js` directly.

## What was actually verified in this environment

- k6 v0.54.0 was downloaded and installed (`k6 version` succeeds) since no
  package manager here had it available.
- The script was **dry-run** with `BASE_URL` pointed at a closed local port,
  using a temporary copy with the scenario durations shrunk to a few seconds
  each, purely to confirm: the script parses, every scenario's exported
  function (`browseFeed`, `discoverSearch`, `viewProduct`, `addToCart`,
  `checkoutTestMode`, `messaging`) executes without a JavaScript runtime
  error, `check()` calls evaluate, and the custom `checkout_success_rate`
  metric and thresholds behave as intended (the run correctly failed with
  connection-refused errors, as expected against a dead port).
- Standing up a real api-server here (Clerk test keys, a Stripe test key,
  and DB setup requiring privilege-elevated commands that this sandboxed
  worktree environment blocks) was not possible in this session. **Run this
  script against a real staging deploy, per the prerequisites above, before
  relying on its numbers for a launch decision.**
