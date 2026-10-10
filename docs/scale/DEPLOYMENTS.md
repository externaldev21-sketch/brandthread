# Deployments: splitting the single Replit deployment (BT-475)

Status: **plan only.** Nothing in this PR changes `.replit` or any `artifact.toml`; the current deployment keeps running exactly as it is until Dev does the cut-over below. Every step is reversible.

## 1. Today

One Replit deployment (`.replit`: `deploymentTarget = "autoscale"`, `router = "application"`) serves everything on `brandthread.app`, routed by path:

| Path | Service | How it runs | Health |
| --- | --- | --- | --- |
| `/api/*`, `/ws/live`, `/ws/community` | API (`artifacts/api-server`) | `node artifacts/api-server/dist/index.mjs`, port 8080, **also runs all background jobs** | `/api/healthz` (startup check) |
| `/` | Expo web app (`artifacts/mobile`) | `node artifacts/mobile/server/serve.js`, port 18115 (share previews and landing are rendered by this Node server, so it is not purely static) | `/status` |
| `/manufacturers/` | Manufacturer portal + web admin | static, `artifacts/manufacturer-portal/dist/public` | page loads |
| `/app-tour/` | App tour | static, `artifacts/app-tour/dist/public` | page loads |

One bad build, one crash loop or one platform incident takes down buyer checkout, web subscriptions, B2B payments, the admin and every webhook at once, and nobody is paged.

## 2. Target

```
                         Cloudflare (brandthread.app, proxied)
                         Worker: route by path, nothing else
             ┌──────────────┬──────────────┬───────────────┬──────────────┐
  /api/*, /ws/*        /manufacturers/*     /app-tour/*      everything else
       │                     │                   │                  │
 brandthread-api       brandthread-portal   brandthread-tour   brandthread-web
 Reserved VM           Static deployment    Static deployment  Autoscale (min 1)
 API + jobs + WS
```

Why path routing behind one hostname, not subdomains:

- **Native apps keep working.** iOS/Android builds have `EXPO_PUBLIC_API_BASE_URL` baked in. A new API hostname would need an app release first.
- **No webhook URL changes.** Stripe, RevenueCat, Shippo, Shopify and Resend keep posting to `https://brandthread.app/api/webhooks/...`.
- **No CORS or auth changes.** The portal and web app call `/api/...` on their own origin; the Clerk proxy stays at `/api/__clerk`.

(Subdomains are possible later. Set `CORS_EXTRA_ORIGINS=https://manufacturers.brandthread.app,...` on the API (added in this PR), add the origins in Clerk → Domains/Allowed origins, update the Clerk proxy URL, every webhook URL, and ship app builds with the new `EXPO_PUBLIC_API_BASE_URL` first.)

### Why a Reserved VM for the API

Background jobs (money sweep, payouts, abandoned-cart, push batches, trial reminders, scheduled posts, ...) start inside the API process. On Autoscale they run once **per instance** and stop when the deployment scales to zero. A Reserved VM is always on and a single instance, which is exactly what the jobs need today. WebSockets also prefer a machine that is not scaled down under them.

## 3. Deployments, commands and env

Create each new deployment as its **own Repl** imported from the same GitHub repo (`dev` or a release branch): Replit → Create Repl → Import from GitHub. Leave the current Repl and its deployment untouched; it is the rollback target.

### brandthread-api (Replit Reserved VM)

- Build: `pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build`
- Run: `node --enable-source-maps artifacts/api-server/dist/index.mjs`
- Machine: start with 2 vCPU / 4 GiB (one Node process uses one core; the second core is for GC, ffmpeg jobs and the OS).
- Health check path: `/api/healthz` (liveness). Point monitors at `/api/healthz/ready` (checks Postgres).

| Env | Value / where it comes from |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `DATABASE_URL` | **Copy the current production value** from the existing deployment's Secrets. A new Repl gets its own empty database otherwise. |
| `REALTIME_DATABASE_URL` | Only if `DATABASE_URL` is a pooled URL: the direct (unpooled) URL of the same database. Neon: same string without `-pooler` in the host. |
| `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Copy from the current deployment, and in the new Repl open **Object Storage** and connect the existing bucket. URL signing goes through the Repl's storage sidecar, which only signs for buckets attached to that Repl. Verify with the media check in §6. |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET` | Copy |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Copy |
| `REVENUECAT_*`, `SHIPPO_*`, `RESEND_*`, `MAIL_FROM`, `AGORA_*`, `AI_INTEGRATIONS_*`, `GOOGLE_MAPS_API_KEY`, `SENTRY_DSN`, `POSTHOG_API_KEY`, and every other secret on the current deployment | Copy all of them. Easiest: Secrets pane → "Edit as JSON" in the old Repl, paste into the new one. |
| `REDIS_URL` (optional, recommended) | upstash.com → Create database (fixed plan, region near the DB) → "Connect" → `rediss://...` URL. Moves rate limits, realtime and cache off Postgres. |
| `CDN_BASE_URL` (optional) | See `MEDIA_CDN.md`. |
| `DB_POOL_MAX` etc. | Defaults are fine for one instance (`DATABASE.md`). |

