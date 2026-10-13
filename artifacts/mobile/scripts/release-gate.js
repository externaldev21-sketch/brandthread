#!/usr/bin/env node
/**
 * Release gate: crash-free sessions must be at least 99.8% before a release
 * goes further. Used for the staged rollout 10% → 50% → 100%.
 *
 *   pnpm run release:gate -- --release "com.brandthread.mobile@1.0.0+42"
 *   pnpm run release:gate -- --release "<release>" --group <update-group-id> --current 10 --advance
 *
 * Options:
 *   --release        Sentry release to check (required; Sentry → Releases)
 *   --period         Window to measure, e.g. 24h, 48h, 7d (default 24h)
 *   --target         Crash-free sessions %, default 99.8
 *   --min-sessions   Fewest sessions needed to judge, default 500
 *   --group          EAS update group ID (from `pnpm run update:production`)
 *   --current        The group's current rollout %: 10 or 50
 *   --advance        If the gate passes, raise the group to the next step
 *
 * Reads SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT (the same variables
 * the source-map upload uses) plus SENTRY_PROJECT_ID, the numeric project ID
 * the sessions API needs. Without them it does nothing and says so.
 *
 * Exit codes: 0 passed, 1 failed (stop or roll back), 2 not enough data yet
 * or Sentry not set up (wait; do not advance).
 */
const { fail, requireEasCli, run, sentryUploadConfigured } = require('./release-utils');

const ROLLOUT_STEPS = [10, 50, 100];
const DEFAULTS = { period: '24h', target: 99.8, minSessions: 500 };

function parseArgs(argv) {
  const options = { release: null, period: DEFAULTS.period, target: DEFAULTS.target, minSessions: DEFAULTS.minSessions, group: null, current: null, advance: false };
  const errors = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      i += 1;
      if (value === undefined || value.startsWith('--')) errors.push(`${arg} needs a value`);
      return value;
    };
    if (arg === '--') continue;
    else if (arg === '--release') options.release = next();
    else if (arg === '--period') options.period = next();
    else if (arg === '--target') options.target = Number(next());
    else if (arg === '--min-sessions') options.minSessions = Number(next());
    else if (arg === '--group') options.group = next();
    else if (arg === '--current') options.current = Number(next());
    else if (arg === '--advance') options.advance = true;
    else errors.push(`Unknown option ${arg}`);
  }
  if (!options.release?.trim()) errors.push('--release is required, e.g. --release "com.brandthread.mobile@1.0.0+42"');
  if (!/^\d+[hd]$/.test(String(options.period))) errors.push('--period must look like 24h or 7d');
  if (!(options.target > 0 && options.target <= 100)) errors.push('--target must be a percentage, e.g. 99.8');
  if (!(Number.isInteger(options.minSessions) && options.minSessions >= 1)) errors.push('--min-sessions must be a whole number');
  if (options.advance) {
    if (!options.group?.trim()) errors.push('--advance needs --group <update-group-id>');
    if (!ROLLOUT_STEPS.slice(0, -1).includes(options.current)) errors.push(`--advance needs --current ${ROLLOUT_STEPS.slice(0, -1).join(' or ')}`);
  }
  return { options, errors };
}

/** 10 → 50 → 100. Null once the release is at 100%. */
function nextRolloutStep(current) {
  const index = ROLLOUT_STEPS.indexOf(current);
  if (index === -1) return ROLLOUT_STEPS[0];
  return ROLLOUT_STEPS[index + 1] ?? null;
}

/** crashFreeRate is a 0–1 fraction, as Sentry returns it. */
function evaluateGate({ crashFreeRate, sessions }, { target = DEFAULTS.target, minSessions = DEFAULTS.minSessions } = {}) {
  if (!Number.isFinite(sessions) || sessions < minSessions || crashFreeRate == null) {
    return { status: 'wait', reason: `Only ${Number.isFinite(sessions) ? sessions : 0} sessions so far; need ${minSessions} to judge.` };
  }
  const percent = Math.round(crashFreeRate * 100000) / 1000;
  if (percent >= target) return { status: 'pass', percent, reason: `${percent}% crash-free over ${sessions} sessions (target ${target}%).` };
  return { status: 'fail', percent, reason: `${percent}% crash-free over ${sessions} sessions is below the ${target}% target.` };
}

