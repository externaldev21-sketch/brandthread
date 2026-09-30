#!/usr/bin/env node
/**
 * Static dead-UI crawler (offline, no browser). Complements the Playwright
 * based scripts/audit/half-done-audit.mjs, which finds dead taps at runtime;
 * this one is fast enough for CI and catches:
 *
 *   route      router.push/replace/navigate/dismissTo, <Link href>, <Redirect
 *              href>, href:/pathname: literals whose target has no file in app/
 *   noop       onPress={() => {}} / noop / undefined handlers on pressables
 *   todo       TODO / FIXME / lorem ipsum / "coming soon" / "placeholder" copy
 *   external   hard-coded http(s) URLs (listed; HEAD-checking needs network)
 *   mailto/tel malformed mailto: / tel: targets
 *
 * Usage:  node scripts/audit-dead-ui.mjs [--json out.json] [--ci]
 * --ci exits 1 on any route/noop/todo/mailto/tel finding that is not in
 * scripts/audit-dead-ui.allowlist.json (external URLs never fail the run).
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['app', 'components', 'contexts', 'hooks', 'lib', 'services'];
const args = process.argv.slice(2);
const ci = args.includes('--ci');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules' || n === '__tests__') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(n) && !/\.(test|spec)\.[jt]sx?$/.test(n)) out.push(p);
  }
  return out;
}

// ── Route table from app/ ────────────────────────────────────────────────────
const routes = []; // arrays of segments; '*' = dynamic, '**' = catch-all
for (const f of walk(join(ROOT, 'app'))) {
  let rel = relative(join(ROOT, 'app'), f).split('\\').join('/').replace(/\.(tsx?|jsx?)$/, '');
  if (/(^|\/)_layout$/.test(rel) || /\+(html|not-found)$/.test(rel)) continue;
  const segs = rel.split('/').filter((s) => !/^\(.*\)$/.test(s));
  if (segs[segs.length - 1] === 'index') segs.pop();
  routes.push(segs.map((s) => (/^\[\.\.\..*\]$/.test(s) ? '**' : /^\[.*\]$/.test(s) ? '*' : s)));
}
function routeExists(path) {
  const clean = path.split('#')[0].split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '');
  const segs = clean === '' ? [] : clean.split('/').filter((x) => !/^\(.*\)$/.test(x));
  return routes.some((r) => {
    for (let i = 0; i < r.length; i++) {
      if (r[i] === '**') return segs.length > i;
      if (i >= segs.length) return false;
      if (r[i] !== '*' && r[i] !== segs[i]) return false;
    }
    return r.length === segs.length;
  });
}

const allowlist = existsSync(join(ROOT, 'scripts/audit-dead-ui.allowlist.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'scripts/audit-dead-ui.allowlist.json'), 'utf8'))
  : [];
const allowed = (kind, file, text) =>
  allowlist.some((a) => a.kind === kind && a.file === file && (!a.match || text.includes(a.match)));

const findings = [];
const externals = new Map();
const add = (kind, file, line, text) => findings.push({ kind, file, line, text: text.trim().slice(0, 160) });

const NAV = /\b(?:router|navigation)\.(?:push|replace|navigate|dismissTo|setParams)\(\s*(?:\{[^}]*?pathname:\s*)?(['"`])((?:\\.|(?!\1).)*)\1/g;
const HREF = /\b(?:href|pathname)\s*[=:]\s*\{?\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
const NOOP = /on(?:Press|LongPress|PressIn)\s*=\s*\{\s*(?:\(\s*\)\s*=>\s*(?:\{\s*\}|undefined|null)|noop|\(\)\s*=>\s*void 0)\s*\}/;
const TODO = /\b(TODO|FIXME|XXX)\b|lorem ipsum|coming soon|\bTBD\b|placeholder (?:text|copy|image)|\bdummy (?:text|data)\b/i;
const URL_RE = /https?:\/\/[^\s'"`)}<>\\]+/g;

for (const dir of SCAN) {
  for (const f of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, f).split('\\').join('/');
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((raw, i) => {
      const ln = i + 1;
      const isComment = /^\s*(\/\/|\*|\/\*)/.test(raw);
      if (!isComment) {
        for (const re of [NAV, HREF]) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(raw))) {
            if (/\/\$\{[^}]*\}(\/|$)/.test(m[2])) continue; // whole dynamic segment: unverifiable statically
            let target = m[2].replace(/\$\{[^}]*\}/g, 'x');
            if (!target.startsWith('/')) continue; // relative/variable/scheme
            if (target === '/' || target.startsWith('//')) continue;
            if (!routeExists(target)) add('route', rel, ln, `${target}  ←  ${raw.trim()}`);
          }
        }
        if (NOOP.test(raw)) add('noop', rel, ln, raw);
        for (const m of raw.matchAll(/(mailto:|tel:)([^'"`\s)}]*)/g)) {
          const [, scheme, rest] = m;
          const val = rest.replace(/\$\{[^}]*\}/g, 'x');
          const ok = scheme === 'mailto:'
            ? val === '' || val.startsWith('?') || /^[^@\s?]+@[^@\s?]+\.[^@\s?]+(\?.*)?$/.test(val) || /^x/.test(val)
            : /^\+?[0-9x\-() .]{5,}$/.test(val) || /^x/.test(val);
          if (!ok) add(scheme.slice(0, -1), rel, ln, raw);
        }
      }
      if (/\b(TODO|FIXME|XXX)\b|lorem ipsum|coming soon|\bTBD\b|placeholder (text|copy|image)|\bdummy (text|data)\b/i.test(raw)
          && (isComment ? /\b(TODO|FIXME)\b/.test(raw) : TODO.test(raw))) {
        add('todo', rel, ln, raw);
      }
      if (!isComment) {
        for (const m of raw.matchAll(URL_RE)) {
          const u = m[0].replace(/[.,;]+$/, '');
          if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(u) || u.includes('${')) continue;
          if (/^https?:\/\/(www\.)?w3\.org/.test(u)) continue; // svg/xml namespaces
          const arr = externals.get(u) ?? [];
          arr.push(`${rel}:${ln}`);
          externals.set(u, arr);
        }
      }
    });
  }
}

const real = findings.filter((x) => !allowed(x.kind, x.file, x.text));
const byKind = {};
for (const x of real) (byKind[x.kind] ??= []).push(x);

console.log(`routes indexed: ${routes.length}`);
for (const [k, list] of Object.entries(byKind)) {
  console.log(`\n== ${k} (${list.length}) ==`);
  for (const x of list) console.log(`${x.file}:${x.line}  ${x.text}`);
}
console.log(`\n== external URLs (${externals.size}; not HEAD-checked offline) ==`);
for (const [u, where] of [...externals.entries()].sort()) console.log(`${u}  (${where.slice(0, 3).join(', ')}${where.length > 3 ? ', …' : ''})`);
console.log(`\nfindings: ${real.length}  (allowlisted: ${findings.length - real.length})`);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ findings: real, external: Object.fromEntries(externals) }, null, 2));
}
if (ci && real.length) process.exit(1);
