# Baseline load-test results (before any scaling work)

Setup: see [SCALE_PLAN.md](./SCALE_PLAN.md) section 2. 4 cores shared by k6, one Node API process and Postgres 16 (default config, `max_connections=300`, API pool = `pg` default of 10). 20k users, 60k posts, 8k products, 380k follows, 500k messages. Open-model ramp, each step held 15-20 s. `Dropped` = arrivals k6 could not start because every VU was waiting on a slow response (a direct measure of overload). 429s were 0% everywhere (each request used a distinct client IP / user).

| Scenario | Ramp (req/s) | Achieved avg req/s | Dropped arrivals | 5xx | p50 | p95 | p99 | API CPU peak | Postgres CPU peak | DB conns | API RSS peak |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| mix → video_playback | 25,50,100,200,400,800 | 60 | 15515 | 0.0% | 3911 ms | 13253 ms | 14176 ms | 110% | 293% | 11 | 951 MB |
| mix → product | 25,50,100,200,400,800 | 60 | 15515 | 0.0% | 13756 ms | 32380 ms | 32874 ms | 110% | 293% | 11 | 951 MB |
| mix → dm_send | 25,50,100,200,400,800 | 60 | 15515 | 0.0% | 2688 ms | 13042 ms | 13450 ms | 110% | 293% | 11 | 951 MB |
| mix → profile | 25,50,100,200,400,800 | 60 | 15515 | 0.0% | 4988 ms | 13228 ms | 14196 ms | 110% | 293% | 11 | 951 MB |
| mix → feed_following | 25,50,100,200,400,800 | 60 | 15515 | 0.0% | 16479 ms | 40114 ms | 40540 ms | 110% | 293% | 11 | 951 MB |
| mix → dm_read | 25,50,100,200,400,800 | 60 | 15515 | 0.0% | 12340 ms | 32128 ms | 32549 ms | 110% | 293% | 11 | 951 MB |
| mix → cart | 25,50,100,200,400,800 | 60 | 15515 | 0.0% | 4987 ms | 13270 ms | 13949 ms | 110% | 293% | 11 | 951 MB |
| mix → dm_list | 25,50,100,200,400,800 | 60 | 15515 | 0.0% | 6096 ms | 18736 ms | 19919 ms | 110% | 293% | 11 | 951 MB |
| mix → search | 25,50,100,200,400,800 | 60 | 15515 | 0.0% | 7696 ms | 25166 ms | 28992 ms | 110% | 293% | 11 | 951 MB |
| mix → feed_for_you | 25,50,100,200,400,800 | 60 | 15515 | 0.0% | 23569 ms | 52583 ms | 54326 ms | 110% | 293% | 11 | 951 MB |
| feed_for_you | 50,100,200,400,800 | 122 | 7649 | 0.0% | 2278 ms | 14971 ms | 15229 ms | 122% | 87% | 11 | 918 MB |
| feed_following | 50,100,200,400,800 | 137 | 6597 | 0.0% | 1479 ms | 10172 ms | 10230 ms | 110% | 150% | 11 | 754 MB |
| video_playback | 50,100,200,400,800 | 187 | 2591 | 0.0% | 89 ms | 5077 ms | 5354 ms | 113% | 312% | 11 | 400 MB |
| profile | 50,100,200,400,800 | 235 | 0 | 0.0% | 2 ms | 3 ms | 7 ms | 124% | 40% | 11 | 352 MB |
| product | 50,100,200,400,800 | 235 | 0 | 0.0% | 4 ms | 43 ms | 77 ms | 113% | 84% | 11 | 366 MB |
| search | 5,10,20,40,80 | 5 | 614 | 10.2% | 19063 ms | 60001 ms | 60001 ms | 114% | 493% | 11 | 618 MB |
| dm_list | 50,100,200,400,800 | 235 | 0 | 0.0% | 3 ms | 5 ms | 11 ms | 113% | 62% | 11 | 366 MB |
| dm_read | 50,100,200,400,800 | 113 | 1207 | 0.0% | 6 ms | 1887 ms | 2150 ms | 109% | 73% | 11 | 458 MB |
| dm_send | 50,100,200,400,800 | 124 | 0 | 0.0% | 3 ms | 20 ms | 53 ms | 114% | 64% | 11 | 372 MB |
| upload_admission | 2,5,10,20,40 | 12 | 0 | 0.0% | 6 ms | 13 ms | 16 ms | 111% | 4% | 9 | 225 MB |

CPU percentages are of one core (292% = 2.9 cores busy). The API never exceeded ~125%: it is one single-threaded process, so it is already at its ceiling whenever a run shows 110%+.

## Breaking points

- **Mix:** over the whole 25 to 800 req/s ramp the server only completed about 60 req/s on average and dropped 15.5k arrivals; every endpoint ended up in seconds (the per-step breakpoint was not isolated). Cause: Postgres saturated by search, video-lookup scans and the per-request rate-limit write.
- **Search:** breaks at 5-10 req/s. 10% of requests hit k6's 60 s timeout. Postgres 490% CPU.
- **Video playback lookup:** p50 fine (89 ms), p95 5 s. Postgres 310% CPU from `LIKE '%...'` scans of `posts`. Real playback additionally streams bytes through the API, which this test cannot show (no bucket).
- **For You / Following feeds:** usable to ~50-100 req/s, then queueing.
- **DM read:** healthy median, p95 1.9 s from the delete-on-read.
- **Upload admission:** 2 MB bodies at up to 40 req/s caused no failures (p95 13 ms). The API buffers the whole body, so memory scales with body size x concurrency; a real clip (up to 80 MB) is 40x larger. Not load-tested at that size. See Phase 5.
- **Profile, product, DM list, DM send:** no failures up to the 800 req/s step, p95 3-45 ms, API process CPU-bound at about one core.

## Reproduce

See `artifacts/api-server/loadtest/README.md`. Raw JSON for each run is in `results/`.
