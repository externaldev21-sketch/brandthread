# Scale plan: hundreds of thousands of users, 24/7

Status: **Phase 1 (load test) is done and measured. Phases 2-9 are designed here and ship as separate PRs, each behind env flags.**
Nothing in this plan changes UI. Nothing here migrates hosting without Dev's OK.

## 1. Answer first

**No, the app as it stands will not hold hundreds of thousands of concurrent users.** Measured on a 4-core box shared by the API, Postgres and the load generator:

| What | Result |
| --- | --- |
| Realistic traffic mix | Averaged only **~54 requests/s** over a 25-to-800 ramp (p50 5-24 s, 16k dropped arrivals). Postgres is pinned at ~3 cores. |
| Search | Dies at **under 10 req/s** (59% of requests time out at 60 s). |
| Video playback lookup | p95 4.6 s above ~100 req/s; Postgres at 3.3 cores. |
| For You / Following feed | p50 1.5-3.7 s, p95 10-14 s above ~100 req/s (one saturated Node core). |
| DM thread read | p95 1.6 s above ~100 req/s (one saturated Node core). |
| Profile, product, DM list, DM send | Fine. One Node core served ~800 req/s with p95 under 45 ms. |

The cheap endpoints are not the problem. Four things are, and they are all fixable without a rewrite:

1. **Video bytes go through the API.** `GET /api/posts/media/*` (`routes/post-video.ts:622`) looks the post up with `media_url LIKE '%...'` (no index, sequential scan on `posts`), checks ACLs, fetches GCS metadata, then streams the file through Express. Every feed swipe is a DB scan plus a proxied download.
2. **Every request writes to Postgres.** The rate limiter (`middlewares/rateLimit.ts:197`) runs an `INSERT ... ON CONFLICT` plus a `DELETE` of expired buckets on **every** request, authenticated or not. The table already holds 87k rows (16 MB) after a short test. At 20k req/s that is 20k writes/s to one table.
3. **Search is a full scan.** `/api/public/search` runs unions of trigram/relevance queries over users, products and posts, with no result cache.
4. **State lives inside one process.** WebSocket rooms (`ws/liveHub.ts`, `ws/communityHub.ts`) are in-process `Map`s, and all **15** background jobs start from `setInterval` in `src/index.ts`. With more than one autoscaled instance, chat messages only reach sockets on the same instance, and every job (money sweep, abandoned-cart emails, push batches) runs once per instance.

Other findings: uploads are buffered in API memory (`/api/posts/video-clips` takes up to 80 MB raw, `compose-video` runs 1080x1920 ffmpeg inside the request, JSON body limit is 45 MB); pagination is `OFFSET` in 23 places; the DB pool is the `pg` default (10 connections, no statement timeout); the For You ranking recomputes per user in-process and caches in Postgres (`for_you_feed_cache`).

## 2. How I measured

Harness: `artifacts/api-server/loadtest/` (see its README). It builds the **real API** with Clerk swapped for a header-based stub (a separate bundle, never part of `pnpm build`), seeds a throwaway local Postgres 16 with 20k users, 60k posts, 8k products, 380k follows, 500k messages, 200k interactions, and drives it with k6 using an open-model ramping arrival rate, so the load does not slow down when the server does. Every request carries a distinct client IP, so the per-IP limiter behaves like production. Nothing touches Stripe, OpenAI, GCS or any real database.

Caveats, stated plainly: one machine shared by k6, Node and Postgres (4 cores), no network latency, no real bucket (media 404s at the storage step, so the DB lookup is what is measured). Absolute numbers are a floor for a dedicated setup; the **ratios and the shape of the failures** are what matter. Full tables: [`baseline-results.md`](./baseline-results.md). The seed gives captions and product names varied vocabulary; an earlier run with identical captions overstated search cost and was discarded.

## 3. Target architecture

```
Mobile app ──HLS/images──▶ CDN (Cloudflare) ──▶ Mux / R2 (video, image variants)
    │  signed direct uploads ─────────────────▶ object storage (never through the API)
    │
    ├──REST──▶ Load balancer ──▶ API instances (stateless, N, autoscaled)
    │                              │   ├─▶ Redis: cache, counters, rate limits, pub/sub, BullMQ
    │                              │   └─▶ PgBouncer ─▶ Postgres primary (+ read replicas)
    └──WS────▶ same API instances, rooms fanned out over Redis pub/sub

Worker processes (same codebase, WORKER=1): BullMQ consumers for transcode callbacks, push, email,
refunds, analytics rollups, feed fan-out. One scheduler elects itself via a Redis lock.
```

Every box above is switched on by an env var and falls back to today's behavior when it is missing.

