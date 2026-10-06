import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Tabs, usePathname } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useColors } from '@/hooks/useColors';
import { useSettled } from '@/lib/animationUtils';
import { getDeactivationStatus, reactivate } from '@/lib/accountService';
import { BuyerTabBar } from '@/components/buyer-nav/BuyerTabBar';
import { TabScreenErrorFallback } from '@/components/ErrorBoundary';
import { getConversations, subscribeSocial } from '@/services/socialService';
import { ThreadCashActiveTimeTracker } from '@/components/thread-cash/ThreadCashActiveTimeTracker';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { getPreviewConversations } from '@/lib/previewInbox';
import { useCommunityBadgeCount } from '@/lib/communities/useCommunityInbox';
// Instagram/TikTok-style directional slide — shared with the seller tab
// layout (app/(tabs)/_layout.tsx) so both sides use the same duration/
// easing. `current.progress` (from React Navigation's bottom-tabs) is
// -1/0/1 based on the tapped screen's REGISTRATION index relative to the
// active one — see the Tabs.Screen order below, which is deliberately kept
// in the same left-to-right order as the capsule (Home, Discover, Inbox,
// Activity, Profile) so that order, not just tab-bar visual position, is
// what decides slide direction.
import {
  SLIDE_TRANSITION_SPEC, REDUCED_MOTION_TRANSITION_SPEC, SLIDE_DURATION, REDUCED_MOTION_SLIDE_DURATION,
  forDirectionalSlide, forReducedMotionCrossfade,
} from '@/lib/tabSlideTransition';

// ─── Buyer tab layout ─────────────────────────────────────────────────────────
// Floating capsule: Home · Discover · Inbox · Search, plus a separate Profile
// circle that turns into Close while search is open. The bar is drawn over the
// scenes, so every screen pads its content with useBuyerTabBarInset().
// Friends, Cart, Orders, Following and Edit Profile are routes in this
// navigator (so the bar stays on screen) but have no slot of their own.

