# API load tests

Drives the real Express app (hot paths: For You feed, Following feed, video playback lookup, profile, product, search, DM list/read/send, cart, upload admission) with k6. See `docs/scale/SCALE_PLAN.md`.

**Safety:** targets a local throwaway Postgres only. Clerk is replaced by `clerk-stub.ts` in a separate bundle (`dist-loadtest/`, git-ignored, never part of `pnpm build`). The stub reads `x-loadtest-user` and does nothing unless `LOADTEST_AUTH_STUB=1`. Stripe/OpenAI/GCS are never called. Never point `LT_DATABASE_URL` at a real database; `seed.sql` truncates nothing but inserts `lt_*` accounts.

```bash
# 1. a scratch Postgres 16 and an empty database (example: port 5433, db "bt")
# 2. schema
DATABASE_URL=postgres://localhost:5433/bt pnpm --filter @workspace/db run push
DATABASE_URL=postgres://localhost:5433/bt pnpm --filter @workspace/db run migrate
# 3. seed (≈25 s for 20k users / 60k posts / 500k messages; tune with -v users=… posts=…)
psql postgres://localhost:5433/bt -f artifacts/api-server/loadtest/seed.sql
# 4. build the stubbed bundle and run
cd artifacts/api-server && node loadtest/build.mjs
LT_DATABASE_URL=postgres://localhost:5433/bt K6=$(which k6) \
  loadtest/run.sh my-run mix 25,50,100,200 20      # <label> <scenario|mix> <req/s steps> <seconds per step>
```

`run.sh` starts the API, samples API and Postgres CPU every 2 s, runs k6, and writes `results/<label>.json` (p50/p95/p99 per endpoint, error rate, dropped arrivals) and `results/<label>.resources.json`. Scenarios: `feed_for_you feed_following video_playback profile product search dm_list dm_read dm_send cart upload_admission mix`.
