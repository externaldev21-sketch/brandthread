#!/usr/bin/env node
/**
 * Convenience wrapper for a genuinely full half-done-audit run: 274ish
 * routes × 2 roles × 2 data-states (fresh, demo=1) is too much for one
 * Playwright process to get through inside any single time budget, so this
 * splits the route list into fixed-size shards, runs each shard as its own
 * `half-done-audit.mjs --shard-out ...` child process (bounded by
 * `--per-shard-budget-ms`), merges every shard's raw results into the final
 * report + baseline after each shard (so the merged report/baseline in
 * docs/audit/ always reflect the shards completed so far, not just the
 * final state), and — unless `--no-commit` is passed — commits (and, unless
 * `--no-push`, pushes) after every shard. That last part matters: a
 * multi-hour run in this sandbox can be interrupted by a container restart,
 * and losing uncommitted shard progress to that has already burned one
 * other session tonight.
 *
 * Usage:
 *   node scripts/audit/run-full-audit.mjs
 *   node scripts/audit/run-full-audit.mjs --chunk-size 15 --per-shard-budget-ms 1500000
 *   node scripts/audit/run-full-audit.mjs --resume   # skip shards whose output file already exists
 *   node scripts/audit/run-full-audit.mjs --no-commit --no-push   # local dry run
 *
 * Also runnable via `pnpm --filter mobile run audit:half-done:full`.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_DIR,
  MOBILE_ROOT_EXPORT as MOBILE_ROOT,
  fileToRoute,
  paramValueFor,
  requiredQueryParams,
  walkRoutes,
} from './half-done-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MOBILE_ROOT, '..', '..');
const SHARD_DIR = path.join(REPO_ROOT, 'docs', 'audit', 'shards');

function parseArgs(argv) {
  const opts = {
    chunkSize: 20,
    roles: 'seller,buyer',
    dataStates: 'fresh,demo',
    maxTaps: 20,
    perRouteBudgetMs: 30_000,
    perShardBudgetMs: 25 * 60_000,
    resume: false,
    commit: true,
    push: true,
    skipBuild: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--chunk-size') opts.chunkSize = Number(argv[++i]);
    else if (a === '--roles') opts.roles = argv[++i];
    else if (a === '--data-states') opts.dataStates = argv[++i];
    else if (a === '--max-taps') opts.maxTaps = Number(argv[++i]);
    else if (a === '--per-route-budget-ms') opts.perRouteBudgetMs = Number(argv[++i]);
    else if (a === '--per-shard-budget-ms') opts.perShardBudgetMs = Number(argv[++i]);
    else if (a === '--resume') opts.resume = true;
    else if (a === '--no-commit') opts.commit = false;
    else if (a === '--no-push') opts.push = false;
    else if (a === '--skip-build') opts.skipBuild = true;
  }
  return opts;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(SHARD_DIR, { recursive: true });

  const routeFiles = walkRoutes(APP_DIR);
  const routes = routeFiles.map((file) => {
    const { routePath } = fileToRoute(file);
    const required = requiredQueryParams(file);
    void required.map((p) => paramValueFor(p)); // touch, matches half-done-audit's own enumeration
    return { file: path.relative(MOBILE_ROOT, file), routePath };
  });

  const shards = chunk(routes, opts.chunkSize);
  console.log(`${routes.length} routes -> ${shards.length} shard(s) of up to ${opts.chunkSize} routes each.`);
  console.log(`roles=[${opts.roles}] data-states=[${opts.dataStates}] max-taps=${opts.maxTaps} per-route-budget-ms=${opts.perRouteBudgetMs} per-shard-budget-ms=${opts.perShardBudgetMs}`);

  let builtOnce = opts.skipBuild;
  for (let i = 0; i < shards.length; i += 1) {
    const shardOut = path.join(SHARD_DIR, `shard-${String(i).padStart(3, '0')}.json`);
    if (opts.resume && existsSync(shardOut)) {
      console.log(`[shard ${i + 1}/${shards.length}] already have ${shardOut}, skipping (--resume).`);
      continue;
    }
    const only = shards[i].map((r) => r.file).join(',');
    console.log(`\n[shard ${i + 1}/${shards.length}] ${shards[i].length} route(s): ${shards[i].map((r) => r.routePath).join(', ')}`);
    const args = [
      'scripts/audit/half-done-audit.mjs',
      '--only', only,
      '--roles', opts.roles,
      '--data-states', opts.dataStates,
      '--max-taps', String(opts.maxTaps),
      '--per-route-budget-ms', String(opts.perRouteBudgetMs),
      '--time-budget-ms', String(opts.perShardBudgetMs),
      '--shard-out', shardOut,
    ];
    if (builtOnce) args.push('--skip-build');
    try {
      execFileSync('node', args, { cwd: MOBILE_ROOT, stdio: 'inherit' });
      builtOnce = true;
    } catch (err) {
      console.error(`Shard ${i + 1} failed/exited non-zero: ${err.message}. Continuing to next shard — partial shard-out (if any) is still merged.`);
      builtOnce = true;
    }

    // Merge everything produced so far, every shard, so the committed
    // report/baseline always reflect real progress even if this whole run
    // is interrupted after this point.
    const shardFiles = readdirSync(SHARD_DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(SHARD_DIR, f));
    execFileSync('node', ['scripts/audit/merge-shard-results.mjs', ...shardFiles], { cwd: MOBILE_ROOT, stdio: 'inherit' });

    if (opts.commit) {
      try {
        execSync('git add docs/audit artifacts/mobile/docs/audit/screenshots', { cwd: REPO_ROOT });
        const status = execSync('git status --porcelain -- docs/audit artifacts/mobile/docs/audit/screenshots', { cwd: REPO_ROOT }).toString();
        if (status.trim()) {
          execSync(
            `git commit -m "Half-done audit: shard ${i + 1}/${shards.length} results" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"`,
            { cwd: REPO_ROOT },
          );
          console.log(`Committed shard ${i + 1}/${shards.length}.`);
          if (opts.push) {
            execSync('git push', { cwd: REPO_ROOT, stdio: 'inherit' });
          }
        } else {
          console.log(`Shard ${i + 1}/${shards.length} produced no diff to commit.`);
        }
      } catch (err) {
        console.error(`git commit/push failed after shard ${i + 1}: ${err.message} — continuing (findings are still on disk in ${SHARD_DIR}).`);
      }
    }
  }

  console.log('\nAll shards done.');
}

main();
