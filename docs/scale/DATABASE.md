# Database scaling (phase 2)

In production (`NODE_ENV=production`) the pool now has safe defaults (BT-474); outside production, with nothing set, connection behavior is identical to before. Every value is overridable; `0` or `off` turns one off. `DB_POOL_DEFAULTS=off` restores the old no-defaults behavior in production, `DB_POOL_DEFAULTS=on` applies the defaults anywhere.

## Env

| Var | Production default | Elsewhere | Meaning |
| --- | --- | --- | --- |
| `DB_POOL_MAX` | 10 | pg default (10) | Max connections **per API instance** |
| `DB_POOL_IDLE_MS` | 30000 | pg default (10 s) | Close idle connections after this long |
| `DB_CONNECT_TIMEOUT_MS` | 10000 | none | Fail a request fast instead of queueing forever for a connection |
| `DB_STATEMENT_TIMEOUT_MS` | 15000 | none | Server-side cap on any one statement |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | 60000 | none | Kill transactions left open and idle (60 s leaves room for a Stripe call inside a transaction) |
| `DB_POOL_DEFAULTS` | on | off | Force the defaults above on or off |
| `DATABASE_READ_URL` | unset | unset | Read replica (opt-in). `readDb` uses it; unset means `readDb === db` |

If a background job ever logs `canceling statement due to statement timeout`, raise `DB_STATEMENT_TIMEOUT_MS` (or set it to `off`) while that query is fixed; requests are better served failing at 15 s than queueing behind it.

## Rate limiter storage (BT-474)

The app-wide limiter no longer writes Postgres on every request.

| Setup | Where requests are counted | Postgres writes |
| --- | --- | --- |
| `REDIS_URL` set | Redis (one atomic call) | none; if Redis errors the request falls back to memory |
| No Redis (default) | This instance's memory | Security/money buckets only, batched every `RATE_LIMIT_FLUSH_MS` (default 5000) in one statement |
| `RATE_LIMIT_STORE=postgres` | Old behavior: one `INSERT ... ON CONFLICT` per request | every request |

Buckets synced to Postgres (shared across instances and deploys, with up to one flush interval of lag): `authentication`, `access-code`, `access-waitlist`, `gift-card-lookup`, `contact-match`, `checkout`, `money-transfer`, `community-create`, `email-subscribe`. Every other bucket (reads, mutations, uploads, AI) is per instance: with N instances a client can make up to N times the limit if the load balancer spreads it out, which is acceptable for abuse limits and is fixed by setting `REDIS_URL`.

Fail closed (503 `RATE_LIMIT_UNAVAILABLE` if counting itself throws) only where the limit is a security control: `authentication`, `access-code`, `gift-card-lookup`, `contact-match`. Everything else fails open, so a store problem can no longer take checkout, subscriptions or browsing down. With the memory store, counting cannot fail on the request path; this only matters for Redis edge cases and `RATE_LIMIT_STORE=postgres`.

Limits, bucket names and the 429 response (`{ error, code: "RATE_LIMITED", message, retryAfterSeconds }` plus `RateLimit-*` and `Retry-After` headers) are unchanged. Route-level calls to `consumeRateLimitBucket` (gift-card code checks, email test sends, growth click dedupe) still use Postgres directly; they are per action, not per request.

## Sizing with a pooler

`instances x DB_POOL_MAX` must stay under the pooler's client limit, and the pooler's server pool under Postgres `max_connections`. Example for 20 API instances: `DB_POOL_MAX=10` gives 200 client connections into PgBouncer (transaction mode, `default_pool_size=40`), so Postgres only ever sees about 40. Use the provider's pooled URL (Neon `-pooler` host, Supabase port 6543) as `DATABASE_URL`. The app uses no session state, named prepared statements or advisory locks outside transactions, so transaction-mode pooling is safe. (The `pg_trgm.similarity_threshold` for search is set with `set_config(..., true)` inside a transaction for that reason.)

Without a pooler a managed Postgres tops out at a few hundred connections, which at the default pool of 10 is about 30 instances.

## Using the replica

`import { readDb } from "@workspace/db"` for reads that tolerate replication lag. Currently only public search uses it. Do not use it for read-after-write paths (anything that reads a row the same request just wrote, or a screen that follows a mutation).

## Changes in this PR and why

| Change | Evidence |
| --- | --- |
| Video playback lookup is an equality on the media path with an expression index (migration 112), replacing `LIKE '%…'` | p95 5 s → 3 ms, Postgres CPU 312% → 43% at the same load |
| Rate limiter no longer runs a `DELETE` inside every request's statement; each instance sweeps expired buckets once a minute | removes a table-range delete from every API call |
| DM thread read hides expired disappearing messages in the query and sweeps them off the request path | removes a write from a read |
| Public search uses index-friendly `col % term` (identical to `similarity(col, term) > 0.25` via a transaction-local threshold), orders and caps the product set in SQL, and caption trigram index | see PR for measurements |
| Following feed accepts optional `?cursor=` (keyset on `(created_at, id)`); `X-Next-Cursor` response header | OFFSET still works unchanged |
| Following feed follow list is a subquery instead of a round trip plus a giant `IN (...)` | one fewer query per page |
| Pool `error` handler | an idle connection dropped by the server previously raised an uncaught `error` event and could exit the process |