## 4. Phases (one PR each, in this order)

| # | PR | Flag / env | Fixes | Done when |
| --- | --- | --- | --- | --- |
| 1 | Load tests + this plan | none | measures everything | k6 suite and baseline committed (this PR) |
| 2 | Database | `DB_POOL_MAX`, `DB_STATEMENT_TIMEOUT_MS`, `DATABASE_READ_URL` | Rate-limit write amplification, media lookup scan, DM delete-on-read, search scan, OFFSET -> cursor, N+1s, statement timeouts | Mix holds 5x the baseline rate with p95 < 300 ms |
| 3 | Cache | `REDIS_URL` | Feed pages, like/view counters, rate limits in Redis, hot profiles/products, search results | Off: identical to today. On: DB CPU flat as read rate rises |
| 4 | Jobs | `REDIS_URL`, `WORKER=1` | Durable BullMQ queue with retries and dead-letter, single scheduler | Each job runs once with N instances |
| 5 | Media | `VIDEO_PROVIDER=mux`, `MUX_*`, `IMAGE_CDN_BASE_URL` | Signed direct upload, adaptive HLS, thumbnails, image variants, CDN cache headers | Zero video bytes through the API |
| 6 | Realtime | `REDIS_URL` | Redis pub/sub adapter for live and community rooms, client reconnect with backoff | Two instances deliver to each other's sockets |
| 7 | Feed | `REDIS_URL` | Background fan-out of For You / Following candidates; API only reads | Feed p95 < 100 ms at 10x baseline |
| 8 | Resilience | `CIRCUIT_BREAKER_*` | Timeouts + breakers on Stripe/Shippo/OpenAI/fal/Agora, idempotency keys, upload backpressure, autoscale config, uptime/alerting doc | Third-party outage never takes the API down |
| 9 | Hosting verdict | none | Section 7 below, with migration steps | Dev decides |

Already in the repo and kept as is: `/healthz`, `/healthz/live`, `/healthz/ready`; graceful SIGTERM drain; Stripe webhook ledger; checkout idempotency keys; strong index coverage (trigram GINs, partial indexes, FK indexes). The coordinating session (01Ct4Yvx) owns general perf, Sentry and rate-limit policy numbers; Phase 2 changes only where rate-limit counters are stored, not the limits.

## 5. Monthly cost estimates

Assumptions (adjust in one place and re-derive): DAU split 2% creators; each viewer watches 40 videos/day at ~10 s each (~200 min/month); peak concurrency 8% of DAU; 0.5 req/s per concurrent user at peak; one API core serves ~400 req/s of cached traffic (measured ~800 for the cheapest paths, halved for headroom); ~1.5 MB per 10 s of video at the delivered bitrate.

Derived load: **10k DAU** = 800 concurrent, 400 req/s peak, 2M min/month watched. **100k DAU** = 8k concurrent, 4k req/s, 20M min. **500k DAU** = 40k concurrent, 20k req/s, 100M min. (100k+ *concurrent* needs roughly 1.5M+ DAU, beyond the third column.)

Prices are public list prices as I could find them, rounded; treat each line as plus or minus 40% and confirm before committing. I could not read vendor pricing pages from this environment, so figures marked * are from third-party summaries or memory.

| Line | 10k DAU | 100k DAU | 500k DAU |
| --- | ---: | ---: | ---: |
| API compute (2 vCPU instances, managed container host) | $100 | $700 | $3,000 |
| Postgres (managed, PgBouncer, replicas at 100k+) | $150 | $1,200 | $5,500 |
| Redis (fixed-size plan; pay-per-command gets expensive at this volume) | $50 | $350 | $1,800 |
| Video, **Mux*** ($0.0008/min delivered, $0.003/min stored, encoding amortised) | $1,700 | $16,500 | $82,000 |
| Video, Cloudflare Stream* ($1/1000 min delivered, $5/1000 min stored) | $2,100 | $20,500 | $106,000 |
| Video, **R2 + own ffmpeg workers + Cloudflare CDN*** (no egress fees) | $150 | $900 | $3,500 |
| Image variants (R2 + CDN) | $20 | $150 | $700 |
| Realtime (self-hosted over Redis pub/sub; managed Ably adds ~$500-3k) | $0 | $0 | $0 |
| Clerk* (~$0.02 per MAU above the free tier) | $200 | $2,000 | $9,800 |
| Monitoring / alerting / status page | $80 | $200 | $500 |
| **Total with Mux** | **~$2.3k** | **~$21k** | **~$103k** |
| **Total with R2 path** | **~$0.8k** | **~$5.5k** | **~$25k** |

Reading it: **video delivery is the bill.** Everything else together is under $25k even at 500k DAU.