function BuyerTabLayout() {
  const colors = useColors();
  const [dmBadgeCount, setDmBadgeCount] = useState(0);
  // Muted communities contribute nothing; a muted-only unread never lights the tab.
  const communityBadgeCount = useCommunityBadgeCount();
  const inboxBadgeCount = dmBadgeCount + communityBadgeCount;
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // Blurry-text fix: drop the slide's `transform` once a tab switch has
  // settled, so the resting (focused) screen's full-screen wrapper carries
  // no transform at all instead of a permanent identity matrix — see
  // forDirectionalSlide's `settled` param in lib/tabSlideTransition.ts and
  // lib/animationUtils.ts's useSettled/identityOrNone doc. Starts settled
  // (true) since nothing has switched yet on mount. Same pattern as the
  // seller tab layout (app/(tabs)/_layout.tsx) — kept in sync there too.
  const pathname = usePathname();
  const settled = useSettled(true);
  const prevPathnameRef = useRef(pathname);
  if (prevPathnameRef.current !== pathname) {
    // Unsettle synchronously during render (not in an effect) so this
    // render's sceneStyleInterpolator already wires up the live animated
    // interpolation before the Tabs navigator's own effect starts the
    // transitionSpec animation — an effect-based unsettle would race that.
    prevPathnameRef.current = pathname;
    settled.unsettle();
  }
  useEffect(() => {
    if (settled.value) return;
    const duration = reduceMotion ? REDUCED_MOTION_SLIDE_DURATION : SLIDE_DURATION;
    const timer = setTimeout(() => settled.settleImmediately(), duration);
    return () => clearTimeout(timer);
  }, [settled.value, settled.settleImmediately, reduceMotion]);

  const loadBadgeCount = useCallback(async () => {
    try {
      // Dev-web preview: no real backend/account, so route through the same
      // demo-gated preview data the Inbox screen itself renders
      // (lib/previewInbox.ts) instead of calling the real API — otherwise a
      // reachable dev/staging backend answering with unrelated real rows
      // (or the real endpoint simply not existing yet) puts a stray number
      // on a fresh, zero-state preview account's tab bar.
      // The Messages tab counts unread messages only. Activity rows have
      // their own badge on the bell tab (useActivityUnreadCount); adding
      // them here counted every DM twice (its unread count + its "New
      // message" Activity row) and showed likes/follows as unread messages.
      const conversations = isBuyerDevPreview()
        ? getPreviewConversations()
        : await getConversations();
      const unreadMessages = conversations.reduce(
        (sum, conv) => sum + (conv.unreadCount ?? 0), 0,
      );
      setDmBadgeCount(unreadMessages);
    } catch {
      // Badges are non-critical.
    }
  }, []);

  useEffect(() => {
    void loadBadgeCount();
    const unsubscribe = subscribeSocial(() => { void loadBadgeCount(); });
    const timer = setInterval(() => { void loadBadgeCount(); }, 30_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [loadBadgeCount]);

  return (
    <Tabs
      // false keeps every tab's native view attached to the hierarchy at all
      // times instead of tearing it down and re-creating it on each revisit.
      // Combined with freezeOnBlur (state/JS stays mounted too), a tab switch
      // is a pure "hide this view, show that one" — no remount, no re-layout,
      // no re-fetch, which is what was producing the ~half-second reload
      // feeling on every tab tap. The memory cost is 5 always-attached
      // screens, which is cheap next to eliminating that reload.
      detachInactiveScreens={false}
      tabBar={(props) => <BuyerTabBar {...props} inboxBadgeCount={inboxBadgeCount} />}
      // A render crash in one tab shows a friendly per-tab fallback instead
      // of taking down the whole app; the root layout's ErrorBoundary is
      // still the last-resort catch-all above this.
      unstable_screenErrorBoundary={TabScreenErrorFallback}
      screenOptions={{
        freezeOnBlur: true,
        headerShown: false,
        // Directional slide between tabs (Instagram/TikTok-style): driven by
        // transitionSpec + sceneStyleInterpolator rather than the 'shift'/
        // 'fade' presets so the distance is a full screen width and the
        // easing/duration match this round's spec exactly. `animation` is
        // deliberately left unset — React Navigation's bottom-tabs enables
        // per-frame animation whenever a transitionSpec is present, and
        // leaving it out (rather than 'none') is what makes that so. Each
        // tab keeps its own mounted state/scroll position throughout (see
        // detachInactiveScreens/freezeOnBlur below), so this is purely a
        // visual transition, not a remount.
        transitionSpec: reduceMotion ? REDUCED_MOTION_TRANSITION_SPEC : SLIDE_TRANSITION_SPEC,
        sceneStyleInterpolator: reduceMotion ? forReducedMotionCrossfade : forDirectionalSlide(width, settled.value),
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {/* Registration order matters here, not just for the capsule's visual
          layout: React Navigation's bottom-tabs derives each screen's slide
          direction from this order relative to the active tab (see
          forDirectionalSlide above), so this list is kept in the exact same
          left-to-right order as the capsule + Profile circle (Home,
          Discover, Inbox, Activity, Profile) rather than grouping Profile
          with the other top-level screens the way BUYER_TAB_ITEMS itself
          doesn't need to. */}
      {/* Home — seller videos with product tagging, likes, comments, purchase */}
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarAccessibilityLabel: 'Home tab' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarAccessibilityLabel: 'Discover tab' }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarAccessibilityLabel: 'Inbox tab' }} />
      {/* Has its own bar slot (the bell), but like the rest of this group it's
          reached by navigating within this navigator, not by pushing the
          root-level /activity-center route — that's what keeps the floating
          tab bar mounted and lit up on Activity instead of disappearing. */}
      <Tabs.Screen name="activity" options={{ title: 'Activity', href: null }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarAccessibilityLabel: 'Profile tab' }} />

      {/* No slot of their own — reached from Home, Profile or Inbox. */}
      <Tabs.Screen name="friends" options={{ title: 'Friends', href: null }} />
      <Tabs.Screen name="cart" options={{ title: 'Cart', href: null }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders', href: null }} />
      <Tabs.Screen name="following" options={{ title: 'Following', href: null }} />
      <Tabs.Screen name="edit-profile" options={{ title: 'Edit profile', href: null }} />
      {/* feed re-export kept for deep-link compatibility; Home is the index */}
      <Tabs.Screen name="feed" options={{ title: 'Home', href: null }} />
    </Tabs>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function BuyerLayout() {
  useEffect(() => {
    getDeactivationStatus().then(status => {
      if (status?.active) reactivate();
    });
  }, []);

  return (
    <>
      <BuyerTabLayout />
      {/* Daily Thread Cash reward: silent active-time tracker, no UI of its
          own — see ThreadCashActiveTimeTracker for the 7-minute trigger and
          CelebrationHost for the money-burst it plays on a successful claim. */}
      <ThreadCashActiveTimeTracker />
    </>
  );
}
