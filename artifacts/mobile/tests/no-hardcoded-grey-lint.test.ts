/**
 * Ratchet lint for the black/white/silver palette change.
 *
 * The design tokens (lib/theme.ts, contexts/AppThemeContext.tsx,
 * constants/colors.ts) define the app's only grey: a thin silver border
 * wash. No component should hardcode a dark-grey hex or rgb(a) literal —
 * every fill must be black with a token-driven silver border, never a
 * grey fill, and every one of those greys must come from a token so a
 * future palette change only has to touch the token file.
 *
 * Enforced via a shrinking allowlist rather than a hard cutover — the app
 * currently has 24 files with a leftover literal grey from the old dark-grey
 * system, being replaced in small batches (see palette-change PRs) so as not
 * to collide with the parallel header-migration sessions. A file already in
 * the allowlist is still allowed to have literal greys (no new failure), but
 * the allowlist can only ever get SMALLER — remove a file from it the moment
 * its literal greys are replaced with tokens; add a file to it only if it is
 * added here in the same change that adds the file itself.
 * `pnpm vitest run tests/no-hardcoded-grey-lint.test.ts -t stale` fails the
 * moment an entry no longer needs to be there, so a batch that finishes a
 * file gets told exactly which line to delete.
 *
 * A file NOT in the allowlist below and NOT satisfying the rule fails
 * immediately — that's the real enforcement: a brand-new hardcoded grey is
 * caught right away rather than waiting for manual review to notice.
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

// Hex pairs 0x0A-0x3A, equal across R/G/B — "#0A0A0A through #3A3A3A".
const HEX_GREY = /#(0[Aa-fA-F]|1[0-9A-Fa-f]|2[0-9A-Fa-f]|3[0-9Aa])\1\1\b/;
// Decimal 10-58 (0x0A-0x3A) equal across R/G/B inside an rgb()/rgba() call.
const RGB_GREY = /rgba?\(\s*(1[0-9]|[2-4][0-9]|5[0-8])\s*,\s*\1\s*,\s*\1\s*[,)]/;

function hasHardcodedGrey(source: string): boolean {
  return source.split('\n').some((line) => HEX_GREY.test(line) || RGB_GREY.test(line));
}

// Generated from the state of the tree when this lint was added. Replace a
// file's literal greys with `BORDER`/`BORDER_SUBTLE`/`SURFACE`/etc. from
// `@/lib/theme` (or the runtime `useAppTheme()`/`useColors()` equivalents),
// then delete its line here in the same change.
const HARDCODED_GREY_ALLOWLIST = new Set([
  'app/(tabs)/feed.tsx',
  'app/buyer-live.tsx',
  'app/buyer-post-comments.tsx',
  'app/buyer-search.tsx',
  'app/design-bg-replace.tsx',
  'app/live-feed.tsx',
  'app/seller-go-live.tsx',
  'app/seller-live.tsx',
  'app/store-editor.tsx',
  'components/buyer-feed/ShopSideTab.tsx',
  'components/live/LiveOverlays.tsx',
  'components/profile/ProfileStoryAvatar.tsx',
  'components/search/PersonRow.tsx',
  'components/thread-cash/ThreadCashStreakRow.tsx',
  'components/ui/SegmentedControl.tsx',
  'lib/conversationThemes.ts',
  'lib/live/apiLiveProvider.ts',
  'lib/live/previewLiveData.ts',
  'lib/live/previewLiveProvider.ts',
  'lib/previewStories.ts',
]);

describe('no hardcoded grey fills outside the theme files', () => {
  const sourceFiles = ['app', 'components', 'contexts', 'hooks', 'constants', 'lib']
    .map((dir) => path.join(ROOT, dir))
    .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    .flatMap((dir) => walk(dir))
    .map(rel)
    .filter((file) => !TOKEN_FILES.has(file));

  it('flags every file with a literal grey not already tracked', () => {
    const offenders = sourceFiles.filter((file) => hasHardcodedGrey(readFileSync(path.join(ROOT, file), 'utf8')));
    const newOffenders = offenders.filter((file) => !HARDCODED_GREY_ALLOWLIST.has(file));

    expect(newOffenders).toEqual([]);
  });

  it('stale: every allowlisted file still needs to be there', () => {
    const stale = [...HARDCODED_GREY_ALLOWLIST].filter((file) => {
      if (!sourceFiles.includes(file)) return true; // deleted/moved
      return !hasHardcodedGrey(readFileSync(path.join(ROOT, file), 'utf8'));
    });

    expect(stale).toEqual([]);
  });
});
