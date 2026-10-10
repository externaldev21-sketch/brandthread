/**
 * CI guard: production-gated dev/test flags must be referenced only through
 * lib/buildFlags.ts (or, for the Expo Go role bypass, behind `__DEV__`).
 * See docs/review-readiness/prod-hygiene.md.
 *
 * A raw `process.env.EXPO_PUBLIC_<flag>` anywhere else in shipped source is an
 * ungated reference: it would survive into a production native bundle.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SHIPPED_DIRS = ['app', 'lib', 'services', 'hooks', 'components', 'contexts', 'constants', 'store'];

const GATED_ENV_VARS = [
  'EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST',
  'EXPO_PUBLIC_ENABLE_TEST_SUBSCRIPTION_BYPASS',
  'EXPO_PUBLIC_REVENUECAT_TEST_API_KEY',
  'EXPO_PUBLIC_BT_GROWTH_BYPASS',
  'EXPO_PUBLIC_DEV_BYPASS_ROLE',
  'EXPO_PUBLIC_DEV_PREVIEW',
];

/** The one place allowed to read them, plus the `__DEV__`-guarded role bypass. */
const ALLOWED: Record<string, { file: string; mustContain?: string }[]> = {
  EXPO_PUBLIC_DEV_BYPASS_ROLE: [{ file: 'lib/devBypass.ts', mustContain: '__DEV__ &&' }],
  EXPO_PUBLIC_DEV_PREVIEW: [{ file: 'lib/buildFlags.ts', mustContain: '__DEV__ && !IS_PROD_NATIVE' }],
};

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name) && !/\.(test|spec)\.[jt]sx?$/.test(name)) out.push(p);
  }
  return out;
}

function codeLines(src: string): { n: number; text: string }[] {
  return src
    .split('\n')
    .map((text, i) => ({ n: i + 1, text }))
    .filter(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text));
}

describe('production-gated flags are referenced only through lib/buildFlags.ts', () => {
  const files = SHIPPED_DIRS.flatMap((d) => walk(join(ROOT, d)));

  it('scans a non-trivial set of files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const envVar of GATED_ENV_VARS) {
    it(`${envVar} has no ungated reference`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const rel = relative(ROOT, file).split('\\').join('/');
        if (rel === 'lib/buildFlags.ts') continue;
        const src = readFileSync(file, 'utf8');
        const hits = codeLines(src).filter((l) => l.text.includes(envVar));
        if (!hits.length) continue;
        const allow = (ALLOWED[envVar] ?? []).find((a) => a.file === rel);
        if (allow && (!allow.mustContain || src.includes(allow.mustContain))) continue;
        for (const h of hits) offenders.push(`${rel}:${h.n}`);
      }
      expect(offenders, `route ${envVar} through lib/buildFlags.ts`).toEqual([]);
    });
  }

  it('lib/buildFlags.ts gates every test flag on __DEV__ / IS_PROD_NATIVE', () => {
    const src = readFileSync(join(ROOT, 'lib/buildFlags.ts'), 'utf8');
    expect(src).toMatch(/IS_PROD_NATIVE\s*=\s*!__DEV__/);
    expect(src).toMatch(/NAVIGATION_ISOLATION_TEST\s*=\s*\n?\s*!IS_PROD_NATIVE\s*&&/);
    expect(src).toMatch(/ENABLE_TEST_SUBSCRIPTION_BYPASS\s*=\s*\n?\s*__DEV__\s*&&/);
    expect(src).toMatch(/REVENUECAT_TEST_API_KEY[^=]*=\s*__DEV__\s*\n?\s*\?/);
    expect(src).toMatch(/GROWTH_UI_BYPASS\s*=\s*\n?\s*__DEV__\s*\|\|\s*\(!IS_PROD_NATIVE/);
  });

  it('the screenshot/preview-only query params are read only inside preview gates', () => {
    // bt_preview / demo / bt_theme are read in code only by these files, each of
    // which checks __DEV__/ALLOW_DEV_TOOLS/isSellerDevPreview first.
    const ALLOWED_PARAM_READERS = new Set([
      'app/_layout.tsx',
      'app/index.tsx',
      'app/boost.tsx',
      'app/seller-conversation.tsx',
      'app/buyer-conversation.tsx',
      'lib/devPreview.ts',
      'lib/previewRoleSelection.ts',
      'contexts/RoleContext.tsx',
      'contexts/AppThemeContext.tsx',
      'contexts/CookieConsentContext.tsx',
    ]);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file).split('\\').join('/');
      const src = readFileSync(file, 'utf8');
      const reads = codeLines(src).some((l) =>
        /\.get\(['"](bt_preview|demo|bt_theme|bt_capture|bt_call)['"]\)/.test(l.text),
      );
      if (reads && !ALLOWED_PARAM_READERS.has(rel)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('every shipped file that reads a preview query param also checks a dev gate', () => {
    const GATE = /__DEV__|ALLOW_DEV_TOOLS|NAVIGATION_ISOLATION_TEST|isSellerDevPreview|isBuyerDevPreview|isPreviewInboxEnabled|isProductionPreviewHost/;
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file).split('\\').join('/');
      const src = readFileSync(file, 'utf8');
      const reads = codeLines(src).some((l) =>
        /\.get\(['"](bt_preview|demo|bt_theme|bt_capture|bt_call)['"]\)/.test(l.text),
      );
      if (reads && !['lib/devPreview.ts', 'lib/previewRoleSelection.ts'].includes(rel) && !GATE.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the pure preview-role parser behind gated callers', () => {
    const parser = readFileSync(join(ROOT, 'lib/previewRoleSelection.ts'), 'utf8');
    const devPreview = readFileSync(join(ROOT, 'lib/devPreview.ts'), 'utf8');
    const layout = readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8');

    expect(parser).toContain("new URLSearchParams(search).get('bt_preview')");
    expect(devPreview.indexOf("if (!__DEV__ || Platform.OS !== 'web'")).toBeLessThan(
      devPreview.indexOf('resolvePreviewRole(search, savedRole)'),
    );
    expect(layout.indexOf('if ((!__DEV__ && !NAVIGATION_ISOLATION_TEST) || Platform.OS !==')).toBeLessThan(
      layout.indexOf("new URLSearchParams(window.location.search).get('bt_preview')"),
    );
  });
});
