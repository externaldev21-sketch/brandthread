#!/usr/bin/env node
/**
 * Dev's rule: nothing may draw a line at the top of a screen. No hairline,
 * border, shadow or elevation on a header / top bar / status-bar container,
 * and no solid strip pinned under the status bar.
 *
 * Scans every style object in app/ and components/ whose key names a
 * top-of-screen container (header, topBar, navBar, statusBar, …), across
 * multiple lines, and fails on any border/hairline/shadow/elevation in it.
 * Also fails if a "status-bar-mask" strip comes back.
 *
 *   node scripts/lint/no-top-chrome-hairline.mjs        # exit 1 on offenders
 *   node scripts/lint/no-top-chrome-hairline.mjs --json # machine-readable
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIRS = ['app', 'components'];

/** Style keys that name the container at the very top of a screen. Keys for
 *  rows *inside* a list (section headers, card headers, sheet headers) are
 *  not top-of-screen chrome and are deliberately not matched. */
export const TOP_CHROME_KEY = /^(header|headerWrap|headerRow|headerBar|headerContainer|headerTop|topBar|topRow|topChrome|topHeader|navBar|navHeader|appBar|screenHeader|statusBar|statusBarMask|stickyHeader|fixedHeader|wrap)$/;

/** Files whose `wrap`/`header` keys are the shared top-of-screen headers. For
 *  every other file only the unambiguous names above (minus `wrap`) count. */
const SHARED_HEADER_FILES = new Set(['components/ScreenHeader.tsx', 'components/layout/Header.tsx']);

/** Headers of bottom sheets / modal panels. They sit mid-screen above a
 *  sheet's own content, never at the top of a screen, so their divider is
 *  not a top-of-screen line. Anything added here needs that same reason. */
export const ALLOWED = new Set([
  'components/safety/ReportSheet.tsx#header', // report bottom sheet
  'components/design-studio/BrushLibrary.tsx#header', // brush picker sheet in the design canvas
]);

const FORBIDDEN = [
  { re: /\bborder(Top|Bottom)?Width\s*:\s*(?!0\b)[^\s,}][^,}\n]*/, what: 'border' },
  { re: /\bhairlineWidth\b/, what: 'hairline' },
  { re: /\bshadow(Color|Opacity|Radius|Offset)\s*:/, what: 'shadow' },
  { re: /\belevation\s*:\s*[1-9]/, what: 'elevation' },
  { re: /\bboxShadow\s*:/, what: 'shadow' },
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

/** Returns the balanced `{…}` body starting at `open` (index of "{"). */
function bodyFrom(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  return '';
}

export function scanSource(rel, src) {
  const offenders = [];
  const keyRe = /(^|[\s,{])([A-Za-z]+)\s*:\s*\{/g;
  for (let m; (m = keyRe.exec(src));) {
    const key = m[2];
    if (!TOP_CHROME_KEY.test(key)) continue;
    if (key === 'wrap' && !SHARED_HEADER_FILES.has(rel)) continue;
    if (ALLOWED.has(`${rel}#${key}`)) continue;
    const open = m.index + m[0].length - 1;
    const body = bodyFrom(src, open);
    // Only style objects (a nested object is a style, not a prop bag).
    if (!/(padding|margin|flex|height|background|position|alignItems|border|shadow|elevation)/.test(body)) continue;
    for (const f of FORBIDDEN) {
      const hit = body.match(f.re);
      if (hit) {
        const line = src.slice(0, open).split('\n').length;
        offenders.push({ file: rel, line, key, what: f.what, text: hit[0].trim() });
      }
    }
  }
  if (/testID=["']status-bar-mask["']/.test(src)) {
    offenders.push({ file: rel, line: src.split('status-bar-mask')[0].split('\n').length, key: 'StatusBarMask', what: 'solid status-bar strip', text: 'status-bar-mask' });
  }
  return offenders;
}

export function scanRepo() {
  return DIRS.flatMap((d) => walk(d)).flatMap((rel) => scanSource(rel.split(path.sep).join('/'), readFileSync(path.join(ROOT, rel), 'utf8')));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const offenders = scanRepo();
  if (process.argv.includes('--json')) console.log(JSON.stringify(offenders, null, 2));
  else for (const o of offenders) console.log(`${o.file}:${o.line}  ${o.key}: ${o.what} (${o.text})`);
  if (offenders.length) {
    console.error(`\n${offenders.length} top-of-screen line(s). Dev's rule: no hairline, border, shadow or strip at the top of any screen.`);
    process.exit(1);
  }
}