function sessionsUrl({ org, project, release, period }) {
  const params = new URLSearchParams();
  params.append('field', 'crash_free_rate(session)');
  params.append('field', 'sum(session)');
  params.set('project', project);
  params.set('query', `release:"${release}"`);
  params.set('statsPeriod', period);
  params.set('interval', '1d');
  return `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/sessions/?${params}`;
}

function readSessionTotals(body) {
  const totals = body?.groups?.[0]?.totals ?? {};
  return {
    crashFreeRate: typeof totals['crash_free_rate(session)'] === 'number' ? totals['crash_free_rate(session)'] : null,
    sessions: typeof totals['sum(session)'] === 'number' ? totals['sum(session)'] : 0,
  };
}

async function fetchSessionTotals(options, env = process.env, fetchImpl = fetch) {
  // The sessions API takes the numeric project ID, not the slug used for uploads.
  const projectId = [env.SENTRY_PROJECT_ID, env.SENTRY_PROJECT].map((v) => v?.trim()).find((v) => /^\d+$/.test(v ?? ''));
  if (!projectId) throw new Error('Set SENTRY_PROJECT_ID to the numeric project ID (Sentry → Project Settings → General).');
  const res = await fetchImpl(
    sessionsUrl({ org: env.SENTRY_ORG.trim(), project: projectId, release: options.release, period: options.period }),
    { headers: { Authorization: `Bearer ${env.SENTRY_AUTH_TOKEN.trim()}` } },
  );
  if (!res.ok) throw new Error(`Sentry answered ${res.status}. Check the token has org:read and project:read.`);
  return readSessionTotals(await res.json());
}

async function main() {
  const { options, errors } = parseArgs(process.argv.slice(2));
  if (errors.length) fail(['Release gate: fix these and try again.', ...errors]);

  if (!sentryUploadConfigured()) {
    console.log([
      '',
      '● Release gate not checked: Sentry is not set up.',
      '  Set SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT and SENTRY_PROJECT_ID (see docs/app-store/release-flow.md).',
      '  Do not raise the rollout until the gate can be checked.',
      '',
    ].join('\n'));
    process.exit(2);
  }

  let totals;
  try {
    totals = await fetchSessionTotals(options);
  } catch (err) {
    fail(['Release gate: could not read crash-free sessions from Sentry.', String(err.message ?? err)]);
  }
  const verdict = evaluateGate(totals, options);
  const icon = { pass: '✔', fail: '✖', wait: '●' }[verdict.status];
  console.log(`\n${icon} ${options.release}: ${verdict.reason}`);

  if (verdict.status === 'fail') {
    console.log('  Stop the rollout and roll back:  pnpm run update:rollback\n');
    process.exit(1);
  }
  if (verdict.status === 'wait') {
    console.log('  Check again later. The rollout stays where it is.\n');
    process.exit(2);
  }
  if (!options.advance) {
    const next = nextRolloutStep(options.current);
    if (next && options.current) console.log(`  Next step: ${next}%. Re-run with --advance to raise it.`);
    console.log('');
    return;
  }
  const next = nextRolloutStep(options.current);
  requireEasCli();
  console.log(`  Raising update group ${options.group} from ${options.current}% to ${next}%…\n`);
  const status = run('eas', ['update:edit', options.group, '--rollout-percentage', String(next), '--non-interactive']);
  if (status !== 0) fail([`eas update:edit exited with ${status}. The rollout is still at ${options.current}%.`]);
  console.log(`\n✔ Update group ${options.group} is now live for ${next}% of users.\n`);
}

if (require.main === module) {
  main();
}

module.exports = { ROLLOUT_STEPS, parseArgs, nextRolloutStep, evaluateGate, sessionsUrl, readSessionTotals, fetchSessionTotals };
