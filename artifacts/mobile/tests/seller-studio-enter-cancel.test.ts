import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');

/**
 * Dev's follow-up on the auto-enter pill: a plain "Cancel" text link above
 * it while the 1s fill counts down. Tapping it stops the fill and swaps the
 * pill to a static "Continue" (still tappable to open whenever). Landing on
 * any card afterward — including the same one again — always arms a fresh
 * countdown; a cancelled state never carries over to another card.
 */
describe('Studio auto-enter: enterState is a real 3-state machine (hidden / counting / cancelled)', () => {
  it('declares the three states, defaulting to hidden', () => {
    expect(studio).toContain("useState<'hidden' | 'counting' | 'cancelled'>('hidden')");
  });

  it('a lock arms "counting" (not a plain boolean) — the same state that starts the fill', () => {
    const horizontalBranch = studio.slice(studio.indexOf("cardGestureAxis.value === 'horizontal') {"));
    const setCountingIdx = horizontalBranch.indexOf("runOnJS(setEnterState)('counting')");
    const fillStartIdx = horizontalBranch.indexOf('fillProgress.value = withTiming(1,');
    expect(setCountingIdx).toBeGreaterThan(-1);
    expect(fillStartIdx).toBeGreaterThan(setCountingIdx);
  });

  it('every path that resets to hidden uses the state machine, not a boolean flag', () => {
    expect(studio).not.toContain('isLockedJS');
    expect(studio).not.toContain('setIsLockedJS');
    // Every touch-driven reset (card area onBegin, header dismiss onStart)
    // and every close-without-opening path (cancelEnterFill, commitAndOpen)
    // sets 'hidden'.
    const hiddenResets = studio.match(/setEnterState\('hidden'\)|runOnJS\(setEnterState\)\('hidden'\)/g) ?? [];
    expect(hiddenResets.length).toBeGreaterThanOrEqual(4);
  });
});

describe('Studio auto-enter: Cancel link', () => {
  it('renders only while counting, as a plain text button with no background/border', () => {
    expect(studio).toContain("{enterState === 'counting' && (");
    expect(studio).toContain('testID="seller-studio-enter-cancel"');
    const cancelStyleBlock = studio.slice(studio.indexOf('cancelLink: {'), studio.indexOf('cancelLinkLabel:'));
    expect(cancelStyleBlock).not.toContain('backgroundColor');
    expect(cancelStyleBlock).not.toContain('borderWidth');
  });

  it('has at least a 44x44 hit area via hitSlop even though the visible label is small', () => {
    expect(studio).toMatch(/hitSlop=\{\{ top: 14, bottom: 14, left: 20, right: 20 \}\}/);
  });

  it('is Inter Medium ~14px, colored from a theme token (never hardcoded)', () => {
    expect(studio).toContain("cancelLinkLabel: { fontSize: 14, fontFamily: FONT.medium, color: theme.muted }");
  });

  it('tapping it stops the timer, resets the fill to empty, moves to "cancelled", and fires a light haptic', () => {
    const cancelOnPress = studio.slice(studio.indexOf('testID="seller-studio-enter-cancel"'), studio.indexOf('testID="seller-studio-enter-button"'));
    expect(cancelOnPress).toContain('cancelAnimation(fillProgress);');
    expect(cancelOnPress).toContain('fillProgress.value = 0;');
    expect(cancelOnPress).toContain("setEnterState('cancelled');");
    expect(cancelOnPress).toContain('ImpactFeedbackStyle.Light');
  });
});

describe('Studio auto-enter: cancelled state shows "Continue", still opens on tap', () => {
  it('the pill label swaps to "Continue" only when cancelled, "Entering page" otherwise', () => {
    const labelSwaps = studio.match(/enterState === 'cancelled' \? 'Continue' : 'Entering page'/g) ?? [];
    // Both the base (white-on-dark) and filled (black-on-white reveal) copies swap identically.
    expect(labelSwaps.length).toBe(2);
  });

  it('the pill\'s onPress is unconditionally openCurrentItem — tapping it opens whether counting (skip) or cancelled (continue)', () => {
    const buttonBlock = studio.slice(studio.indexOf('testID="seller-studio-enter-button"'), studio.indexOf('onLayout={(e) => setEnterButtonWidth'));
    expect(buttonBlock).toContain('onPress={openCurrentItem}');
  });

  it('the pill label crossfades on state change via a dedicated opacity animation, not an abrupt swap', () => {
    expect(studio).toContain("const pillContentOpacity = useSharedValue(1);");
    expect(studio).toContain('pillContentOpacity.value = 0;');
    expect(studio).toContain('pillContentOpacity.value = withTiming(1, { duration: 220');
    expect(studio).toContain('const pillContentStyle = useAnimatedStyle(() => ({\n    opacity: pillContentOpacity.value,\n  }));');
    expect(studio).toContain('<Animated.Text style={[styles.enterButtonLabelBase, pillContentStyle]}>');
    expect(studio).toContain('<Animated.Text style={[styles.enterButtonLabelFilled, pillContentStyle]}');
  });
});

describe('Studio auto-enter: re-touching always re-arms a fresh countdown, cancelled never carries over', () => {
  it('cardAreaPan.onBegin resets enterState to hidden immediately, before axis/lock is even decided', () => {
    const panBlock = studio.slice(studio.indexOf('const cardAreaPan ='), studio.indexOf('const tapGesture ='));
    const beginBlock = panBlock.slice(panBlock.indexOf('.onBegin(() => {'), panBlock.indexOf('.onUpdate('));
    expect(beginBlock).toContain("runOnJS(setEnterState)('hidden');");
  });

  it('the header/handle dismiss gesture also resets enterState on its own onStart', () => {
    const dismissBlock = studio.slice(studio.indexOf('const dismissGesture ='), studio.indexOf('const cardAreaPan ='));
    const onStartBlock = dismissBlock.slice(dismissBlock.indexOf('.onStart(() => {'), dismissBlock.indexOf('.onUpdate('));
    expect(onStartBlock).toContain("runOnJS(setEnterState)('hidden');");
  });

  it('a fresh open resets enterState to hidden alongside the rest of the carousel state', () => {
    const resetBlock = studio.slice(studio.indexOf('if (open) {', studio.indexOf('useEffect(() => {\n    // Reset to the first card')), studio.indexOf('setCardIndexJS(0);'));
    expect(resetBlock).toContain("setEnterState('hidden');");
  });
});
