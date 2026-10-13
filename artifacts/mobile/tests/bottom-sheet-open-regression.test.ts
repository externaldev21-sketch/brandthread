/**
 * Regression test for the "Shop the Post never opens" web bug: after PR
 * #137 (relative swipe-dismiss threshold), the sheet's open transform got
 * stuck fully offscreen. Root cause was `identityOrNone` — dropping the
 * `transform` key entirely once the sheet reached its resting (open)
 * value — combined with a `reduceMotion` branch that set that value with a
 * bare assignment instead of `withTiming`. React Native Web's Reanimated
 * DOM patcher does not reliably clear a previously-applied CSS `transform`
 * when a later style update simply omits the key, so the JS-computed style
 * was correct (no transform) while the stale offscreen transform stayed
 * painted forever.
 *
 * These are source-level structure assertions (no React/Reanimated runtime
 * needed) — verified against a real exported web build with Playwright
 * separately (see the PR description).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bottomSheet = readFileSync(resolve(__dirname, '../components/ui/useSheetTransition.ts'), 'utf8');

describe('useSheetTransition open path never gets stuck offscreen', () => {
  it('the sheet transform always keeps the `transform` key present — never drops it via identityOrNone', () => {
    // The bug: once translateY settled at its identity value (0), the style
    // omitted `transform` entirely, and RN Web never cleared the stale CSS
    // transform that was already painted. A always-present key (even an
    // identity `[{ translateY: 0 }]`) is what makes updates actually apply.
    expect(bottomSheet).not.toContain("from '@/lib/animationUtils'");
    expect(bottomSheet).toContain('const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));');
  });

  it('the open target is always animated (spring, or a short timing under Reduce Motion) — never a bare value assignment', () => {
    // No instant `.set(0)`/`.value = 0` shortcut for translateY in the open
    // branch — every write goes through an animation function, which reliably
    // forces the DOM to update even in the reduced-motion case that
    // previously broke instantly.
    expect(bottomSheet).not.toMatch(/translateY\.(set|value)\(?\s*=?\s*0\)?;/);
    expect(bottomSheet).toContain('translateY.set(toRest());');
    expect(bottomSheet).toContain("withSpring(openY, { ...SHEET_SPRING, velocity })");
    expect(bottomSheet).toContain("withTiming(openY, { duration: 150, easing: SHEET_EASING })");
    // Fit-to-content sheets still rest at zero; the existing filter sheet
    // must open at its half detent on the same spring engine.
    expect(bottomSheet).toContain("const openY = detents && (detents.initial ?? 'half') === 'half' ? halfOffset : 0;");
  });

  it('the backdrop is derived from the sheet position, so it fades in sync on open, close and mid-drag', () => {
    expect(bottomSheet).toMatch(/const backdropStyle = useAnimatedStyle\(\(\) => \(\{\s*opacity: interpolate\(\s*translateY\.value/);
  });

  it('closeDistance is independent of the measured sheet height (onSheetLayout only feeds the swipe threshold)', () => {
    const closeDistanceLine = bottomSheet.split('\n').find((l) => l.includes('const closeDistance ='));
    expect(closeDistanceLine).toBeDefined();
    expect(closeDistanceLine).not.toContain('sheetHeight');
    expect(closeDistanceLine).not.toContain('onSheetLayout');
    // Falls back to the window's own height, not a fixed too-small guess.
    expect(closeDistanceLine).toContain('Dimensions.get');
  });

  it('onSheetLayout only ever writes sheetHeight, never closeDistance or translateY directly', () => {
    const onSheetLayoutBlock = bottomSheet.slice(
      bottomSheet.indexOf('const onSheetLayout ='),
      bottomSheet.indexOf('const panGesture ='),
    );
    expect(onSheetLayoutBlock).toContain('sheetHeight.set(height)');
    expect(onSheetLayoutBlock).not.toContain('translateY');
    expect(onSheetLayoutBlock).not.toContain('closeDistance');
  });
});
