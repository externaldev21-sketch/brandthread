// k6 load test for the Brandthread API hot paths.
//
//   k6 run -e BASE=http://localhost:5055 -e SCENARIO=mix -e STEPS=50,100,200,400 -e STEP_SECONDS=30 hotpaths.js
//
// SCENARIO: feed_for_you | feed_following | video_playback | profile | product | search |
//           dm_list | dm_read | dm_send | cart | upload_admission | mix
// STEPS:    requests/second for each step of a ramping-arrival-rate (open model: the
//           arrival rate does NOT slow down when the server does, which is what exposes
//           the breaking point). Default 25,50,100.
// Identity is the x-loadtest-user header, accepted only by the load-test bundle
// (loadtest/clerk-stub.ts). Real deployments ignore it.
import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE || "http://localhost:5055";
const SELLERS = Number(__ENV.SELLERS || 1000);
const USERS = Number(__ENV.USERS || 20000);
const PRODUCTS = (__ENV.PRODUCT_IDS || "").split(",").filter(Boolean);
const POSTS = Number(__ENV.POSTS || 60000);
const SCENARIO = __ENV.SCENARIO || "mix";
const STEPS = (__ENV.STEPS || "25,50,100").split(",").map(Number);
const STEP_SECONDS = Number(__ENV.STEP_SECONDS || 30);

const rateLimited = new Rate("bt_rate_limited"); // 429: the limiter working, not a server fault
const serverError = new Rate("bt_server_error"); // 5xx or transport failure
const dur = {};
for (const n of ["feed_for_you", "feed_following", "video_playback", "profile", "product", "search",
  "dm_list", "dm_read", "dm_send", "cart", "upload_admission"]) dur[n] = new Trend(`dur_${n}`, true);
const reqs = new Counter("bt_requests");

const buyer = () => `lt_user_${SELLERS + 1 + Math.floor(Math.random() * (USERS - SELLERS))}`;
const seller = () => `lt_user_${1 + Math.floor(Math.random() * SELLERS)}`;
// Distinct client IP per request (the API trusts one proxy hop), so the per-IP limiter sees many clients, like production.
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
const authed = (id) => ({ headers: { "x-loadtest-user": id, "Content-Type": "application/json", "X-Forwarded-For": ip() } });
const anon = (extra = {}) => ({ headers: { "X-Forwarded-For": ip(), ...extra } });

function record(name, res, okStatuses) {
  reqs.add(1);
  dur[name].add(res.timings.duration);
  const limited = res.status === 429;
  rateLimited.add(limited);
  serverError.add(res.status >= 500 || res.status === 0);
  check(res, { [`${name} ok`]: (r) => limited || okStatuses.includes(r.status) });
}

