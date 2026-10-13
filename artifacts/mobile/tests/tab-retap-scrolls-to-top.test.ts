/**
 * Less-AI pass, item 86: tapping the tab you're already on scrolls that
 * tab's screen back to the top (iOS / Instagram).
 *
 * Every tab root already wires `useScrollToTop` (through useScrollReset),
 * which listens for React Navigation's `tabPress` event. The buyer tab bar
 * used to return early for the focused tab before emitting it, so the
 * re-tap did nothing. It now emits `tabPress` for the focused tab and
 * still never navigates. The Home feed (which deliberately skips
 * useScrollReset) wires useScrollToTop directly.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('86: re-tapping the active tab scrolls to top', () => {
  const bar = read('components/buyer-nav/BuyerTabBar.tsx');

  it('the buyer tab bar emits tabPress for the already-focused tab, then stops', () => {
    const focusedBranch = bar.slice(bar.indexOf('if (focused) {'), bar.indexOf('if (focused) {') + 400);
    expect(focusedBranch).toContain("navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })");
    expect(focusedBranch).toContain('return;');
    expect(focusedBranch).not.toContain('navigation.navigate');
    expect(focusedBranch).not.toContain('hapticTabChange');
  });

  it('the Home feed jumps to its first post on a re-tap', () => {
    expect(read('app/(tabs)/feed.tsx')).toContain('useScrollToTop(feedListRef);');
  });

  it('tab roots keep their useScrollToTop wiring', () => {
    expect(read('hooks/useScrollReset.ts')).toContain('useScrollToTop(enabled ? (ref as any) : { current: null });');
  });

  it('the seller tab bar (swipe + glow) is not part of this change', () => {
    expect(read('components/SellerGlobalTabBar.tsx')).not.toContain("type: 'tabPress'");
  });
});
