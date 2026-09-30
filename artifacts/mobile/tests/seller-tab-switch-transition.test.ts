import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

/**
 * Seller tab switching used to be an instant, motion-free swap
 * (`app/(tabs)/_layout.tsx` set `animation: 'none'`, and
 * `SellerGlobalTabBar` called `router.replace()`, which never runs React
 * Navigation's transitionSpec even if one is configured). This locks in the
 * fix: both the buyer and seller tab layouts drive the same directional
 * slide from lib/tabSlideTransition.ts, and the seller tab bar uses
 * `navigate()` so the seller (tabs) navigator actually sees the focus
 * change needed to run it.
 */
describe('seller tab switch transition', () => {
  const sellerLayout = read('app/(tabs)/_layout.tsx');
  const buyerLayout = read('app/(buyer)/_layout.tsx');
  const tabBar = read('components/SellerGlobalTabBar.tsx');
  const shared = read('lib/tabSlideTransition.ts');

  it('no longer disables tab-switch animation on the seller layout', () => {
    expect(sellerLayout).not.toContain("animation: 'none'");
    expect(sellerLayout).not.toContain('Same instant tab switch');
  });

  it('drives the seller tab layout with the shared directional-slide transitionSpec', () => {
    expect(sellerLayout).toContain("from '@/lib/tabSlideTransition'");
    expect(sellerLayout).toContain('transitionSpec: reduceMotion ? REDUCED_MOTION_TRANSITION_SPEC : SLIDE_TRANSITION_SPEC');
    expect(sellerLayout).toContain('sceneStyleInterpolator: reduceMotion ? forReducedMotionCrossfade : forDirectionalSlide(width, settled.value)');
  });

  it('buyer and seller tab layouts share the exact same transition module (can’t drift apart)', () => {
    expect(buyerLayout).toContain("from '@/lib/tabSlideTransition'");
    expect(buyerLayout).toContain('SLIDE_TRANSITION_SPEC');
    expect(buyerLayout).toContain('forDirectionalSlide');
  });

  it('the shared module is a fast, snappy, no-bounce ease-out — 280ms timing, not a spring', () => {
    expect(shared).toContain('const SLIDE_DURATION = 280');
    expect(shared).toContain("animation: 'timing'");
    expect(shared).toContain('Easing.bezier(0.2, 0.8, 0.2, 1)');
    expect(shared).not.toContain('withSpring');
  });

  it('respects reduced motion with a plain crossfade instead of a positional slide', () => {
    expect(shared).toContain('forReducedMotionCrossfade');
    expect(shared).toContain('REDUCED_MOTION_TRANSITION_SPEC');
  });

  it('the seller tab bar uses navigate(), not replace(), so this navigator sees a real focus change', () => {
    expect(tabBar).toContain('router.navigate(tabDef.destination as never)');
    expect(tabBar).not.toContain('router.replace(tabDef.destination as never)');
  });

  it('the tab bar pill indicator starts gliding on press-in, before the screen swap, so it stays in sync', () => {
    expect(tabBar).toContain('onPressIn={() => pressIndicator(index)}');
  });

  it('keeps every tab mounted across a switch — a pure visual transition, never a remount', () => {
    expect(sellerLayout).toContain('detachInactiveScreens={false}');
    expect(sellerLayout).toContain('freezeOnBlur: true');
  });
});

/**
 * Live verification (a real device/preview session, not just this harness)
 * caught the seller profile tab rendering shifted right by a varying amount
 * on every load, never settling. Root cause: the tab layout's `settled`
 * flag flips off a FIXED 280ms timer (app/(tabs)/_layout.tsx), not a real
 * "animation finished" callback — React Navigation's bottom-tabs gives a
 * plain sceneStyleInterpolator no such callback. On a heavier screen (the
 * profile tab's video header/avatar/grid) or under load, the JS-driven
 * fallback animation (native driver isn't supported on web) can still be
 * mid-flight when that timer fires; reading `current.progress` at that
 * moment used to bake the CURRENT (fractional, non-deterministic) value
 * into a permanent transform that never corrected itself afterward.
 */
describe('forDirectionalSlide never freezes a settled scene at a fractional, off-target position', () => {
  const shared = read('lib/tabSlideTransition.ts');

  it('rounds the settled progress value to its nearest rest position (-1, 0, or 1) before using it', () => {
    expect(shared).toContain('const restPosition = Math.round(currentValue(current.progress));');
    expect(shared).toContain('const translateX = restPosition * width;');
    // The old, buggy line this replaced — must not still be present.
    expect(shared).not.toContain('const translateX = currentValue(current.progress) * width;');
  });

  it("the unsettled (live) branch is untouched — only the settled snapshot's read was rounded", () => {
    const unsettledBranch = shared.slice(shared.indexOf('return {\n      sceneStyle: {\n        transform: [{'));
    expect(unsettledBranch).toContain('current.progress.interpolate({');
    expect(unsettledBranch).not.toContain('Math.round');
  });
});

