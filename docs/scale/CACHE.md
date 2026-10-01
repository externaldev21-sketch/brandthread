# Cache and Redis (phase 3)

Everything here is **off until `REDIS_URL` is set**. With it unset, no code path changes: the response cache is a pass-through, rate limiting stays in Postgres.

## Env

| Var | Default | Meaning |
| --- | --- | --- |
| `REDIS_URL` | unset | `redis://` or `rediss://` URL (Upstash, Redis Cloud, ElastiCache, a local `redis-server`). Unset = feature off |
| `CACHE_DISABLED` | unset | `1` turns the response cache off while leaving Redis rate limiting on (kill switch) |
| `REDIS_COMMAND_TIMEOUT_MS` | 250 | Per-command timeout. A slow cache is treated like a down cache |
| `REDIS_COOLDOWN_MS` | 5000 | After a Redis error, skip Redis for this long (circuit breaker) so requests don't each wait out a timeout |

Sign-up: Upstash (upstash.com) or any managed Redis. **Choose a fixed-price plan past ~20k DAU**; pay-per-command pricing is the expensive way to run this (see SCALE_PLAN.md).

## What is cached

| Endpoint | Key | TTL | Varies by |
| --- | --- | --- | --- |
| `GET /api/public/search` | normalized query string | 30 s | viewer's block list |
| `GET /api/public/profiles/:username` | normalized URL | 20 s | viewer's block list |
| `GET /api/public/products/:id` | `rc:product:<id>` | 15 s | nothing (already served with public `Cache-Control`) |

Only `200` responses are stored. Responses carry `X-Cache: HIT | MISS | COALESCED`.

### Viewer scope (why this is safe)

Search and profiles hide content the viewer has blocked or been blocked by. Viewers with **no** block relationships get exactly the anonymous answer and share one cache entry. A viewer with **any** block gets a private entry (`u:<viewerId>`), so nobody is ever served another person's filtered view. "Has any block" is itself memoized for 60 s.

### Single-flight

If many requests miss the same key at once (a trending search, a viral product), one runs the handler and the rest wait for its answer. A hot key costs one database query, not N. This works per instance even before Redis is involved in the answer.

## Invalidation rules

- **Time:** every entry expires on its TTL. That is the staleness bound: search and profiles up to 30 s / 20 s, products up to 15 s on top of the existing 30 s HTTP cache header.
- **Product edits:** any non-GET to `/api/products/:id/...` that succeeds deletes `rc:product:<id>` immediately (mounted in `routes/index.ts`, so `products.ts` is untouched).
- **Stock and price are still enforced at checkout** from the database, never from the cache, so a stale product page cannot oversell.
- **Block / unblock:** the memoized "has any block" flag lasts up to 60 s; a user who just blocked someone may see one cached anonymous page for up to that long. Acceptable for search/profile browsing; messaging and feeds do not use this cache.

## Rate limits in Redis

`lib/rateLimitStore.ts` implements the same fixed-window counter as the Postgres bucket in one atomic Lua call. The limiter tries Redis first and falls back to Postgres if Redis is unset or errors, so a cache outage is never a 503 storm. Policies and numbers are unchanged (session 01Ct4Yvx owns those). Counters are not migrated between stores: switching `REDIS_URL` on or off resets everyone's current window once.

## Health

`GET /api/healthz/ready` now includes `checks.cache.status` (`disabled | ok | down`). It is informational: a down cache never makes an instance unready.

## Measured effect

Same code and data, Redis off vs on (local Redis, so network latency to a hosted Redis is not included; budget 1-5 ms per hit for Upstash). Raw JSON in `results/phase3/`.

| Scenario | Redis | Avg req/s completed | Dropped arrivals | 5xx | Endpoint p50 | Endpoint p95 | Postgres CPU |
|---|---|---:|---:|---:|---:|---:|---:|
| Realistic mix, 25→800 req/s | off | 50 | 16,586 | 2.3% | | | 306% |
| | **on** | **116** | **7,857** | **0%** | | | **182%** |
| Product page, 50→800 req/s | off | 232 | 156 | 0% | 5 ms | 336 ms | 64% |
| | **on** | 235 | **0** | 0% | **1 ms** | **4 ms** | **5%** |
| Profile, 50→800 req/s (off = phase 1 baseline run) | off | 235 | 0 | 0% | 2 ms | 3 ms | 40% |
| | on | 235 | 0 | 0% | 1 ms | 2 ms | **2%** |
| Search, realistic terms (half repeat, half unique tail), 5→160 req/s | off | 5 | 1,556 | 44.6% | 51 s | 60 s | 389% |
| | on | 7 | 1,461 | 19.1% | 18 s | 60 s | 431% |

Read this plainly:

- **Product and profile pages**: the cache removes them from the database (Postgres 64% → 5%, 40% → 2%). They were never the bottleneck, but they are the pages every share link and campaign lands on.
- **Search is not rescued by caching alone.** With realistic traffic half the queries are unique (typeahead prefixes, typos) and cannot hit a cache, so the database still saturates. A first run using only six repeated terms showed search at 0% errors and 1 ms; that number is not meaningful and is not claimed. Search needs the query fixes in the phase 2 PR **and** this cache together, and ultimately a search engine (Typesense/Meilisearch) for the tail.
- **Mix**: 2.3x the completed throughput and half the drops, with no errors, mostly because product/profile/search repeats no longer touch Postgres and the rate limiter now counts in Redis instead of writing a row per request.
- The For You, Following and DM feeds are per-user and do not benefit from a shared cache. They are bounded by one Node core per instance; see SCALE_PLAN.md.

## Not in this PR (and why)

- **Like / view counters in Redis.** Like counts today come from `COUNT(*)` over `interactions` for the ids on the page. Moving them to Redis counters changes the source of truth and needs a write-back job; that belongs with the durable queue (phase 4) so counts cannot be lost.
- **Feed pages.** The For You list already has a per-user cache table. Serving it from Redis, and filling it in the background, is phase 7.
- **Caching for signed-in-only feeds.** Per-user data (cart, DMs, following feed) is not shared, so a shared cache does not help there; the answer is horizontal scale.

## Run it locally

```bash
redis-server --port 6380 --daemonize yes
REDIS_URL=redis://127.0.0.1:6380 pnpm --filter @workspace/api-server run dev
REDIS_TEST_URL=redis://127.0.0.1:6380 pnpm --filter @workspace/api-server exec vitest run src/lib/__tests__/redis.integration.test.ts
```
