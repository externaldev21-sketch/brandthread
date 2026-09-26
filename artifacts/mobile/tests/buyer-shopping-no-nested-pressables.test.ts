/**
 * Regression guard: no Pressable/Touchable* (a real DOM <button> via
 * react-native-web's accessibilityRole="button") may render inside another
 * one anywhere in the buyer shopping area.
 *
 * A nested button is invalid HTML (browsers print "<button> cannot contain
 * a nested <button>" and the outer/inner press handlers fight each other).
 * This bit the Discover "For You" card, where a HeartToggle (itself a
 * Pressable) was rendered inside the card's own navigation Pressable — see
 * app/(buyer)/discover.tsx's ProductShowcase, where the heart is now a
 * sibling positioned absolutely on top of the card instead of a descendant.
 *
 * This is a lightweight tag-nesting scan, not a full JSX/TSX parse — it's a
 * guardrail against reintroducing this exact class of bug in this PR's
 * files, not a general-purpose linter.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PRESSABLE_TAGS = ['Pressable', 'TouchableOpacity', 'TouchableHighlight'];

// Files in the buyer shopping area that render product/result cards with a
// card-level Pressable — the shape most likely to accidentally nest a second
// pressable (heart/save toggle, bookmark button, follow button, etc.) inside.
const FILES_TO_CHECK = [
  'app/(buyer)/discover.tsx',
  'app/(buyer)/search.tsx',
  'app/buyer-saved.tsx',
  'components/search/ProductTile.tsx',
];

/**
 * Walks a source string's Pressable/Touchable* tags in document order and
 * returns the maximum nesting depth reached. A depth > 1 means one of these
 * components was opened while another was still open — a nested button.
 *
 * Deliberately simple: matches opening/self-closing/closing tags for the
 * named components only, ignoring everything else (including other JSX).
 * Good enough for these hand-written screens, which don't put literal
 * "<Pressable"-shaped text inside string/template literals.
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

describe('buyer shopping cards never nest a Pressable/Touchable inside another', () => {
  for (const relativePath of FILES_TO_CHECK) {
    it(`${relativePath} has no nested Pressable/Touchable*`, () => {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
      expect(maxPressableNestingDepth(source)).toBeLessThanOrEqual(1);
    });
  }

  it('Discover\'s product showcase card renders its save heart as a sibling, not a descendant, of the card Pressable', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/(buyer)/discover.tsx'), 'utf8');
    const cardOpen = source.indexOf('onPress={() => openProduct(item)}');
    const cardClose = source.indexOf('</Pressable>', cardOpen);
    const cardBody = source.slice(cardOpen, cardClose);
    expect(cardBody).not.toContain('<HeartToggle');

    // The heart must still be rendered, just after (a sibling of) the card.
    const afterCard = source.slice(cardClose, cardClose + 400);
    expect(afterCard).toContain('<HeartToggle');
  });
});
