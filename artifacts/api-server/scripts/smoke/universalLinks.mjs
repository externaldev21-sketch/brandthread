#!/usr/bin/env node
/**
 * Deployed smoke test for universal links and root-level pages (BT-301/302).
 *
 *   node artifacts/api-server/scripts/smoke/universalLinks.mjs https://brandthread.app
 *
 * Fails when the app-link files are missing, not JSON, or still empty
 * (APPLE_TEAM_ID / ANDROID_SHA256_CERT_FINGERPRINTS unset), or when the
 * root pages fall through to the web app's HTML shell.
 */
const origin = (process.argv[2] || process.env.SMOKE_ORIGIN || "https://brandthread.app").replace(/\/+$/, "");
const failures = [];

async function check(path, test) {
  try {
    const res = await fetch(`${origin}${path}`, { redirect: "manual", headers: { accept: "application/json" } });
    const problem = await test(res);
    console.log(`${problem ? "FAIL" : "ok  "} ${path}${problem ? ` — ${problem}` : ""}`);
    if (problem) failures.push(path);
  } catch (err) {
    console.log(`FAIL ${path} — ${err.message}`);
    failures.push(path);
  }
}

const json = (res) => (res.headers.get("content-type") || "").includes("application/json");

await check("/.well-known/apple-app-site-association", async (res) => {
  if (res.status !== 200) return `status ${res.status}`;
  if (!json(res)) return `content-type ${res.headers.get("content-type")}`;
  const body = await res.json();
  return body?.applinks?.details?.length ? null : "details is empty: set APPLE_TEAM_ID on the API deployment";
});
await check("/.well-known/assetlinks.json", async (res) => {
  if (res.status !== 200) return `status ${res.status}`;
  if (!json(res)) return `content-type ${res.headers.get("content-type")}`;
  const body = await res.json();
  return Array.isArray(body) && body.length ? null : "empty: set ANDROID_SHA256_CERT_FINGERPRINTS on the API deployment";
});
// Unknown codes must get the API's own 404, not the SPA shell.
for (const path of ["/l/smoke-test-missing", "/bio/smoke-test-missing", "/g/smoke-test-missing"]) {
  await check(path, async (res) => {
    const text = await res.text();
    return /<div id="root"|expo-router/i.test(text) ? "served the web app shell instead of the API page" : null;
  });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed against ${origin}`);
  process.exit(1);
}
console.log(`\nAll universal-link checks passed against ${origin}`);
