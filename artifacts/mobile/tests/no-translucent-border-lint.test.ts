/**
 * Ratchet lint for the blurry-chip-border bug.
 *
 * Dev's report: filter chips (and cards, stat tiles, inputs, list rows,
 * sheets, outline buttons app-wide) looked blurry/fuzzy-edged. Root cause:
 * a translucent 1px borderColor anti-aliases into a soft edge, because the
 * alpha blends differently against every surface it sits on. The fix was to
 * make the shared border tokens OPAQUE (lib/theme.ts's BORDER/BORDER_SUBTLE,
 * and contexts/AppThemeContext.tsx's palette() border/borderSubtle) instead
 * of translucent — see that change's commit for the full writeup.
 *
 * This lint stops a NEW hardcoded translucent neutral (black/white/silver)
 * borderColor literal from reintroducing the same blur, one component at a
 * time, bypassing the now-opaque token. It intentionally does NOT flag a
 * themed/semantic low-alpha border (an error/success/warning/accent wash
 * like `${theme.error}40` for an alert card) — that's a different, often
 * intentional pattern (a colored tint conveying state), not the neutral
 * "outline" bug this guards against.
 *
 * The tree was otherwise clean of both patterns when this lint was added
 * (every hit — including "glass over photo/video" overlay chrome — was
 * migrated to an opaque border, keeping any deliberately translucent FILL
 * untouched), so this is a near-hard cutover, not an open-ended ratchet: the
 * allowlist holds only the handful of pre-existing, deliberately thin
 * "reduced-chrome" designs that a separate structure test already locks in
 * (see each entry's comment) — a hairline width there is the point, not the
 * blur bug, and its border color is already opaque. Add a new entry only in
 * the same change that adds the file, with the same kind of justification,
 * the way tests/no-hardcoded-grey-lint.test.ts and
 * tests/no-hardcoded-theme-color-lint.test.ts do for their own allowlists.
 *
 * `pnpm vitest run tests/no-translucent-border-lint.test.ts -t stale` fails
 * the moment an allowlist entry no longer needs to be there.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(tsx?|jsx?)$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

function rel(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

// The only files allowed to define these tokens' literal values.
const TOKEN_FILES = new Set(['lib/theme.ts', 'contexts/AppThemeContext.tsx', 'constants/colors.ts']);

// A neutral black/white/silver borderColor at a translucent alpha, as a
// literal string (not a themed `${theme.x}NN` template — see file doc
// comment for why those are out of scope).
const TRANSLUCENT_NEUTRAL_BORDER = /borderColor:\s*['"]rgba\(\s*(0|255|192)\s*,\s*\1\s*,\s*\1\s*,\s*0?\.\d+\s*\)['"]/;
// A hairline border on an outline element — Dev wants exactly 1px, never a
// sub-1px hairline, for chips/cards/inputs/list rows/sheets/outline buttons.
const HAIRLINE_BORDER = /borderWidth:\s*StyleSheet\.hairlineWidth/;

function hasTranslucentBorder(source: string): boolean {
  return source.split('\n').some((line) => TRANSLUCENT_NEUTRAL_BORDER.test(line) || HAIRLINE_BORDER.test(line));
}

// Each entry is a deliberately thin "reduced-chrome" hairline border, with
// an already-opaque color, locked in by its own structure test — see the
// file doc comment. Not the translucency bug this lint otherwise guards.
const TRANSLUCENT_BORDER_ALLOWLIST = new Set<string>([
  // tests/buyer-bottom-navigation-layout.test.ts: "real frosted glass ...
  // a hairline border" — TabBarGlass's edge over the feed.
  'components/tab-bar/TabBarParts.tsx',
  // tests/onboarding-visual-structure.test.ts: "reduced-chrome cards in
  // account type and seller plans".
  'app/account-type.tsx',
  'components/onboarding/SellerPlanRecommendationStep.tsx',
  // tests/onboarding-visual-structure.test.ts: "uses hairline default
  // borders for onboarding inputs and choices" (requires >= 5 of them).
  'app/onboarding.tsx',
]);

describe('no translucent neutral borders or hairline borders outside the theme files', () => {
  const sourceFiles = ['app', 'components', 'contexts', 'hooks', 'constants', 'lib']
    .map((dir) => path.join(ROOT, dir))
    .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    .flatMap((dir) => walk(dir))
    .map(rel)
    .filter((file) => !TOKEN_FILES.has(file));

  it('flags every file with a new translucent border or hairline border', () => {
    const offenders = sourceFiles.filter((file) => hasTranslucentBorder(readFileSync(path.join(ROOT, file), 'utf8')));
    const newOffenders = offenders.filter((file) => !TRANSLUCENT_BORDER_ALLOWLIST.has(file));

    expect(newOffenders).toEqual([]);
  });

  it('stale: every allowlisted file still needs to be there', () => {
    const stale = [...TRANSLUCENT_BORDER_ALLOWLIST].filter((file) => {
      if (!sourceFiles.includes(file)) return true; // deleted/moved
      return !hasTranslucentBorder(readFileSync(path.join(ROOT, file), 'utf8'));
    });

    expect(stale).toEqual([]);
  });
});
