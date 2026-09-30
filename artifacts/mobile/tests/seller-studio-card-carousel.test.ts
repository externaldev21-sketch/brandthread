import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8');
const studio = read('components/SellerStudioRadialMenu.tsx');
const rootLayout = read('app/_layout.tsx');
const overrideLib = read('lib/navigationAnimationOverride.ts');

/**
 * Studio sheet card carousel (Dev's words: "every icon is its own screen,
 * swipe across and feel boom boom boom, release on the one you want and it
 * opens"). Covers the parts that only make sense against the real component
 * source (gesture wiring, haptic-per-index-change, instant-navigation
 * plumbing) — the pure px-to-index scrub math itself is unit-tested
 * directly in lib/studioCardCarousel.test.ts.
 */
describe('Studio card carousel: horizontal scrub, vertical dismiss decided within ~10px', () => {
  // react-native-gesture-handler's web implementation (2.32.0) cannot
  // resolve a Gesture.Race between two Gesture.Pan instances — verified
  // live: a second Pan alongside another (Race sibling OR nested in a
  // separate GestureDetector) made both cancel immediately on any real
  // drag. So the card area uses ONE combined Pan that locks its own axis
  // manually, Raced against a Gesture.Tap for the near-zero-movement case
  // (a Pan never activates for a true 0px tap, so that still needs a real
  // Tap gesture). See lib/studioCardCarousel.ts for the shared px-to-index
  // math this Pan's onUpdate calls into.
  it('the card-area Pan locks its axis manually within AXIS_LOCK_PX of movement, in either direction', () => {
    const panBlock = studio.slice(studio.indexOf('const cardAreaPan ='), studio.indexOf('const tapGesture ='));
    expect(studio).toContain('const AXIS_LOCK_PX = 10;');
    expect(panBlock).toContain("Math.abs(e.translationX) > AXIS_LOCK_PX || Math.abs(e.translationY) > AXIS_LOCK_PX");
    expect(panBlock).toContain("cardGestureAxis.value = Math.abs(e.translationX) >= Math.abs(e.translationY) ? 'horizontal' : 'vertical'");
  });

  it('a locked-vertical release runs the same dismiss logic as the header/handle detector (shared runDismissEnd)', () => {
    const panBlock = studio.slice(studio.indexOf('const cardAreaPan ='), studio.indexOf('const tapGesture ='));
    expect(panBlock).toContain("if (cardGestureAxis.value === 'vertical') {\n        runDismissEnd(e);");
    expect(studio).toContain('const dismissGesture = useMemo(() => Gesture.Pan()');
    const dismissBlock = studio.slice(studio.indexOf('const dismissGesture ='), studio.indexOf('const cardAreaPan ='));
    expect(dismissBlock).toContain('runDismissEnd(e)');
  });

  it('composes the combined Pan and a Tap with Gesture.Race on the card area — never two Pans together', () => {
    expect(studio).toContain('Gesture.Race(cardAreaPan, tapGesture)');
  });

  it('a plain tap (near-zero movement) also resolves to opening the current card', () => {
    const tapBlock = studio.slice(studio.indexOf('const tapGesture ='), studio.indexOf('const cardAreaGesture ='));
    expect(tapBlock).toContain('.maxDistance(AXIS_LOCK_PX)');
    expect(tapBlock).toContain('runOnJS(openCurrentItem)()');
  });
});

describe('Studio card carousel: scrub uses the shared px-to-index math, one 90ms slide per step', () => {
  it('imports indexForDrag/CARD_SCRUB_STEP_PX from the pure lib module rather than reimplementing the math inline', () => {
    expect(studio).toContain("from '@/lib/studioCardCarousel'");
    expect(studio).toContain('indexForDrag(gestureStartIndex.value, e.translationX, CARD_ITEMS.length)');
  });

  it('animates each step over CARD_STEP_MS with a no-bounce easing (never a spring)', () => {
    expect(studio).toContain('const CARD_STEP_MS = 90;');
    expect(studio).toContain('const CARD_STEP_EASING = Easing.out(Easing.cubic);');
    expect(studio).not.toMatch(/cardIndex\.value\s*=\s*withSpring/);
  });

  it('captures the gesture-start index once, in onBegin, not re-read per frame', () => {
    const panBlock = studio.slice(studio.indexOf('const cardAreaPan ='), studio.indexOf('const tapGesture ='));
    expect(panBlock).toContain('gestureStartIndex.value = Math.round(cardIndex.value);');
  });
});

