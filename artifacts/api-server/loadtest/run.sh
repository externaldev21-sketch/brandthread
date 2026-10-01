#!/usr/bin/env bash
# Usage: loadtest/run.sh <label> <scenario> <steps> [step_seconds]
# Starts the load-test API bundle against the LOCAL throwaway DB, runs k6, samples API and Postgres CPU,
# and writes results/<label>.json. Needs: k6 on PATH (or $K6), Postgres reachable at $LT_DATABASE_URL.
set -euo pipefail
cd "$(dirname "$0")/.."
label=$1; scenario=$2; steps=$3; secs=${4:-30}
K6=${K6:-k6}; mkdir -p loadtest/results
. loadtest/env.sh
export K6_NO_USAGE_REPORT=true

[ -f loadtest/results/.apipid ] && kill "$(cat loadtest/results/.apipid)" 2>/dev/null || true; sleep 1
node ${NODE_FLAGS:-} dist-loadtest/index.mjs > loadtest/results/$label.api.log 2>&1 &
api=$!; echo $api > loadtest/results/.apipid
for _ in $(seq 40); do curl -sf localhost:$PORT/api/healthz >/dev/null && break; sleep 0.5; done

pids=$(psql "$DATABASE_URL" -At -c "select string_agg(id::text, ',') from (select id from products order by random() limit 300) x")
(
  while kill -0 $api 2>/dev/null; do
    a=$(ps -o %cpu=,rss= -p $api | tr -s ' ')
    p=$(ps -C postgres -o %cpu= | paste -sd+ | bc)
    c=$(psql "$DATABASE_URL" -At -c "select count(*) from pg_stat_activity where datname=current_database()")
    echo "$(date +%s) $a ${p:-0} $c"
    sleep 2
  done
) > loadtest/results/$label.samples 2>/dev/null &
sampler=$!

OUT=loadtest/results/$label.json $K6 run -q -e BASE=http://localhost:$PORT -e PRODUCT_IDS=$pids \
  -e SCENARIO=$scenario -e STEPS=$steps -e STEP_SECONDS=$secs ${K6_ARGS:-} loadtest/k6/hotpaths.js > /dev/null 2>loadtest/results/$label.k6err || true

kill $sampler 2>/dev/null || true
awk '{ if ($2>a) a=$2; if ($3>r) r=$3; if ($4>p) p=$4; if ($5>c) c=$5 } END { printf "{\"apiCpuPeakPct\":%s,\"apiRssPeakMb\":%d,\"postgresCpuPeakPct\":%s,\"dbConnectionsPeak\":%s}\n", a, r/1024, p, c }' \
  loadtest/results/$label.samples > loadtest/results/$label.resources.json
kill $api 2>/dev/null || true; wait $api 2>/dev/null || true
echo "== $label ($scenario @ $steps rps)"; cat loadtest/results/$label.resources.json
python3 - "$label" <<'PY'
import json,sys
d=json.load(open(f"loadtest/results/{sys.argv[1]}.json"))
print(f"rps={d['rps']:.0f} 5xx={d['serverErrorRate']*100:.2f}% 429={d['rateLimitedRate']*100:.2f}% dropped={d['dropped']}")
for k,v in d['endpoints'].items(): print(f"  {k:16} p50={v['p50']:.0f}ms p95={v['p95']:.0f}ms p99={v['p99']:.0f}ms")
PY
