/**
 * App-wide "screen chrome" guards — the two layout rules Dev set for every
 * screen, enforced once here instead of per screen:
 *
 *  1. Nothing ever renders under the notch / Dynamic Island / status bar.
 *     <StatusBarMask /> is a solid strip (the screen's own background, no
 *     translucency) pinned over the top safe inset, above every stack
 *     scene. Scroll content that moves up the screen now disappears under
 *     the strip instead of sliding under the status bar (Dev's seller-
 *     profile screenshot: avatar / "+" badge / stats under the island).
 *     Genuinely immersive full-bleed media screens (camera, live, story and
 *     post viewers, the video feeds) and the auth/onboarding flow keep
 *     their edge-to-edge media — see isImmersiveTopRoute().
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
import { StyleSheet, View } from 'react-native';
import { useSegments } from 'expo-router';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useTabBarClearance } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useTabBarHiddenByScreen } from '@/lib/tabBarVisibility';

/** Root-stack routes whose content is deliberately edge-to-edge media
 *  (camera, live, story/post viewers) or that run before there is an app
 *  shell at all (boot, auth, onboarding). The status-bar mask stays off
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

/** Height of the masked strip: the same top inset every header pads by
 *  (useHeaderTopInset — the real safe-area top on device, the simulated
 *  notch on the web preview), so a header's own content always starts
 *  exactly at the strip's bottom edge and is never covered. */
export function useStatusBarMaskHeight(): number {
  return useHeaderTopInset();
}

/**
 * The solid status-bar strip. Rendered once, above the root stack, in
 * app/_layout.tsx. pointerEvents "auto" on purpose: nothing under the
 * status bar should be tappable either.
 */
export function StatusBarMask() {
  const { theme } = useAppTheme();
  const segments = useSegments() as string[];
  const height = useStatusBarMaskHeight();
  if (height <= 0 || isImmersiveTopRoute(segments)) return null;
  return (
    <View
      testID="status-bar-mask"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.mask, { height, backgroundColor: theme.background }]}
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
  mask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Above every stack scene and its in-screen overlays; below the app's
    // own top banners, sheets and the Studio page (all Modals / later
    // siblings with higher zIndex).
    zIndex: 900,
    elevation: 900,
  },
});
