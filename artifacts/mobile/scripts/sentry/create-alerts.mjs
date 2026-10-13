#!/usr/bin/env node
/**
 * Creates Brandthread's Sentry alert rules (item 127) in the app and API
 * projects. Dry run by default: prints what it would create. Pass --apply to
 * create them. Re-running is safe: rules that already exist (same name) are
 * skipped.
 *
 *   SENTRY_AUTH_TOKEN=… SENTRY_ORG=… SENTRY_PROJECT=<app project> SENTRY_API_PROJECT=<api project> \
 *     node scripts/sentry/create-alerts.mjs [--apply]
 *
 * Optional, to also post to Slack: SENTRY_SLACK_WORKSPACE_ID, SENTRY_SLACK_CHANNEL.
 * The token needs the alerts:write (or project:write) scope. It is only read
 * from the environment and never printed.
 */
import { alertRules, slackAction } from './alert-rules.mjs';

const apply = process.argv.includes('--apply');
const { SENTRY_AUTH_TOKEN: token, SENTRY_ORG: org, SENTRY_PROJECT: appProject, SENTRY_API_PROJECT: apiProject } = process.env;
const base = (process.env.SENTRY_URL ?? 'https://sentry.io').replace(/\/$/, '');
const slack = slackAction(process.env.SENTRY_SLACK_WORKSPACE_ID, process.env.SENTRY_SLACK_CHANNEL);

const targets = [
  appProject && { app: 'mobile', project: appProject },
  apiProject && { app: 'api', project: apiProject },
].filter(Boolean);

if (!org || targets.length === 0) {
  console.error('Set SENTRY_ORG and at least one of SENTRY_PROJECT (app) / SENTRY_API_PROJECT (API).');
  process.exit(1);
}
if (apply && !token) {
  console.error('Set SENTRY_AUTH_TOKEN to create rules (dry run works without it).');
  process.exit(1);
}

const api = async (path, init = {}) => {
  const res = await fetch(`${base}/api/0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};

let failed = false;
for (const { app, project } of targets) {
  const rules = alertRules({ app, slack });
  const existing = apply ? new Set((await api(`/projects/${org}/${project}/rules/`)).map((r) => r.name)) : new Set();
  for (const rule of rules) {
    if (!apply) { console.log(`[dry run] ${org}/${project}: ${rule.name}`); continue; }
    if (existing.has(rule.name)) { console.log(`exists   ${org}/${project}: ${rule.name}`); continue; }
    try {
      await api(`/projects/${org}/${project}/rules/`, { method: 'POST', body: JSON.stringify(rule) });
      console.log(`created  ${org}/${project}: ${rule.name}`);
    } catch (error) {
      failed = true;
      console.error(`failed   ${org}/${project}: ${rule.name}: ${error.message}`);
    }
  }
}
if (!apply) console.log('\nNothing was created. Re-run with --apply.');
process.exit(failed ? 1 : 0);
