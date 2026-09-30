/**
 * Ratchet lint for the Appearance-theme blackout bug.
 *
 * Settings > Appearance lets sellers/buyers pick one of 12 color themes
 * (contexts/AppThemeContext.tsx). Every screen must re-theme with it. The
 * regression this guards against: a component reaching for a
 * theme-INDEPENDENT color instead of the live theme —
 *  - a literal black/white hex, rgb(a), or named-color string
 *    ('#000', '#000000', 'black', '#0A0A0A', 'rgb(0,0,0)', '#fff', 'white', …)
 *    used as a color value outside the theme definition files themselves;
 *  - importing one of lib/theme.ts's legacy monochrome-only color constants
 *    (BG/SURFACE/CARD/FG/ACCENT/PURPLE/CYAN/BLUE/… — see LEGACY_COLOR_TOKENS
 *    below) and using it as a color prop, instead of `useAppTheme()`'s
 *    `theme.background/theme.accent/…` or the `useColors()` compatibility
 *    hook.
 *
 * Three accents are allowed to stay fixed regardless of theme (LIVE badge
 * red, end-call red, Thread Cash green) — this lint does not special-case
 * them by name; a file that legitimately needs one of them stays on the
 * allowlist below rather than being exempted by pattern-matching, so a
 * reviewer double-checks every entry instead of the lint silently trusting
 * a comment.
 *
 * Enforced via a shrinking allowlist rather than a hard cutover, matching
 * tests/no-hardcoded-grey-lint.test.ts's approach for the same class of
 * problem — a first full scan of the app found ~2,000+ hits across 100+
 * files (the legacy `lib/theme.ts` constants were never fully migrated off
 * of), too many to fix in one change. A file already in the allowlist may
 * keep its hits (no new failure); the allowlist can only ever get SMALLER —
 * remove a file the moment its hits are replaced with theme tokens, and
 * only add one in the same change that adds the file.
 *
 * `pnpm vitest run tests/no-hardcoded-theme-color-lint.test.ts -t stale`
 * fails the moment an allowlist entry no longer needs to be there.
 *
 * A file NOT in the allowlist and NOT satisfying the rule fails
 * immediately — a brand-new hardcoded-theme-color hit is caught right away.
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

// The only files allowed to define these literal values.
const TOKEN_FILES = new Set(['lib/theme.ts', 'contexts/AppThemeContext.tsx', 'constants/colors.ts']);

// Pure/near-pure black or white, as a hex literal, rgb(a)(...), or the
// named colors 'black'/'white' — used as a color value.
const HEX_BLACK_OR_WHITE = /#(000000|000|0a0a0a|0a0a0b|fff{3,4}|ffffff)\b/i;
const RGB_BLACK_OR_WHITE = /rgba?\(\s*(0|255)\s*,\s*\1\s*,\s*\1\s*[,)]/;
const NAMED_BLACK_OR_WHITE = /:\s*['"](black|white)['"]/;

// Legacy monochrome-only color constants from lib/theme.ts. Every one of
// these resolves to a fixed black/white/silver value in EVERY Appearance
// theme by construction (see lib/theme.ts) — using one as a color prop is
// the bug, regardless of which theme is active.
const LEGACY_COLOR_TOKENS = [
  'BG', 'SCREEN_BG', 'SURFACE', 'CARD', 'CARD_ELEVATED', 'OVERLAY',
  'SURFACE_GLASS', 'CARD_GLASS', 'CARD_ELEVATED_GLASS',
  'SELLER_DASHBOARD_GLASS', 'SELLER_DASHBOARD_GLASS_ELEVATED',
  'BORDER_ACTIVE', 'BORDER_FOCUS',
  'FG', 'TEXT_PRIMARY', 'ON_DARK',
  'ACCENT', 'ACCENT_LIGHT', 'ACCENT_DIM',
  'PURPLE', 'PURPLE_LIGHT', 'PURPLE_DIM',
  'CYAN', 'CYAN_LIGHT', 'CYAN_DIM',
  'BLUE', 'BLUE_DIM',
  'GRAD_PRIMARY', 'GRAD_HERO', 'GRAD_CARD_GLOW', 'GRAD_DARK_FADE', 'GRAD_TAB_BAR',
];

const LEGACY_TOKEN_IMPORT = new RegExp(
  `import\\s*\\{[^}]*\\}\\s*from\\s*['"]@/lib/theme['"]`,
);
const LEGACY_TOKEN_NAMES = new RegExp(`\\b(${LEGACY_COLOR_TOKENS.join('|')})\\b`);

function importedLegacyTokens(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@\/lib\/theme['"]/g)) {
    const names = match[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]);
    for (const name of names) {
      if (LEGACY_COLOR_TOKENS.includes(name)) found.push(name);
    }
  }
  return found;
}

function hasHardcodedThemeColor(source: string, file: string): boolean {
  const lines = source.split('\n');

  // Literal black/white used as a color value, outside a comment line.
  const hasLiteral = lines.some((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
    return HEX_BLACK_OR_WHITE.test(line) || RGB_BLACK_OR_WHITE.test(line) || NAMED_BLACK_OR_WHITE.test(line);
  });
  if (hasLiteral) return true;

  // A legacy monochrome-only token imported from @/lib/theme and actually
  // referenced elsewhere in the file (not just re-exported unused).
  if (LEGACY_TOKEN_IMPORT.test(source)) {
    const tokens = importedLegacyTokens(source);
    for (const token of tokens) {
      const usageCount = (source.match(new RegExp(`\\b${token}\\b`, 'g')) ?? []).length;
      // 1 occurrence = only the import itself; >1 means it's used somewhere.
      if (usageCount > 1) return true;
    }
  }
  return false;
}

// Generated from the state of the tree when this lint was added, after the
// first fix pass (shared checkout primitives, BrandthreadUI.tsx,
// EngagementButton.tsx, IconButton.tsx, Chip.tsx, and the explicitly
// reported screens). Replace a file's hardcoded colors with
// `useAppTheme()`/`useColors()` tokens, then delete its line here in the
// same change.
const HARDCODED_THEME_COLOR_ALLOWLIST = new Set<string>([
  '__PLACEHOLDER__',
]);

describe('no hardcoded black/white theme colors outside the theme files', () => {
  const sourceFiles = ['app', 'components', 'contexts', 'hooks', 'constants', 'lib']
    .map((dir) => path.join(ROOT, dir))
    .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    .flatMap((dir) => walk(dir))
    .map(rel)
    .filter((file) => !TOKEN_FILES.has(file));

  it('flags every file with a hardcoded theme color not already tracked', () => {
    const offenders = sourceFiles.filter((file) => hasHardcodedThemeColor(readFileSync(path.join(ROOT, file), 'utf8'), file));
    const newOffenders = offenders.filter((file) => !HARDCODED_THEME_COLOR_ALLOWLIST.has(file));

    expect(newOffenders).toEqual([]);
  });

  it('stale: every allowlisted file still needs to be there', () => {
    const stale = [...HARDCODED_THEME_COLOR_ALLOWLIST].filter((file) => {
      if (!sourceFiles.includes(file)) return true; // deleted/moved
      return !hasHardcodedThemeColor(readFileSync(path.join(ROOT, file), 'utf8'), file);
    });

    expect(stale).toEqual([]);
  });
});
