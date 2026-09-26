#!/usr/bin/env node
/**
 * Merges the per-role/per-viewport result JSON files under docs/qa/results/
 * into one combined array and prints a quick stats summary, to speed up
 * report-writing after a long crawl. Not itself part of the crawl -- just a
 * convenience for whoever (human or Claude) is triaging results/writing the
 * report next.
 *
 * Usage: node summarize.mjs [resultsDir]
 */
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] || path.resolve(process.cwd(), "../../docs/qa/results");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

let all = [];
for (const f of files) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    all = all.concat(data.map((d) => ({ ...d, __file: f })));
  } catch (e) {
    console.error(`Failed to parse ${f}: ${e}`);
  }
}

console.log(`Loaded ${all.length} page records from ${files.length} files.`);
const byRoleViewport = {};
for (const r of all) {
  const key = `${r.role}/${r.viewport}`;
  byRoleViewport[key] = (byRoleViewport[key] || 0) + 1;
}
console.log("Pages per role/viewport:", byRoleViewport);

const slow = all.filter((r) => r.slow);
console.log(`\nSlow screens (>1s): ${slow.length}`);
slow.slice(0, 30).forEach((r) => console.log(`  ${r.role} ${r.viewport} ${r.route} -> ${r.loadTimeMs}ms`));

const withConsoleErrors = all.filter((r) => (r.consoleErrors || []).length || (r.pageErrors || []).length);
console.log(`\nPages with console/page errors: ${withConsoleErrors.length}`);

const withNetworkErrors = all.filter((r) => (r.networkErrors || []).length);
console.log(`Pages with network 4xx/5xx: ${withNetworkErrors.length}`);

const blank = all.filter((r) => r.looksBlank);
console.log(`\nBlank pages: ${blank.length}`);
blank.forEach((r) => console.log(`  ${r.role} ${r.viewport} ${r.route}`));

const boundary = all.filter((r) => r.looksLikeErrorBoundary);
console.log(`\nError-boundary-looking pages: ${boundary.length}`);
boundary.forEach((r) => console.log(`  ${r.role} ${r.viewport} ${r.route}`));

const stillSpinning = all.filter((r) => r.stillSpinning);
console.log(`\nStill-spinning-after-10s pages: ${stillSpinning.length}`);
stillSpinning.forEach((r) => console.log(`  ${r.role} ${r.viewport} ${r.route}`));

const unclosable = all.filter((r) => (r.unclosableSheets || []).length);
console.log(`\nUnclosable sheets: ${unclosable.length}`);
unclosable.forEach((r) => console.log(`  ${r.role} ${r.viewport} ${r.route} -> ${JSON.stringify(r.unclosableSheets)}`));

const deadEndBack = all.filter((r) => r.backNav && r.backNav.isDeadEnd);
console.log(`\nBack-nav dead ends: ${deadEndBack.length}`);
deadEndBack.forEach((r) => console.log(`  ${r.role} ${r.viewport} ${r.route}`));

const truncated = all.filter((r) => (r.truncatedTextSamples || []).length);
console.log(`\nPages with truncated-text candidates: ${truncated.length}`);

const offscreen = all.filter((r) => (r.offscreenElements || []).length);
console.log(`\nPages with offscreen-element candidates: ${offscreen.length}`);

const overlap = all.filter((r) => r.scrollBottom && r.scrollBottom.possibleTabBarOverlap);
console.log(`\nPossible tab-bar overlap on scroll-to-bottom: ${overlap.length}`);
overlap.forEach((r) => console.log(`  ${r.role} ${r.viewport} ${r.route} -> ${JSON.stringify(r.scrollBottom.possibleTabBarOverlap)}`));

const formsPresent = all.filter((r) => r.formTest && r.formTest.present);
console.log(`\nPages with a testable form: ${formsPresent.length}`);
const formsNoValidation = formsPresent.filter(
  (r) =>
    r.formTest.invalid &&
    r.formTest.invalid.submitted &&
    !/required|invalid|must be|error|please/i.test(r.formTest.invalid.resultTextSample || "")
);
console.log(`Forms where the invalid pass submitted with no visible validation message: ${formsNoValidation.length}`);
formsNoValidation.forEach((r) => console.log(`  ${r.role} ${r.viewport} ${r.route}`));

// Header consistency: group by role, compare font-size across tab roots.
const headers = all.filter((r) => r.header);
const byRole = {};
for (const r of headers) {
  byRole[r.role] = byRole[r.role] || [];
  byRole[r.role].push(r);
}
console.log("\nHeader font-size samples per role (for manual outlier scan):");
for (const [role, list] of Object.entries(byRole)) {
  const sizes = list.map((r) => r.header.fontSize).filter(Boolean);
  const uniq = [...new Set(sizes)];
  console.log(`  ${role}: distinct header font-sizes seen = ${uniq.sort((a, b) => a - b).join(", ")}`);
}

fs.writeFileSync(path.join(dir, "..", "crawl-results-merged.json"), JSON.stringify(all, null, 2));
console.log(`\nWrote merged results to docs/qa/crawl-results-merged.json`);
