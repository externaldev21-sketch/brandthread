// Route -> area/owner lookup for the half-done audit scoreboard.
//
// The actual rules live in route-ownership.json (data, reusable/auditable
// outside this script too) — this module just compiles them into a fast
// matcher and exposes ownerForRoute(). See docs/audit/README.md for the
// heuristic writeup (why each area got the routes it did).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, 'route-ownership.json');
const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

const ownerLabels = data.owners;
const rules = data.rules.map((r) => ({ match: r.match.toLowerCase(), owner: r.owner }));

/**
 * Returns the human-readable "area (session ...)" label for a route path
 * (e.g. "/(buyer)/discover", "/design-canvas"), or 'unassigned (needs a
 * route-ownership.json rule)' if nothing matched — that string should never
 * appear in a real report; if it does, add a rule.
 */
export function ownerForRoute(routePath) {
  const r = (routePath || '').toLowerCase();
  for (const rule of rules) {
    if (r.includes(rule.match)) {
      return ownerLabels[rule.owner] ?? rule.owner;
    }
  }
  return 'unassigned (needs a route-ownership.json rule)';
}

export function ownerKeyForRoute(routePath) {
  const r = (routePath || '').toLowerCase();
  for (const rule of rules) {
    if (r.includes(rule.match)) return rule.owner;
  }
  return 'unassigned';
}

export { ownerLabels };
