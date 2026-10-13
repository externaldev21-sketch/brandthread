/**
 * App-wide "screen chrome" guards — the two layout rules Dev set for every
 * screen, enforced once here instead of per screen:
 *
 *  1. The status bar stays readable without a hard edge. There is no solid
 *     strip pinned under the status bar any more: on a pull-down/overscroll
 *     the screen's own content and background stretch and bounce like any
 *     native iOS screen, and when content scrolls up under the clock
 *     <StatusBarScrollEdge /> fades it out, a short gradient from the screen
 *     background to transparent (the iOS scroll-edge effect). It never takes
 *     touches and never draws a line. At rest and during a pull-down it sits
 *     over the screen's own background, so it is invisible. Genuinely
 *     immersive full-bleed media screens (camera, live, story and post
 *     viewers, the video feeds) and the auth/onboarding flow get no fade —
 *     see isImmersiveTopRoute(). Sticky headers keep their own background
 *     through the safe area (they pad by useHeaderTopInset()).
 *
 *     It replaced <StatusBarMask />, a solid strip in the screen colour.
 *     Its hard bottom edge showed as a black bar on pull-down and, at the
 *     right scroll offset, cut a header's 1px border down to a thin line
 *     under the clock (Dev's Discover report).
 *
 *  2. Nothing ever sits under or behind the floating tab bar.
 *     useTabBarClearance() (components/buyer-nav/buyerTabBarMetrics.ts) is
 *     the one number every scroll container uses: tab bar height + bottom
 *     safe inset + 16. Tab screens pad their scroll content with it; every
 *     PUSHED seller screen the seller bar floats over gets it applied once,
 *     at the stack-scene level (useSceneBottomClearance, used by
 *     app/_layout.tsx's IsolatedStackScene), so its content area — scroll
 *     views, sticky footers and absolutely-positioned bottom bars alike —
 *     ends above the bar without touching each of those screens.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { useSegments } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useTabBarClearance } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useTabBarHiddenByScreen } from '@/lib/tabBarVisibility';
import { hexToRgba } from '@/lib/backgroundPalette';

/** Root-stack routes whose content is deliberately edge-to-edge media
 *  (camera, live, story/post viewers) or that run before there is an app
 *  shell at all (boot, auth, onboarding). The scroll-edge fade stays off
 *  there. Everything else gets it. */
const IMMERSIVE_TOP_ROOT_SEGMENTS = new Set([
  // Boot / auth / onboarding
  '', 'index', 'splash', 'sign-in', 'forgot-password', 'onboarding', 'thread-explainer',
  'account-type', 'manufacturer-onboard',
  // Camera / creation
  'camera-capture', 'create-post', 'buyer-story-create', 'design-canvas',
  // Live
  'live', 'live-feed', 'buyer-live', 'seller-live', 'seller-go-live',
  // Full-screen media viewers
  'buyer-story-viewer', 'story-mention-viewer', 'buyer-post-viewer', 'profile-videos',
]);
/** Nested tab routes that are full-bleed video feeds. */
const IMMERSIVE_TOP_NESTED = new Set(['(buyer)/feed', '(buyer)/discover-feed', '(tabs)/feed']);

export function isImmersiveTopRoute(segments: readonly string[]): boolean {
  const first = segments[0] ?? '';
  if (IMMERSIVE_TOP_ROOT_SEGMENTS.has(first)) return true;
  if ((first === '(buyer)' || first === '(tabs)') && segments.length >= 2) {
    return IMMERSIVE_TOP_NESTED.has(`${first}/${segments[1]}`);
  }
  // The buyer group's index is its feed.
  if (first === '(buyer)' && segments.length === 1) return true;
  return false;
}

/** Height of the fade: the same top inset every header pads by
 *  (useHeaderTopInset — the real safe-area top on device, the simulated
 *  notch on the web preview, already rounded to whole device pixels), so
 *  it covers exactly the status bar and ends where a header's own content
 *  begins. */
export function useStatusBarScrollEdgeHeight(): number {
  return useHeaderTopInset();
}

/** Opaque enough at the very top for the clock and battery to stay
 *  readable over scrolling content, clear by the bottom of the status bar. */
const FADE_STOPS = [1, 0.8, 0] as const;
const FADE_LOCATIONS = [0, 0.6, 1] as const;

function fadeColors(background: string): [string, string, string] {
  if (!/^#[0-9a-f]{6}$/i.test(background)) return [background, background, 'transparent'];
  return [hexToRgba(background, FADE_STOPS[0]), hexToRgba(background, FADE_STOPS[1]), hexToRgba(background, FADE_STOPS[2])];
}

/**
 * The status-bar scroll-edge fade. Rendered once, above the root stack, in
 * app/_layout.tsx. pointerEvents "none": it is purely visual.
 */
export function StatusBarScrollEdge() {
  const { theme } = useAppTheme();
  const segments = useSegments() as string[];
  const height = useStatusBarScrollEdgeHeight();
  if (height <= 0 || isImmersiveTopRoute(segments)) return null;
  return (
    <LinearGradient
      testID="status-bar-scroll-edge"
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      colors={fadeColors(theme.background)}
      locations={[...FADE_LOCATIONS]}
      style={[styles.fade, { height }]}
    />
  );
}

/**
 * Bottom margin for a pushed stack scene the seller tab bar floats over.
 * `active` is the caller's "does the seller bar float over this route"
 * decision (seller session, not a tab-group route, not a full-screen /
 * modal-presented route); this adds the one thing the caller can't know —
 * whether the focused screen has hidden the bar (useHideTabBar, e.g. a
 * chat composer) — and returns the shared clearance, else 0.
 */
export function useSceneBottomClearance(active: boolean): number {
  const hiddenByScreen = useTabBarHiddenByScreen();
  const clearance = useTabBarClearance(2); // seller bar: Studio + AI side circles
  return active && !hiddenByScreen ? clearance : 0;
}

const styles = StyleSheet.create({
  fade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Above every stack scene; below the app's own top banners, sheets and
    // the Studio page (all Modals / later siblings with higher zIndex).
    zIndex: 900,
    elevation: 900,
  },
});
