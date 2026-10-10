/**
 * Cold-start guard: heavy, rarely-first-used packages must never be reached
 * by a static `import` from the startup path.
 *
 * The startup path is the app entry (index.ts + lib/bootstrap.ts), the root
 * layout, both tab layouts and the screens a cold launch can land on first.
 * Everything those files import statically (transitively, through local
 * files, every platform variant) is evaluated before the first screen paints
 * on native and is shipped in the first-load web chunks. Heavy modules belong
 * behind a lazy `require()` inside the function that needs them (see
 * lib/skiaAvailability.ts, lib/agoraAvailability.ts, lib/revenueCat.native.tsx),
 * a dynamic `import()` (lib/shareCard.ts) or the screen that uses them.
 *
 * `import type` / `export type` and lazy `require()` / `import()` calls are
 * not static imports and are allowed.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

const STARTUP_ENTRIES = [
  'index.ts',
  'lib/bootstrap.ts',
  'app/_layout.tsx',
  'app/(tabs)/_layout.tsx',
  'app/(buyer)/_layout.tsx',
  // Screens a cold launch can render first.
  'app/index.tsx',
  'app/splash.tsx',
  'app/sign-in.tsx',
  'app/(buyer)/index.tsx',
  'app/(tabs)/index.tsx',
];

/** Package names (or prefixes ending in "/") that must stay off the startup path. */
const HEAVY_PACKAGES = [
  '@shopify/react-native-skia',
  'react-native-agora',
  '@stripe/stripe-react-native',
  '@stripe/stripe-js',
  '@stripe/react-stripe-js',
  'react-native-purchases',
  'react-native-webview',
  'react-native-view-shot',
  'html2canvas',
  'react-native-qrcode-svg',
  'qrcode',
  'expo-camera',
  'expo-print',
  'expo-contacts',
  '@sentry/react-native',
];

/** Design-studio / story typefaces. Only Inter is part of the app's base type scale. */
const ALLOWED_FONT_PACKAGES = new Set(['@expo-google-fonts/inter']);

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];
const PLATFORM_SUFFIXES = ['', '.native', '.ios', '.android', '.web'];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Static, value-level module specifiers of a file. */
function staticImportSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const specs: string[] = [];
  const statement = /(?:^|[\n;])\s*(import|export)\s+([^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = statement.exec(code))) {
    const clause = (match[2] ?? '').replace(/\s+from\s+$/, '').trim();
    if (/^type\b/.test(clause)) continue;
    // `import { type A, type B } from 'x'` is erased entirely.
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named && named[1].split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '))) continue;
    // `export const x = ...` etc. are not re-exports.
    if (match[1] === 'export' && !match[2]) continue;
    specs.push(match[3]);
  }
  return specs;
}

function resolveLocalVariants(spec: string, fromFile: string): string[] {
  let base: string;
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return [];
  const found: string[] = [];
  const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
  if (isFile(base)) found.push(base);
  for (const stem of [base, join(base, 'index')]) {
    for (const platform of PLATFORM_SUFFIXES) {
      for (const ext of SOURCE_EXTENSIONS) {
        const candidate = `${stem}${platform}${ext}`;
        if (isFile(candidate) && !found.includes(candidate)) found.push(candidate);
      }
    }
    if (found.length) break;
  }
  return found;
}

function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isLocal(spec: string): boolean {
  return spec.startsWith('@/') || spec.startsWith('.');
}

/** Every package reached statically from the entries, with the import chain that reaches it. */
function startupPackages(entries: string[]): Map<string, string[]> {
  const parent = new Map<string, string | null>();
  const packages = new Map<string, string[]>();
  const queue: string[] = [];
  for (const entry of entries) {
    const file = join(ROOT, entry);
    if (!existsSync(file)) continue;
    parent.set(file, null);
    queue.push(file);
  }
  const chainTo = (file: string) => {
    const chain: string[] = [];
    for (let at: string | null | undefined = file; at; at = parent.get(at)) chain.unshift(relative(ROOT, at));
    return chain;
  };
  while (queue.length) {
    const file = queue.shift()!;
    for (const spec of staticImportSpecifiers(readFileSync(file, 'utf8'))) {
      if (!isLocal(spec)) {
        const name = packageName(spec);
        if (!packages.has(name)) packages.set(name, chainTo(file));
        continue;
      }
      for (const target of resolveLocalVariants(spec, file)) {
        if (parent.has(target)) continue;
        parent.set(target, file);
        queue.push(target);
      }
    }
  }
  return packages;
}

describe('startup path stays free of heavy modules', () => {
  const packages = startupPackages(STARTUP_ENTRIES);

  it('walks a real graph (sanity check)', () => {
    expect(packages.has('react-native')).toBe(true);
    expect(packages.has('expo-router')).toBe(true);
    expect(packages.has('@clerk/expo')).toBe(true);
  });

  it.each(HEAVY_PACKAGES)('%s is not imported statically at start-up', (heavy) => {
    const offenders = [...packages.keys()].filter((name) => name === heavy);
    expect(offenders.map((name) => `${name} via ${packages.get(name)!.join(' -> ')}`)).toEqual([]);
  });

  it('only the base Inter typeface is loaded at start-up (design-studio fonts stay lazy)', () => {
    const fonts = [...packages.keys()].filter((name) => name.startsWith('@expo-google-fonts/') && !ALLOWED_FONT_PACKAGES.has(name));
    expect(fonts.map((name) => `${name} via ${packages.get(name)!.join(' -> ')}`)).toEqual([]);
  });

  it('parses value imports and ignores type-only ones', () => {
    expect(staticImportSpecifiers([
      "import type { A } from 'type-only';",
      "import { type B, type C } from 'inline-types';",
      "export type { D } from 'export-type';",
      "import Real from 'real';",
      "import { type E, F } from 'mixed';",
      "export { G } from 'reexport';",
      "export * from 'star';",
      "import 'side-effect';",
      "// import Commented from 'commented';",
      "const lazy = () => import('dynamic');",
      "const req = () => require('lazy-require');",
    ].join('\n'))).toEqual(['real', 'mixed', 'reexport', 'star', 'side-effect']);
  });
});

describe('heavy web-only weight stays out of the shared web chunk', () => {
  const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

  it('the web Skia probe never bundles @shopify/react-native-skia', () => {
    const web = stripComments(read('lib/skiaAvailability.web.ts'));
    expect(web).not.toContain('@shopify/react-native-skia');
    expect(web).toMatch(/export function loadSkia\(\)/);
    expect(web).toMatch(/export function isSkiaAvailable\(\)/);
    expect(web).toMatch(/export function __resetSkiaCacheForTests\(\)/);
  });

  it('react-native-view-shot (html2canvas on web) is only loaded on demand', () => {
    for (const file of [
      'app/buyer-story-create.tsx',
      'app/design-mockup-preview.tsx',
      'app/design-bg-removal.tsx',
      'components/design/BgRefineCanvas.tsx',
      'lib/shareCard.ts',
    ]) {
      const source = read(file);
      expect(staticImportSpecifiers(source), file).not.toContain('react-native-view-shot');
      expect(source, file).toContain("await import('react-native-view-shot')");
    }
  });
});
