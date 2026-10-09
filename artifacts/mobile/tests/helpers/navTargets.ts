/**
 * Hardcoded navigation targets in app source: the first path of every
 * router.push/replace/navigate, `pathname:`, `href`, `route:` string literal.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_DIRS = ['app', 'components', 'lib', 'hooks', 'contexts', 'services', 'constants'];

const NAV_PATTERNS = [
  /router\.(?:push|replace|navigate|dismissTo)\(\s*\(?\s*[`'"](\/[^`'"?#\s]*)/g,
  /\bpathname:\s*[`'"](\/[^`'"?#\s]*)/g,
  /\bhref(?:=\{?|:\s*)\s*\(?[`'"](\/[^`'"?#\s]*)/g,
  /\broute:\s*[`'"](\/[^`'"?#\s]*)/g,
  /<Redirect\s+href=\{?\s*[`'"](\/[^`'"?#\s]*)/g,
  /goBackOr\(\s*\w+\s*,\s*[`'"](\/[^`'"?#\s]*)/g,
];

function walk(dir: string, out: string[] = []): string[] {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

export interface NavTarget { file: string; line: number; target: string }

export function navTargets(): NavTarget[] {
  const out: NavTarget[] = [];
  for (const dir of SOURCE_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = readFileSync(file, 'utf8');
      for (const re of NAV_PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
          const target = m[1];
          if (target.startsWith('/api/') || target === '/') continue;
          const line = src.slice(0, m.index).split('\n').length;
          out.push({ file: path.relative(ROOT, file), line, target });
        }
      }
    }
  }
  return out;
}
