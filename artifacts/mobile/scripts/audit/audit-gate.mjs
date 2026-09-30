#!/usr/bin/env node
/**
 * Zero-tolerance audit CI gate + warn-tier ratchet.
 *
 * `half-done-audit.mjs --ci` (see that script) only fails when a hard-tier
 * finding is *new* — i.e. not already recorded in
 * `docs/audit/half-done-baseline.json`. That was the right call for the
 * audit's first pass (see docs/audit/README.md's "Two-tier policy"), but
 * Dev now wants a real zero-tolerance gate now that the app is being driven
 * to a clean state, plus a warn-tier count that can only ever go down. This
 * script sits on top of half-done-audit.mjs and adds both, without changing
 * that script's own `--ci` baseline behavior (still available for anyone
 * who wants the old "no new hard findings" check specifically).
 *
 * What it does:
 *   1. Runs the half-done audit (any flag after `--` is passed straight
 *      through to half-done-audit.mjs — `--only`, `--roles`, `--limit`,
 *      `--skip-build`, `--time-budget-ms`, etc. — see that script's header
 *      for the full list). With no flags, it's a full run across every
 *      route/role, same scope as the existing CI job.
 *   2. Fails if ANY hard-tier finding exists in this run's results — full
 *      stop, no baseline exemption. "Already broken before this PR" is no
 *      longer an excuse for hard-tier issues.
 *   3. Fails if this run's warn-tier finding count is >= the stored
 *      warn-tier baseline (docs/audit/warn-baseline.json). Strictly `>=`,
 *      not `>`: a PR that touches audited surface must show a real
 *      improvement, not just hold steady while adding new debt elsewhere
 *      that happens to net out even.
 *
 * On CI scope: a full run takes on the order of hours (see docs/audit/
 * README.md), and the existing `half-done-audit` CI job already budgets 60
 * minutes for exactly one full run. Rather than doubling that cost, this
 * script does not re-run the audit a second time with a different scope —
 * CI wiring calls it with no extra flags, replacing the old
 * `audit:half-done -- --ci` step outright (see docs/ci/ci-cd.yml.disabled),
 * so it's still exactly one full run per PR. For fast local iteration while
 * fixing a specific area, pass `--only`/`--limit`/`--skip-build` through
 * (e.g. `pnpm --filter mobile run audit:gate -- --only buyer-checkout
 * --skip-build`) — just note the warn-tier ratchet compares against a
 * baseline recorded from a *full* run, so a narrowly-scoped run's warn
 * count isn't a meaningful baseline candidate (see --update-baseline
 * below).
 *
 * Usage:
 *   node scripts/audit/audit-gate.mjs [-- <half-done-audit.mjs flags>]
 *   node scripts/audit/audit-gate.mjs --update-baseline [-- <flags>]
 *     After a genuine warn-tier improvement lands, records this run's
 *     (lower) warn-tier count as the new baseline. Refuses to write if hard
 *     count > 0 or warn count didn't actually improve. Only wire this up —
 *     do not run it as a side effect of unrelated changes.
 *
 * See docs/audit/README.md for full policy and how the ratchet works.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(MOBILE_ROOT, '..', '..');
const FINDINGS_JSON = path.join(REPO_ROOT, 'docs', 'audit', 'half-done-findings.json');
const WARN_BASELINE_JSON = path.join(REPO_ROOT, 'docs', 'audit', 'warn-baseline.json');
const AUDIT_SCRIPT = path.join(__dirname, 'half-done-audit.mjs');

function parseArgs(argv) {
  const updateBaseline = argv.includes('--update-baseline');
  const passthrough = argv.filter((a) => a !== '--update-baseline');
  return { updateBaseline, passthrough };
}

function loadWarnBaseline() {
  if (!existsSync(WARN_BASELINE_JSON)) {
    // No baseline recorded yet — treat as "anything passes" rather than
    // failing every PR until someone seeds it, but say so loudly.
    return { warnCount: Infinity, updatedAt: null, note: 'no baseline recorded yet' };
  }
  return JSON.parse(readFileSync(WARN_BASELINE_JSON, 'utf8'));
}

function main() {
  const { updateBaseline, passthrough } = parseArgs(process.argv.slice(2));

  console.log('audit-gate: running half-done audit…');
  const result = spawnSync(process.execPath, [AUDIT_SCRIPT, ...passthrough], {
    cwd: MOBILE_ROOT,
    stdio: 'inherit',
  });
  // half-done-audit.mjs only exits non-zero on its own when --ci is passed
  // to IT (its internal baseline gate) or it errors out (e.g. a build
  // failure). We don't pass --ci through, so any non-zero status here means
  // the run itself failed before producing results.
  if (result.status !== 0) {
    console.error(`\naudit-gate: half-done-audit.mjs exited with code ${result.status} before producing results.`);
    process.exit(result.status ?? 1);
  }

  if (!existsSync(FINDINGS_JSON)) {
    console.error(`audit-gate: expected findings at ${FINDINGS_JSON} but none were written.`);
    process.exit(1);
  }
  const { summary } = JSON.parse(readFileSync(FINDINGS_JSON, 'utf8'));
  const hardCount = summary.findingsByTier?.hard ?? 0;
  const warnCount = summary.findingsByTier?.warn ?? 0;
  const baseline = loadWarnBaseline();

  console.log(`\n=== audit-gate results ===`);
  console.log(`Hard-tier findings: ${hardCount} (zero-tolerance gate — must be 0)`);
  console.log(`Warn-tier findings: ${warnCount} (ratchet baseline: ${baseline.warnCount}${baseline.updatedAt ? `, recorded ${baseline.updatedAt}` : ''})`);

  let failed = false;

  if (hardCount > 0) {
    failed = true;
    console.error(`\nGATE FAILED: ${hardCount} hard-tier finding(s) present (zero-tolerance — the baseline in half-done-baseline.json is not consulted here).`);
    console.error('See docs/audit/half-done-audit-report.md for detail, grouped by area.');
  } else {
    console.log('Hard-tier gate: PASS (0 findings).');
  }

  const warnRegressed = warnCount >= baseline.warnCount;
  if (warnRegressed) {
    failed = true;
    console.error(`\nGATE FAILED: warn-tier count (${warnCount}) is not below the recorded baseline (${baseline.warnCount}).`);
    console.error('The warn-tier ratchet requires every PR touching audited surface to reduce the warn count, not merely avoid increasing it (equal counts fail on purpose).');
    console.error('See docs/audit/README.md "Warn-tier ratchet" for how to update the baseline after a genuine improvement.');
  } else {
    console.log(`Warn-tier ratchet: PASS (${warnCount} < ${baseline.warnCount}).`);
  }

  if (updateBaseline) {
    if (hardCount > 0) {
      console.error('\naudit-gate: refusing --update-baseline — hard-tier findings are present.');
      process.exit(1);
    }
    if (warnRegressed) {
      console.error(`\naudit-gate: refusing --update-baseline — warn count (${warnCount}) did not improve on the recorded baseline (${baseline.warnCount}).`);
      process.exit(1);
    }
    writeFileSync(
      WARN_BASELINE_JSON,
      JSON.stringify(
        {
          warnCount,
          updatedAt: new Date().toISOString(),
          note: 'Updated via `pnpm --filter mobile run audit:gate:update-baseline` after a genuine warn-tier improvement. Only ever lower this number.',
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`\naudit-gate: updated warn-tier baseline ${baseline.warnCount} -> ${warnCount}.`);
    process.exit(0);
  }

  process.exit(failed ? 1 : 0);
}

main();
