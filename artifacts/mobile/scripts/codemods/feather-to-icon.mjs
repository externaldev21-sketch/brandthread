#!/usr/bin/env node
/**
 * Codemod: Feather → the shared `Icon` (components/ui/Icon.tsx — SF Symbols
 * on iOS, Material on Android/web, Feather glyph only for unmapped names).
 *
 * Re-runnable and idempotent, so the consistency PR can be regenerated on a
 * fresh dev instead of hand-merging 400+ files:
 *
 *   node scripts/codemods/feather-to-icon.mjs            rewrite in place
 *   node scripts/codemods/feather-to-icon.mjs --check    list files it would change
 *
 * Per file that imports Feather from '@expo/vector-icons':
 *  - `<Feather …>` JSX → `<Icon …>` (same `name`/`size`/`color`/`style` props)
 *  - `keyof typeof Feather.glyphMap` and `ComponentProps<typeof Feather>['name']`
 *    → `IconName`
 *  - drops Feather from the import (keeps the other vector-icons) and adds
 *    `import { Icon, type IconName } from '@/components/ui/Icon'`
 *  - if the file still references Feather some other way, the Feather import
 *    is kept (the design lint baseline still counts it)
 *  - a file that already has its own `Icon` identifier gets the import as
 *    `AppIcon` instead
 *
 * Never touches the seller tab bar / glow / Studio menu files (Dev's rule) or
 * the shared Icon implementation itself.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIRS = ['app', 'components'];
export const EXCLUDE = [
  /^components\/tab-bar\//,
  /^components\/SellerGlobalTabBar\.tsx$/,
  /^components\/SellerStudioRadialMenu\.tsx$/,
  /^components\/StudioMenuHints\.tsx$/,
  /^components\/ui\/Icon\.tsx$/,
  /\.test\.tsx?$/,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]@expo\/vector-icons['"];?[^\n]*\n?/;

/** Pure: returns the rewritten source, or null when nothing changes. */
export function transform(src) {
  const m = src.match(IMPORT_RE);
  if (!m) return null;
  const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (!names.includes('Feather')) return null;

  const hasOwnIcon = /\b(const|let|function|class|type|interface)\s+Icon\b|\bIcon\s*[:=]|import[^;]*\bIcon\b[^;]*from\s*['"](?!@\/components\/ui\/Icon)/.test(src)
    || /[{,]\s*Icon\s*[,}]/.test(src.replace(IMPORT_RE, ''));
  const tag = hasOwnIcon ? 'AppIcon' : 'Icon';

  let out = src;
  out = out.replace(/(?:React\.)?ComponentProps<typeof Feather>\[['"]name['"]\]/g, 'IconName');
  out = out.replace(/keyof\s+typeof\s+Feather\.glyphMap/g, 'IconName');
  out = out.replace(/<Feather(?=[\s/>])/g, `<${tag}`);
  out = out.replace(/<\/Feather>/g, `</${tag}>`);

  const body = out.replace(IMPORT_RE, '');
  const stillFeather = /\bFeather\b/.test(body);
  const usesIcon = new RegExp(`<${tag}[\\s/>]`).test(body);
  const usesIconName = /\bIconName\b/.test(body);
  if (!usesIcon && !usesIconName && stillFeather) return null;

  const kept = stillFeather ? names : names.filter((n) => n !== 'Feather');
  const vectorLine = kept.length ? `import { ${kept.join(', ')} } from '@expo/vector-icons';\n` : '';
  const parts = [];
  if (usesIcon) parts.push(hasOwnIcon ? 'Icon as AppIcon' : 'Icon');
  if (usesIconName && !/\bIconName\b/.test(src.replace(IMPORT_RE, '').replace(/IconName/g, (x, i) => x))) parts.push('type IconName');
  const already = /from\s*['"]@\/components\/ui\/Icon['"]/.test(out);
  const iconLine = parts.length && !already ? `import { ${parts.join(', ')} } from '@/components/ui/Icon';\n` : '';
  out = out.replace(IMPORT_RE, vectorLine + iconLine);
  return out === src ? null : out;
}

function main() {
  const check = process.argv.includes('--check');
  const changed = [];
  for (const dir of DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (EXCLUDE.some((re) => re.test(rel))) continue;
      const src = readFileSync(file, 'utf8');
      const next = transform(src);
      if (next == null) continue;
      changed.push(rel);
      if (!check) writeFileSync(file, next);
    }
  }
  console.log(`${check ? 'Would change' : 'Changed'} ${changed.length} files`);
  if (check) for (const f of changed) console.log('  ' + f);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
