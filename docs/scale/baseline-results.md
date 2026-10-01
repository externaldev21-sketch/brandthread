# Baseline load-test results (before any scaling work)

Setup: see [SCALE_PLAN.md](./SCALE_PLAN.md) section 2. 4 cores shared by k6, one Node API process and Postgres 16 (default config, `max_connections=300`, API pool = `pg` default of 10). 20k users, 60k posts with varied captions, 8k products (24k variants, 24k tagged), 380k follows, 500k messages. Open-model ramp, each step held 15-20 s. `Dropped` = arrivals k6 could not start because every VU was waiting on a slow response (a direct measure of overload). 429s were 0% everywhere (each request used a distinct client IP / user).

| Scenario | Ramp (req/s) | Achieved avg req/s | Dropped arrivals | 5xx | p50 | p95 | p99 | API CPU peak | Postgres CPU peak | DB conns | API RSS peak |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| mix → dm_read | 25,50,100,200,400,800 | 54 | 16282 | 0.7% | 8206 ms | 41143 ms | 41881 ms | 111% | 293% | 12 | 834 MB |
| mix → dm_list | 25,50,100,200,400,800 | 54 | 16282 | 0.7% | 5663 ms | 25311 ms | 27672 ms | 111% | 293% | 12 | 834 MB |
| mix → dm_send | 25,50,100,200,400,800 | 54 | 16282 | 0.7% | 10179 ms | 23177 ms | 25884 ms | 111% | 293% | 12 | 834 MB |
| mix → feed_following | 25,50,100,200,400,800 | 54 | 16282 | 0.7% | 24114 ms | 49277 ms | 51095 ms | 111% | 293% | 12 | 834 MB |
| mix → profile | 25,50,100,200,400,800 | 54 | 16282 | 0.7% | 4906 ms | 20365 ms | 21818 ms | 111% | 293% | 12 | 834 MB |
| mix → product | 25,50,100,200,400,800 | 54 | 16282 | 0.7% | 18979 ms | 41542 ms | 42056 ms | 111% | 293% | 12 | 834 MB |
| mix → feed_for_you | 25,50,100,200,400,800 | 54 | 16282 | 0.7% | 18963 ms | 57928 ms | 60001 ms | 111% | 293% | 12 | 834 MB |
| mix → cart | 25,50,100,200,400,800 | 54 | 16282 | 0.7% | 5262 ms | 21707 ms | 22013 ms | 111% | 293% | 12 | 834 MB |
| mix → search | 25,50,100,200,400,800 | 54 | 16282 | 0.7% | 12124 ms | 38058 ms | 39354 ms | 111% | 293% | 12 | 834 MB |
| mix → video_playback | 25,50,100,200,400,800 | 54 | 16282 | 0.7% | 5275 ms | 20289 ms | 21776 ms | 111% | 293% | 12 | 834 MB |
| feed_for_you | 50,100,200,400,800 | 117 | 8052 | 0.0% | 3659 ms | 14180 ms | 16367 ms | 117% | 103% | 12 | 953 MB |
| feed_following | 50,100,200,400,800 | 138 | 6520 | 0.0% | 1526 ms | 9849 ms | 9947 ms | 106% | 151% | 11 | 780 MB |
| video_playback | 50,100,200,400,800 | 189 | 2456 | 0.0% | 239 ms | 4633 ms | 5246 ms | 113% | 333% | 11 | 393 MB |
| profile | 50,100,200,400,800 | 235 | 0 | 0.0% | 2 ms | 3 ms | 8 ms | 120% | 46% | 11 | 332 MB |
| product | 50,100,200,400,800 | 234 | 27 | 0.0% | 4 ms | 123 ms | 280 ms | 113% | 64% | 11 | 359 MB |
| search | 5,10,20,40,80,160 | 5 | 1590 | 59.3% | 60000 ms | 60001 ms | 60008 ms | 118% | 386% | 11 | 766 MB |
| dm_list | 50,100,200,400,800 | 235 | 0 | 0.0% | 3 ms | 5 ms | 10 ms | 111% | 54% | 11 | 353 MB |
| dm_read | 50,100,200,400,800 | 114 | 1012 | 0.0% | 7 ms | 1624 ms | 1860 ms | 120% | 70% | 11 | 418 MB |
| dm_send | 50,100,200,400,800 | 124 | 57 | 0.0% | 3 ms | 61 ms | 259 ms | 121% | 63% | 11 | 366 MB |
| upload_admission | 2,5,10,20,40 | 12 | 0 | 0.0% | 6 ms | 14 ms | 18 ms | 119% | 4% | 9 | 218 MB |

CPU percentages are of one core (292% = 2.9 cores busy). The API never exceeded ~125%: it is one single-threaded process, so it is already at its ceiling whenever a run shows 105%+. For the mix, the `5xx` column covers every endpoint; the latency rows are per endpoint across the whole ramp (so they include the overloaded top steps).

## Breaking points

- **Mix:** over the whole 25 to 800 req/s ramp the server completed about 54 req/s on average, dropped 16k arrivals and returned 0.7% 5xx; every endpoint ended up in seconds. The per-step breakpoint was not isolated. Cause: Postgres saturated (~3 cores) by search and the video-lookup scans, plus the per-request rate-limit write.
- **Search:** breaks at 5-10 req/s. 59% of requests hit k6's 60 s timeout. Postgres ~390% CPU.
- **Video playback lookup:** p50 239 ms, p95 4.6 s. Postgres 330% CPU from `LIKE '%...'` scans of `posts`. Real playback additionally streams bytes through the API, which this test cannot show (no bucket).
- **For You / Following feeds:** usable to ~50 req/s, then queueing; the API process is a saturated single core (106-117%).
- **DM read:** healthy median (7 ms), p95 1.6 s above ~100 req/s; again a saturated Node core.
- **Upload admission:** 2 MB bodies at up to 40 req/s caused no failures (p95 14 ms). The API buffers the whole body, so memory scales with body size x concurrency; a real clip (up to 80 MB) is 40x larger. Not load-tested at that size. See Phase 5.
- **Profile, product, DM list, DM send:** no failures up to the 800 req/s step, p95 3-123 ms, API process CPU-bound at about one core.

## Reproduce

See `artifacts/api-server/loadtest/README.md`. Raw JSON for each run is in `results/`.