## Measured effect (same machine, same data, same k6 ramps)

Before = current `dev`. After = this PR. Load ramps: mix 25→800 req/s, search 5→160, others 50→800. Seed: 20k users, 60k posts with varied captions, 8k products, 500k messages. Raw JSON in `results/phase2/`. The video, DM-read and feed rows were measured before the final search edit, which does not touch those paths.

| Scenario | | Avg req/s completed | Dropped arrivals | 5xx | Endpoint p50 | Endpoint p95 | Postgres CPU peak |
|---|---|---:|---:|---:|---:|---:|---:|
| mix (search shown) | before | 54 | 16282 | 0.7% | 12124 ms | 38058 ms | 293% |
| mix (search shown) | after | 134 | 6260 | 0.0% | 858 ms | 7046 ms | 211% |
| search | before | 5 | 1590 | 59.3% | 60000 ms | 60001 ms | 386% |
| search | after | 24 | 917 | 0.0% | 7930 ms | 29316 ms | 459% |
| video_playback | before | 189 | 2456 | 0.0% | 239 ms | 4633 ms | 333% |
| video_playback | after | 235 | 0 | 0.0% | 2 ms | 3 ms | 38% |
| dm_read | before | 114 | 1012 | 0.0% | 7 ms | 1624 ms | 70% |
| dm_read | after | 114 | 1056 | 0.0% | 6 ms | 1572 ms | 65% |
| feed_following | before | 138 | 6520 | 0.0% | 1526 ms | 9849 ms | 151% |
| feed_following | after | 138 | 6506 | 0.0% | 1535 ms | 9770 ms | 158% |
| feed_for_you | before | 117 | 8052 | 0.0% | 3659 ms | 14180 ms | 103% |
| feed_for_you | after | 119 | 7968 | 0.0% | 3785 ms | 14062 ms | 94% |

What this says, honestly:

- **Video playback lookup: fixed.** p95 4.6 s → 3 ms, Postgres CPU 333% → 38%, nothing dropped.
- **Search: no longer falls over, still the slowest path.** Timeouts went from 59% to 0% and throughput from 5 to 24 req/s on a ramp that goes to 160 req/s. It is still bounded by Postgres CPU (459%), because every search runs three trigram queries. Next step is caching results (phase 3).
- **Realistic mix: 54 → 134 req/s completed, dropped arrivals 16.3k → 6.3k, 5xx 0.7% → 0%.** Search p50 in the mix 12.1 s → 0.9 s. Still saturates at the top of the ramp.
- **DM read and both feeds are unchanged.** Their API process sits at 106-118% CPU, i.e. one saturated Node core, and Postgres is not the limit (65-158%). Removing the DELETE-on-read is correct but was not the bottleneck. These need horizontal scaling plus the cache / precomputed feed from phases 3 and 7.

### Deliberate behavior change in search

Video **captions** are now matched by substring only (still index-served). They used to be trigram-fuzzy as well. A whole-caption similarity above 0.25 against a short search term is only reachable for very short captions, and the trigram index can't narrow it: that branch cost about 1 s per search at 60k videos and was the main reason search collapsed. Typos in **brand names, product names and tagged-product names** still match, exactly as before. If Dev wants caption typo tolerance back, it belongs in a real search engine (Typesense/Meilisearch/Postgres FTS), not trigrams over free text.

## Remaining OFFSET pagination (not changed here)

`notifications-feed.ts:186`, `seller-hub.ts:63,84,259`, `manufacturer-public.ts:225`, `public.ts:170,1655`, `conversations.ts:253` (inbox list), `profile-media.ts:301,351`, `social.ts:164,755,793,1541`, `moderation.ts:65`, `products.ts:137`, `reports.ts:178`, `communities.ts:310,360,635`, `team.ts:861`, `posts.ts:843`. Most are bounded per-seller lists where depth stays small. The ones that scale with total users or content are `public.ts:1655` (`/public/posts`), `profile-media.ts`, `social.ts` and `conversations.ts:253`; convert these next using `lib/cursor.ts` and the pattern in `posts.ts` `/feed`. Offset stays supported alongside so no client breaks.

## Not done, on purpose

- Duplicate index `messages_conv_id_idx` / `messages_conversation_order_idx` (identical definitions). Dropping an index is destructive to roll back; recommend dropping one after the next maintenance window.
- Per-query `EXPLAIN ANALYZE` on the other 100+ queries. The load tests show the rest of the hot paths are index-served (profile, product, DM list and send held 800 req/s).