const scenarios = {
  feed_for_you() {
    const u = buyer();
    const page = http.get(`${BASE}/api/feed/for-you?limit=20`, { ...authed(u), tags: { name: "feed_for_you" } });
    record("feed_for_you", page, [200]);
  },
  feed_following() {
    const res = http.get(`${BASE}/api/posts/feed?limit=30`, { ...authed(buyer()), tags: { name: "feed_following" } });
    record("feed_following", res, [200]);
  },
  // The playback URL every feed item points at: /api/posts/media/*. In production this streams
  // the bytes through the API; locally there is no bucket so it resolves the post + ACL and 404s
  // at storage. That still measures the per-view DB lookup, which is the part that scales badly.
  video_playback() {
    const res = http.get(`${BASE}/api/posts/media/uploads/lt-${1 + Math.floor(Math.random() * POSTS)}.mp4`,
      { ...anon({ Range: "bytes=0-1048575" }), tags: { name: "video_playback" } });
    record("video_playback", res, [200, 206, 404]);
  },
  profile() {
    const res = http.get(`${BASE}/api/public/profiles/${seller()}`, { ...anon(), tags: { name: "profile" } });
    record("profile", res, [200]);
  },
  product() {
    const id = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
    const res = http.get(`${BASE}/api/public/products/${id}`, { ...anon(), tags: { name: "product" } });
    record("product", res, [200]);
  },
  search() {
    const q = ["product", "hood", "tee", "brand", "load", "street"][Math.floor(Math.random() * 6)];
    const res = http.get(`${BASE}/api/public/search?q=${q}`, { ...anon(), tags: { name: "search" } });
    record("search", res, [200]);
  },
  dm_list() {
    const res = http.get(`${BASE}/api/conversations`, { ...authed(buyer()), tags: { name: "dm_list" } });
    record("dm_list", res, [200]);
  },
  dm_read() {
    const u = buyer();
    const list = http.get(`${BASE}/api/conversations`, { ...authed(u), tags: { name: "dm_list" } });
    const first = list.status === 200 ? list.json()[0] : null;
    if (!first) return;
    const res = http.get(`${BASE}/api/conversations/${first.id}/messages?limit=50`, { ...authed(u), tags: { name: "dm_read" } });
    record("dm_read", res, [200]);
  },
  dm_send() {
    const u = buyer();
    const list = http.get(`${BASE}/api/conversations`, { ...authed(u), tags: { name: "dm_list" } });
    const first = list.status === 200 ? list.json()[0] : null;
    if (!first) return;
    const res = http.post(`${BASE}/api/conversations/${first.id}/messages`, JSON.stringify({ body: `lt ${Date.now()}` }),
      { ...authed(u), tags: { name: "dm_send" } });
    record("dm_send", res, [200, 201]);
  },
  cart() {
    const u = buyer();
    const res = http.get(`${BASE}/api/buyer/cart`, { ...authed(u), tags: { name: "cart" } });
    record("cart", res, [200]);
  },
  // Sends a 2 MB body to the seller video-clip endpoint. The API buffers the whole body in memory
  // before validating, so this measures the memory/CPU cost of proxying uploads through Express.
  upload_admission() {
    const body = "ftypisom" + "x".repeat(2 * 1024 * 1024);
    const res = http.post(`${BASE}/api/posts/video-clips`, body,
      { headers: { "x-loadtest-user": seller(), "Content-Type": "video/mp4", "X-Forwarded-For": ip() }, tags: { name: "upload_admission" } });
    record("upload_admission", res, [201, 400, 415, 500]);
  },
};

const MIX = [ // weights approximating a feed-heavy consumer app
  ["feed_for_you", 25], ["video_playback", 30], ["profile", 8], ["product", 10], ["search", 5],
  ["dm_list", 7], ["dm_read", 7], ["feed_following", 5], ["cart", 2], ["dm_send", 1],
];
function pickMix() {
  let r = Math.random() * MIX.reduce((s, [, w]) => s + w, 0);
  for (const [n, w] of MIX) if ((r -= w) < 0) return n;
  return MIX[0][0];
}

export const options = {
  scenarios: {
    load: {
      executor: "ramping-arrival-rate",
      startRate: STEPS[0], timeUnit: "1s",
      preAllocatedVUs: Number(__ENV.VUS || 200), maxVUs: Number(__ENV.MAX_VUS || 2000),
      stages: STEPS.map((target) => ({ target, duration: `${STEP_SECONDS}s` })),
    },
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
  discardResponseBodies: false,
};

export default function () {
  (SCENARIO === "mix" ? scenarios[pickMix()] : scenarios[SCENARIO])();
}

export function handleSummary(data) {
  const out = {};
  for (const [k, m] of Object.entries(data.metrics)) {
    if (k.startsWith("dur_") && m.values.med !== undefined) {
      out[k.slice(4)] = { p50: m.values.med, p95: m.values["p(95)"], p99: m.values["p(99)"], max: m.values.max };
    }
  }
  const summary = {
    scenario: SCENARIO, steps: STEPS, stepSeconds: STEP_SECONDS,
    requests: data.metrics.bt_requests?.values.count,
    rps: data.metrics.bt_requests?.values.rate,
    serverErrorRate: data.metrics.bt_server_error?.values.rate,
    rateLimitedRate: data.metrics.bt_rate_limited?.values.rate,
    dropped: data.metrics.dropped_iterations?.values.count || 0,
    endpoints: out,
  };
  const file = __ENV.OUT || "/dev/null";
  return { [file]: JSON.stringify(summary, null, 2), stdout: `${JSON.stringify(summary, null, 2)}\n` };
}