### Video recommendation

**Launch on Mux, plan the R2 exit.** Mux has direct-upload URLs, webhooks, signed playback, auto thumbnails and per-minute delivery slightly under Cloudflare Stream's ($0.80 vs $1.00 per 1000 min), and you pay nothing until there is traffic. Phase 5 builds a `VideoProvider` interface so the same upload/playback code can later point at an R2 + ffmpeg-worker + Cloudflare CDN pipeline, which costs about 5% as much at 100k DAU and above. Switch when the Mux bill passes roughly $5-8k/month; that is also when a transcode worker pool is worth operating. Cloudflare Stream is a fine alternative if you would rather have one vendor for CDN, images and video; it costs about 25% more in delivery.

## 6. What Dev must sign up for

Nothing is required to merge Phases 1-2. Everything else is off until the keys exist; a missing key never crashes the server.

| Service | Phase | Exact env vars | Where |
| --- | --- | --- | --- |
| Redis (Upstash, or any `rediss://` provider) | 3, 4, 6, 7 | `REDIS_URL` | upstash.com. Choose a fixed plan, not pay-per-command, past ~20k DAU |
| Postgres pooler (Neon pooled URL, Supabase pooler, or self-run PgBouncer) | 2 | `DATABASE_URL` (pooled), optional `DATABASE_READ_URL` | neon.tech / supabase.com |
| Mux | 5 | `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`, `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_KEY_PRIVATE`, `VIDEO_PROVIDER=mux` | mux.com |
| Cloudflare (CDN + R2 for image variants) | 5 | `IMAGE_CDN_BASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | cloudflare.com |
| Uptime monitor + status page (Better Stack or UptimeRobot) | 8 | none (points at `/api/healthz/ready`) | betterstack.com |
| Optional managed realtime (Ably) | 6 | `ABLY_API_KEY` | ably.com, only if you prefer not to self-host over Redis |

## 7. Hosting verdict (decision for Dev; nothing is migrated)

**Replit Autoscale can serve the stateless HTTP part of this app, but it is not where I would run 100k+ concurrent users, and nothing here should be taken as a Replit benchmark.** I could not test Replit's platform limits from here, so the following rests on what I measured and on how the platform is documented:

- The API process is single-threaded: one core topped out near 110% CPU in every run. Capacity is therefore purely "number of instances", and Autoscale can add instances, but each carries its own DB pool, WebSocket rooms and job timers. That is why Phases 2-6 are prerequisites no matter where it runs.
- Even after those phases, three platform questions decide it, and they should be put to Replit support in writing before any 50k+ DAU launch: the maximum instance count and per-instance connection cap on your plan; whether long-lived WebSockets survive scale-down and deploys; and whether workers (Phase 4) can run as a separate always-on deployment.
- Replit/GCS object storage is fine as the origin for media but should sit behind a CDN, not behind Express.

**My recommendation:** keep Replit through Phases 1-4 (up to roughly 10-30k DAU, which the measured fixes should carry). Start the move before 50k DAU, in this order, each step reversible:

1. Stand up managed Postgres with a pooler (Neon or Supabase) and point staging at it; replay the k6 suite. No app change beyond `DATABASE_URL`.
2. Stand up Redis and enable Phases 3-4 on the existing host. Verify with the k6 suite.
3. Move media to Mux + CDN (Phase 5). This removes the largest traffic and bandwidth bill from the API host.
4. Run a second copy of the API on Fly.io or Render (a Dockerfile and `fly.toml` are small; the app is one Node process plus one worker) alongside Replit, route 5% of traffic by DNS weight, compare error rate and p95, then ramp.
5. Cut over DNS, keep Replit as warm standby for a week, then retire it.

AWS (ECS Fargate + RDS + ElastiCache) is the right answer above ~300k DAU if you want one cloud with committed-use discounts; Fly or Render are simpler and cheaper below that. I would not start there.

## 8. Risks to know about now

- Today, with exactly one instance, the duplicate-job problem is invisible. **Do not raise Autoscale max instances above 1 until Phase 4 lands**, or abandoned-cart and money-sweep jobs run on each instance. Check whether your deployment already runs more than one.
- ~~The rate limiter fails closed (503) if Postgres is slow.~~ Fixed by BT-474: counting is in Redis or per-instance memory, Postgres only gets a batched sync for security/money buckets, and only security buckets fail closed (`DATABASE.md`). Cross-instance WebSockets (`REALTIME.md`), media redirects (`MEDIA_CDN.md`) and the deployment split plan (`DEPLOYMENTS.md`) shipped with it.
- Clerk and Mux bills scale with users and minutes, not servers; set billing alerts before launch campaigns.