describe('Studio card carousel: one rate-limited haptic tick per card-index change', () => {
  it('reacts to the rounded cardIndex, firing only when it actually changes', () => {
    expect(studio).toContain('useAnimatedReaction(\n    () => Math.round(cardIndex.value),');
    expect(studio).toContain('if (rounded === previous) return;');
  });

  it('rate-limits the real haptic call by elapsed wall-clock time, independent of how many index changes the UI thread reports', () => {
    expect(studio).toContain('const MIN_HAPTIC_INTERVAL_MS = 45;');
    expect(studio).toContain('if (now - lastHapticAtRef.current < MIN_HAPTIC_INTERVAL_MS) return;');
  });

  it('does not fire a tick for the very first render (only on an actual change from a previous value)', () => {
    expect(studio).toContain('if (previous !== null) runOnJS(fireHapticTick)();');
  });
});

describe('Studio card carousel: release/tap opens instantly — no closing animation, no push animation', () => {
  it('commitAndOpen cancels any in-flight sheet animation and sets open=false directly, with no withTiming close', () => {
    const fnBody = studio.slice(studio.indexOf('const commitAndOpen = useCallback'), studio.indexOf('}, [translateY, backdropOpacity, planLoading'));
    expect(fnBody).toContain('cancelAnimation(translateY);');
    expect(fnBody).toContain('cancelAnimation(backdropOpacity);');
    expect(fnBody).toContain('setOpen(false);');
    expect(fnBody).not.toContain('withTiming');
  });

  it('sets a one-shot "no animation" override immediately before pushing', () => {
    expect(studio).toContain("import { setNextPushAnimationNone } from '@/lib/navigationAnimationOverride';");
    const fnBody = studio.slice(studio.indexOf('const commitAndOpen = useCallback'), studio.indexOf('}, [translateY, backdropOpacity, planLoading'));
    const setIdx = fnBody.indexOf('setNextPushAnimationNone();');
    const pushIdx = fnBody.indexOf('router.push(item.route as never);');
    expect(setIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(setIdx);
  });

  it('a Growth-gated, unpaid item shows the upsell modal instead of navigating, and never sets the animation override for that path', () => {
    const fnBody = studio.slice(studio.indexOf('const commitAndOpen = useCallback'), studio.indexOf('}, [translateY, backdropOpacity, planLoading'));
    const gateIdx = fnBody.indexOf('!hasPlan(\'growth\')');
    const upsellIdx = fnBody.indexOf('setUpsellFeature(item.label);');
    const returnIdx = fnBody.indexOf('return;', upsellIdx);
    const overrideIdx = fnBody.indexOf('setNextPushAnimationNone();');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(upsellIdx).toBeGreaterThan(gateIdx);
    expect(returnIdx).toBeGreaterThan(upsellIdx);
    expect(overrideIdx).toBeGreaterThan(returnIdx);
  });
});

/**
 * Expo Router has no native per-push "animation: none" — see
 * lib/navigationAnimationOverride.ts's own doc comment for why. Every
 * carousel destination's own Stack.Screen registration in app/_layout.tsx
 * has to opt into reading the one-shot override via a FUNCTION `options`
 * (re-evaluated per navigation), not the static object every other route
 * still uses.
 */
describe('navigation animation override plumbing', () => {
  it('is one-shot: set once, consumed (and cleared) on read, independent of a fallback default', () => {
    expect(overrideLib).toContain("let pendingOverride: 'none' | null = null;");
    expect(overrideLib).toContain('pendingOverride = null;');
    expect(overrideLib).toContain("return 'none';");
  });

  it('every carousel destination\'s Stack.Screen reads the override via a function options, not a static object', () => {
    const destinations = [
      'add-product', 'seller-go-live', 'payouts', 'community', 'taxes-duties',
      'content', 'finance', 'manufacturer-hub', 'design', 'design-mockup-to-model',
      'design-bg-removal', 'design-text-to-design', 'design-campaign',
      'design-ai-photoshoot', 'customer-accounts',
    ];
    destinations.forEach((name) => {
      const marker = `<Stack.Screen name="${name}" options={() => (`;
      expect(rootLayout, `${name} should use a function options reading consumeAnimationOverride`).toContain(marker);
    });
    // Every one of those destinations' animation key must route through the
    // override, not just carry a plain static string.
    const optionsBlocks = destinations.map((name) => {
      const start = rootLayout.indexOf(`<Stack.Screen name="${name}"`);
      const end = rootLayout.indexOf('/>', start);
      return rootLayout.slice(start, end);
    });
    optionsBlocks.forEach((block, i) => {
      expect(block, `${destinations[i]} should call consumeAnimationOverride`).toContain('consumeAnimationOverride(');
    });
  });
});