### brandthread-web (Replit Autoscale, min instances 1)

- Build: `pnpm install --frozen-lockfile && pnpm --filter @workspace/mobile run build`
- Run: `node artifacts/mobile/server/serve.js`
- Health check path: `/status`
- Env: `NODE_ENV=production` at build and run (with it, `scripts/build-web.js` pins the API base to `https://brandthread.app` and the Clerk proxy to `https://brandthread.app/api/__clerk`, which the Worker routes to the API), `PORT=18115`, `BASE_PATH=/`, `CLERK_PUBLISHABLE_KEY`, plus the public keys the current deployment has: `EXPO_PUBLIC_REVENUECAT_*`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_POSTHOG_*`, `EXPO_PUBLIC_SENTRY_*`, `EXPO_PUBLIC_META_PIXEL_ID`, `EXPO_PUBLIC_TIKTOK_PIXEL_ID`, `EXPO_PUBLIC_CDN_BASE_URL` (if set). No server secrets. (`SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` only if you upload source maps today.)
- Min instances 1 avoids a cold start on the first visit.

### brandthread-portal (Replit Static)

- Build: `pnpm install --frozen-lockfile && BASE_PATH=/manufacturers/ pnpm --filter @workspace/manufacturer-portal run build`
- Public directory: `artifacts/manufacturer-portal/dist/public`; rewrite `/*` → `/index.html`
- Env (build time): `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PROXY_URL` (if set today).

### brandthread-tour (Replit Static)

- Build: `pnpm install --frozen-lockfile && BASE_PATH=/app-tour/ pnpm --filter @workspace/app-tour run build`
- Public directory: `artifacts/app-tour/dist/public`; rewrite `/*` → `/index.html`

## 4. Routing (Cloudflare Worker)

Prerequisite: `brandthread.app` DNS on Cloudflare, proxied (orange cloud). Workers & Pages → Create Worker → paste, then Settings → Triggers → Routes → `brandthread.app/*`:

```js
// Origins: each deployment's *.replit.app hostname (Deployments tab → URL).
const API = "https://brandthread-api.replit.app";
const PORTAL = "https://brandthread-portal.replit.app";
const TOUR = "https://brandthread-tour.replit.app";
const WEB = "https://brandthread-web.replit.app";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const p = url.pathname;
    const origin =
      p.startsWith("/api/") || p === "/api" || p.startsWith("/ws/") ? API
      : p.startsWith("/manufacturers") ? PORTAL
      : p.startsWith("/app-tour") ? TOUR
      : WEB;
    const target = new URL(p + url.search, origin);
    // Passes method, headers, body and WebSocket upgrades through unchanged.
    return fetch(new Request(target, request));
  },
};
```

Notes:
- Raw request bodies are passed through byte for byte, so Stripe/Shopify/Resend signature checks keep working.
- The API sees requests from Cloudflare; client IPs arrive in `X-Forwarded-For` / `CF-Connecting-IP` exactly as with Replit's own proxy (Express already uses `trust proxy`). Spot-check that rate-limit identities are per client after cut-over (§6).
- WebSockets (`/ws/live`, `/ws/community`) are proxied by `fetch` with the upgrade header; Cloudflare supports this on all plans.

## 5. Webhooks and third-party dashboards

With path routing none of these change. Listed so Dev can confirm each one after cut-over (each dashboard shows recent deliveries):

| Provider | URL | Where |
| --- | --- | --- |
| Stripe | `https://brandthread.app/api/webhooks/stripe` | Stripe → Developers → Webhooks |
| RevenueCat | `https://brandthread.app/api/webhooks/revenuecat` | RevenueCat → Project → Integrations → Webhooks |
| Shippo | `https://brandthread.app/api/webhooks/shippo` | Shippo → Settings → Webhooks |
| Shopify (per connected store) | `https://brandthread.app/api/webhooks/shopify` | registered by the app on connect |
| Resend (marketing events) | `https://brandthread.app/api/webhooks/resend-marketing` | Resend → Webhooks |
| Mux (after #757) | `https://brandthread.app/api/webhooks/mux` | Mux → Settings → Webhooks |
| Clerk | no webhook is used by the code today; Clerk is called directly and through the `/api/__clerk` proxy | Clerk → Domains: keep `brandthread.app` |

## 6. Cut-over runbook (about 1 hour, do it off-peak)

1. Create the four Repls and deployments (§3). Deploy each. Open each `*.replit.app` URL directly:
   - `curl -s https://brandthread-api.replit.app/api/healthz/ready` → `{"status":"ok",...}` with `checks.database.ok: true`.
   - `https://brandthread-web.replit.app/status` → 200; the web app loads (it calls `https://brandthread.app/api`, i.e. still the old API: fine).
   - `https://brandthread-portal.replit.app/manufacturers/` and `/app-tour/` load.
   - Media: `curl -sI https://brandthread-api.replit.app/api/posts/media/<a public post video path>` → `302` (signing works, bucket attached).
2. **Stop jobs on the old deployment before the new API takes traffic**, or both run them: set `BACKGROUND_JOBS_ENABLED=false` on the old deployment once #744 has merged; until then, accept up to a few minutes of overlap or schedule the cut-over right after a job tick. (Without #744 there is no switch; this is a reason to merge it first.)
3. Publish the Worker with routes (§4). Traffic moves within seconds.
4. Verify on `https://brandthread.app`: sign in on web, open a product, start (do not finish) a checkout, open the manufacturer portal, open a live stream and a community chat. Check Stripe → Webhooks → recent deliveries are 2xx. Check `/api/healthz/ready`.
5. Keep the old deployment running for a week as warm standby, then shut it down.

## 7. Rollback

| Problem | Do this | Time |
| --- | --- | --- |
| Anything after cut-over | Cloudflare → Workers → Routes → delete the `brandthread.app/*` route. Traffic returns to the old single deployment (keep it running for a week). | seconds |
| A bad build of one deployment | Replit → that Repl → Deployments → History → pick the last good deployment → Redeploy/Rollback | 1-3 min |
| Bad media redirects | API env `MEDIA_DELIVERY=stream` (proxy as before), or remove `CDN_BASE_URL` | redeploy |
| Realtime bus misbehaving | `REALTIME_BUS=inprocess` (single instance only) | redeploy |
| Rate limiter | `RATE_LIMIT_STORE=postgres` (old per-request Postgres writes) | redeploy |
| DB timeouts too tight | raise `DB_STATEMENT_TIMEOUT_MS` / `DB_IDLE_IN_TX_TIMEOUT_MS`, or `DB_POOL_DEFAULTS=off` | redeploy |

Database migrations in this repo are additive (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), so rolling the code back never needs a schema rollback.

## 8. Instance counts until the bus and the job lock are live

| Deployment | Max instances |
| --- | --- |
| Current single deployment (today) | **1.** It is `autoscale`; check Deployments → Settings → Max instances now. With more than one instance, jobs run twice. |
| brandthread-api | Reserved VM = 1. Move to Autoscale with N > 1 only after **both** this PR (cross-instance WebSockets) **and** #744 (job leader lock) are deployed. |
| brandthread-web, portal, tour | Any; they hold no state. |

When the API does scale out, keep `instances x (DB_POOL_MAX + 1 realtime LISTEN connection + JOB_LOCK_POOL_MAX from #744)` under the database's connection limit, or put the API on a pooled `DATABASE_URL` with `REALTIME_DATABASE_URL` pointing at the direct host (`DATABASE.md`, `REALTIME.md`).

## 9. Uptime monitoring and phone alerts (Better Stack)

1. Sign up at **betterstack.com** → Uptime. (UptimeRobot is a fine alternative with the same setup.)
2. Monitors → Create monitor, one per row, check every 1 minute from at least 2 regions, alert after 2 failed checks:

| Monitor | URL | Type / expectation |
| --- | --- | --- |
| API ready | `https://brandthread.app/api/healthz/ready` | Keyword `"status":"ok"` (a 503 means the database is unreachable) |
| API alive | `https://brandthread.app/api/healthz/live` | Status 200 |
| Web app | `https://brandthread.app/status` | Status 200 |
| Manufacturer portal | `https://brandthread.app/manufacturers/` | Status 200 |
| SSL | `brandthread.app` | Certificate expiry, alert 14 days ahead |
| Stripe webhook health | Stripe → Developers → Webhooks → endpoint → "Email me on failures" | Stripe's own alert (Better Stack cannot see this) |

3. **Phone alerts:** Better Stack → On-call → your profile → add and verify your phone number; in the escalation policy enable **Call** and **SMS** for the API monitors (email-only for the rest). Phone and SMS alerts need a paid responder seat; check current pricing.
4. Install the Better Stack mobile app and allow critical alerts, so a page breaks through Do Not Disturb.
5. Optional: Status pages → create `status.brandthread.app` from these monitors and link it from support replies during incidents.

Once the API has an always-on Reserved VM, also add a **heartbeat** monitor for background jobs (a job pings a Better Stack heartbeat URL each run, and a missed beat pages). That needs one line in the job runner and is left for after #744 merges.