/**
 * The clipped press-highlight bug ("the transparency of the button is cut
 * off on each side"): mobile browsers draw their own translucent
 * tap-highlight rectangle on every pressed element, which doesn't share a
 * pill/circle control's own border-radius and gets clipped unevenly by any
 * sibling overflow:hidden decoration (the tab bar capsule's glass layer,
 * a tight profile-tab cell, a segmented control's track). Fixed globally
 * with one CSS reset rather than patched per-component, since every
 * pressable already draws its own custom press feedback.
 */
describe('no clipped browser tap-highlight on press', () => {
  it('resets -webkit-tap-highlight-color globally in the web shell', () => {
    const html = read('app/+html.tsx');
    expect(html).toContain('-webkit-tap-highlight-color: transparent;');
  });

  it('gives the seller and buyer tab bar buttons a real, fixed-diameter, uncut press highlight', () => {
    const parts = read('components/tab-bar/TabBarParts.tsx');
    expect(parts).toContain('const PRESS_HIGHLIGHT_SIZE = 40');
    expect(parts).toContain('pressHighlight:');
    expect(parts).toContain('highlightStyle');
  });
});

/**
 * Dev correction: the profile content tabs (grid/bag/tag on seller,
 * grid/bookmark/heart/cube on buyer) must NEVER show a translucent
 * background/pill/circle on press or when selected — only the short
 * underline (see the TikTok-tabs work above) marks selection, and a plain
 * icon opacity/scale dim (PressableScale's own built-in press feedback,
 * ripple off) is the only press feedback. This is the opposite of the tab
 * bar buttons above, which DO want a real, uncut circular highlight — the
 * two must not be conflated.
 */
describe('profile content tabs have no press/active background', () => {
  const controls = read('components/profile/ProfileControls.tsx');

  it('never renders InteractionLayer (or any other fill) behind an icon-only tab', () => {
    expect(controls).toContain('{iconOnly ? null : <InteractionLayer state={state as PressState} radius={RADIUS.sm} theme={theme} />}');
  });

  it('disables PressableScale\'s ripple on icon-only tabs (a ripple is a background fill too)', () => {
    expect(controls).toContain('rippleEnabled={!iconOnly}');
  });
});

/**
 * Follow-up from the blurry-text sweep (#415): the tab-slide's own
 * full-screen wrapper (this file's `forDirectionalSlide`) left a permanent
 * identity `transform: matrix(1,0,0,1,0,0)` on the resting, focused screen
 * once a tab switch finished — the same class of bug #415 fixed for
 * PressableScale, just for this screen-level wrapper instead of a button.
 * Fixed with the same `useSettled` convention from lib/animationUtils.ts:
 * the tab layouts unsettle synchronously (during render, not in an effect —
 * see the layout files' own comments for why) on every route change, then
 * settle again once the known transition duration elapses, at which point
 * `forDirectionalSlide`'s `settled` branch drops the `transform` key
 * entirely for the identity (focused, on-screen) case.
 */
describe('tab-slide transform drops to none once settled (blurry-text follow-up)', () => {
  const sellerLayout = read('app/(tabs)/_layout.tsx');
  const buyerLayout = read('app/(buyer)/_layout.tsx');
  const shared = read('lib/tabSlideTransition.ts');

  it('forDirectionalSlide accepts a settled flag and drops the transform key at identity', () => {
    expect(shared).toContain('export function forDirectionalSlide(width: number, settled = false)');
    expect(shared).toContain("import { isIdentityTransform } from '@/lib/animationUtils'");
    expect(shared).toContain('isIdentityTransform([{ translateX }])');
    expect(shared).toContain('return { sceneStyle: transform ? { transform } : {} };');
  });

  it('exports the slide durations so the layouts can time their own settle timeout exactly', () => {
    expect(shared).toContain('export const SLIDE_DURATION = 280');
    expect(shared).toContain('export const REDUCED_MOTION_SLIDE_DURATION = 150');
  });

  for (const [name, layout] of [['seller', sellerLayout], ['buyer', buyerLayout]] as const) {
    it(`${name} tab layout drives forDirectionalSlide with useSettled's settled.value`, () => {
      expect(layout).toContain("from '@/lib/animationUtils'");
      expect(layout).toContain('useSettled(true)');
      expect(layout).toContain('forDirectionalSlide(width, settled.value)');
    });

    it(`${name} tab layout unsettles synchronously during render on a route change, not in an effect`, () => {
      expect(layout).toContain('if (prevPathnameRef.current !== pathname) {');
      expect(layout).toContain('settled.unsettle();');
    });

    it(`${name} tab layout re-settles after the known transition duration`, () => {
      expect(layout).toContain('settled.settleImmediately()');
      expect(layout).toContain('reduceMotion ? REDUCED_MOTION_SLIDE_DURATION : SLIDE_DURATION');
    });
  }
});
