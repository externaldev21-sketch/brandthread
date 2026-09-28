/**
 * Regression guard for the live bug reported on #200: Discover's "People
 * with your style" row rendered `<FollowButton>` (itself Pressable-backed)
 * INSIDE the card's own `PressableScale` navigation wrapper — a real nested
 * `<button>` on web, which the browser rejects ("<button> cannot contain a
 * nested <button>") and which makes the two press handlers fight each
 * other. `DiscoverBrandCard` and `app/(buyer)/discover.tsx`'s
 * `PersonListRow` had the identical shape.
 *
 * Unlike tests/buyer-shopping-no-nested-pressables.test.ts (which only
 * matches literal `Pressable`/`TouchableOpacity`/`TouchableHighlight` tags),
 * this scan also treats `PressableScale` and `FollowButton` as
 * pressable-rendering tags, since both wrap a real Pressable internally —
 * the literal-tag-only scan is exactly what let this bug ship unnoticed.
 *
 * Lightweight tag-nesting scan, not a full JSX/TSX parse — a guardrail
 * against reintroducing this exact class of bug in these files, not a
 * general-purpose linter.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PRESSABLE_TAGS = ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'PressableScale', 'FollowButton'];

const FILES_TO_CHECK = [
  'app/(buyer)/discover.tsx',
  'components/discover/DiscoverPeopleRow.tsx',
  'components/discover/DiscoverBrandCard.tsx',
  'components/discover/DiscoverPersonCard.tsx',
  'components/discover/DiscoverEntityCard.tsx',
  'components/discover/DiscoverPostViewer.tsx',
  'components/discover/DiscoverTileView.tsx',
  'components/discover/EditorialTile.tsx',
  'components/discover/DiscoverDropRow.tsx',
  'components/discover/DiscoverPager.tsx',
  // DiscoverSafetyMenu.tsx is intentionally excluded: its backdrop/menu
  // Pressables (no accessibilityRole="button") are a modal
  // stop-propagation pattern, not a card — react-native-web only renders a
  // real nested <button> for a Pressable with accessibilityRole="button",
  // which these don't have. Same carve-out PR A already used (matching the
  // untouched components/buyer-feed/LongPressMenu.tsx it mirrors).
];

/**
 * Walks a source string's pressable-tag occurrences in document order and
 * returns the maximum nesting depth reached. A depth > 1 means one of these
 * components was opened while another was still open — a nested button.
 */
function maxPressableNestingDepth(source: string): number {
  const tagPattern = new RegExp(`<(/?)(?:${PRESSABLE_TAGS.join('|')})\\b`, 'g');
  let depth = 0;
  let maxDepth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(source)) !== null) {
    const isClosing = match[1] === '/';
    const tagEnd = source.indexOf('>', match.index);
    const selfClosing = tagEnd > 0 && source[tagEnd - 1] === '/';

    if (isClosing) {
      depth = Math.max(0, depth - 1);
    } else {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      if (selfClosing) depth -= 1;
    }
  }
  return maxDepth;
}

describe('Discover cards never nest a Pressable/PressableScale/FollowButton inside another', () => {
  for (const relativePath of FILES_TO_CHECK) {
    it(`${relativePath} has no nested pressable-rendering tags`, () => {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
      expect(maxPressableNestingDepth(source)).toBeLessThanOrEqual(1);
    });
  }
});
