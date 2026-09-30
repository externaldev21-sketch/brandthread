#!/usr/bin/env node
/**
 * Combines the raw per-shard result files produced by
 * `half-done-audit.mjs --shard-out <path>` into the final, top-level
 * docs/audit/half-done-findings.json + half-done-audit-report.md (and,
 * unless --no-baseline is passed, regenerates docs/audit/half-done-baseline.json
 * — the hard-tier-only ratchet, per the two-tier policy in docs/audit/README.md).
 *
 * Usage:
 *   node scripts/audit/merge-shard-results.mjs <shard1.json> <shard2.json> ...
 *   node scripts/audit/merge-shard-results.mjs .audit/shards/*.json
 *
 * Shell-glob the shard files in; this script does no discovery of its own so
 * a partial set of shards (if some haven't finished yet) can be merged and
 * re-merged as more land.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTierExport, findingKey, groupArea, ownerForRouteExport, writeMarkdownExport } from './half-done-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUT_JSON = path.join(REPO_ROOT, 'docs', 'audit', 'half-done-findings.json');
const BASELINE_JSON = path.join(REPO_ROOT, 'docs', 'audit', 'half-done-baseline.json');

const argv = process.argv.slice(2);
const noBaseline = argv.includes('--no-baseline');
const shardPaths = argv.filter((a) => a !== '--no-baseline');

if (shardPaths.length === 0) {
  console.error('Usage: node merge-shard-results.mjs <shard1.json> [shard2.json ...] [--no-baseline]');
  process.exit(1);
}

let routesDiscovered = 0;
let anyInterrupted = false;
const allResults = [];
for (const p of shardPaths) {
  if (!existsSync(p)) { console.error(`Shard file not found, skipping: ${p}`); continue; }
  const shard = JSON.parse(readFileSync(p, 'utf8'));
  routesDiscovered = Math.max(routesDiscovered, shard.routesDiscovered || 0);
  if (shard.interrupted) anyInterrupted = true;
  for (const r of shard.results || []) allResults.push(r);
}

console.log(`Merged ${shardPaths.length} shard file(s), ${allResults.length} route×role×data-state combo(s) total.`);

const flat = [];
for (const r of allResults) {
  for (const f of r.findings || []) {
    flat.push({
      ...f,
      route: r.route,
      file: r.file,
      role: r.role,
      dataState: r.dataState,
      tier: f.severity === 'hard' ? 'hard' : 'warn',
      screenshotDir: r.shotDir,
      owner: ownerForRouteExport(r.route),
    });
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  interrupted: anyInterrupted,
  routesDiscovered,
  routesAudited: allResults.length,
  unreachable: allResults.filter((r) => !r.reachable).map((r) => ({ route: r.route, role: r.role, dataState: r.dataState, reason: r.unreachableReason })),
  findingsByType: {},
  findingsByTier: { hard: 0, warn: 0 },
};
for (const f of flat) {
  summary.findingsByType[f.type] = (summary.findingsByType[f.type] || 0) + 1;
  summary.findingsByTier[f.tier] += 1;
}

writeFileSync(OUT_JSON, JSON.stringify({
  summary,
  findings: flat,
  results: allResults.map((r) => ({ route: r.route, role: r.role, dataState: r.dataState, reachable: r.reachable, unreachableReason: r.unreachableReason, file: r.file })),
}, null, 2));
console.log(`Wrote ${OUT_JSON}`);
console.log(`Findings: ${flat.length} (hard: ${summary.findingsByTier.hard}, warn: ${summary.findingsByTier.warn})`);

writeMarkdownExport(summary, flat, allResults);

if (!noBaseline) {
  const hardKeys = flat.filter((f) => f.tier === 'hard').map(findingKey);
  writeFileSync(BASELINE_JSON, JSON.stringify({ hardKeys }, null, 2));
  console.log(`Wrote ${BASELINE_JSON} (${hardKeys.length} hard-tier key(s))`);
}
