import React, { useCallback, useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { Animated, Easing, useWindowDimensions } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useColors } from '@/hooks/useColors';
import { getDeactivationStatus, reactivate } from '@/lib/accountService';
import { BuyerTabBar } from '@/components/buyer-nav/BuyerTabBar';
import { TabScreenErrorFallback } from '@/components/ErrorBoundary';
import { getConversations, getNotifications, subscribeSocial } from '@/services/socialService';
import { ThreadCashActiveTimeTracker } from '@/components/thread-cash/ThreadCashActiveTimeTracker';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { getPreviewConversations, getPreviewNotifications } from '@/lib/previewInbox';

// ─── Tab switch transition ──────────────────────────────────────────────────
// Instagram/TikTok-style directional slide: the incoming tab slides in from
// the side of the tab bar it was tapped from, the outgoing one slides out
// the other way. `current.progress` (from React Navigation's bottom-tabs)
// is -1/0/1 based on the tapped screen's REGISTRATION index relative to the
// active one — see the Tabs.Screen order below, which is deliberately kept
// in the same left-to-right order as the capsule (Home, Discover, Inbox,
// Activity, Profile) so that order, not just tab-bar visual position, is
// what decides slide direction.
const SLIDE_DURATION = 280;
// cubic-bezier(0.2, 0.8, 0.2, 1): ease-out, no bounce/overshoot.
const SLIDE_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

const SLIDE_TRANSITION_SPEC = {
  animation: 'timing' as const,
  config: { duration: SLIDE_DURATION, easing: SLIDE_EASING },
};

const REDUCED_MOTION_TRANSITION_SPEC = {
  animation: 'timing' as const,
  config: { duration: 150, easing: Easing.linear },
};

function forDirectionalSlide(width: number) {
  return ({ current }: { current: { progress: Animated.Value } }) => ({
    sceneStyle: {
      transform: [{
        translateX: current.progress.interpolate({
          inputRange: [-1, 0, 1],
          outputRange: [-width, 0, width],
        }),
      }],
    },
  });
}

// Reduced-motion fallback: a plain crossfade, no positional movement at all.
function forReducedMotionCrossfade({ current }: { current: { progress: Animated.Value } }) {
  return {
    sceneStyle: {
      opacity: current.progress.interpolate({
        inputRange: [-1, 0, 1],
        outputRange: [0, 1, 0],
      }),
    },
  };
}

// ─── Buyer tab layout ─────────────────────────────────────────────────────────
// Floating capsule: Home · Discover · Inbox · Search, plus a separate Profile
// circle that turns into Close while search is open. The bar is drawn over the
// scenes, so every screen pads its content with useBuyerTabBarInset().
// Friends, Cart, Orders, Following and Edit Profile are routes in this
// navigator (so the bar stays on screen) but have no slot of their own.

function BuyerTabLayout() {
  const colors = useColors();
  const [inboxBadgeCount, setInboxBadgeCount] = useState(0);
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const loadBadgeCount = useCallback(async () => {
    try {
      // Dev-web preview: no real backend/account, so route through the same
      // demo-gated preview data the Inbox screen itself renders
      // (lib/previewInbox.ts) instead of calling the real API — otherwise a
      // reachable dev/staging backend answering with unrelated real rows
      // (or the real endpoint simply not existing yet) puts a stray number
      // on a fresh, zero-state preview account's tab bar.
      const [conversations, notifications] = isBuyerDevPreview()
        ? [getPreviewConversations(), getPreviewNotifications()]
        : await Promise.all([getConversations(), getNotifications()]);
      const unreadMessages = conversations.reduce(
        (sum, conv) => sum + (conv.unreadCount ?? 0), 0,
      );
      const unreadNotifications = notifications.filter(
        n => !n.isRead && !n.isMuted,
      ).length;
      setInboxBadgeCount(unreadMessages + unreadNotifications);
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
        sceneStyleInterpolator: reduceMotion ? forReducedMotionCrossfade : forDirectionalSlide(width),
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
