import React, { useCallback, useEffect, useState } from 'react';
import { Tabs } from 'expo-router';

import { useColors } from '@/hooks/useColors';
import { getDeactivationStatus, reactivate } from '@/lib/accountService';
import { BuyerSearchProvider } from '@/contexts/BuyerSearchContext';
import { BuyerTabBar } from '@/components/buyer-nav/BuyerTabBar';
import { TabScreenErrorFallback } from '@/components/ErrorBoundary';
import { getConversations, getNotifications, subscribeSocial } from '@/services/socialService';
import { ThreadCashActiveTimeTracker } from '@/components/thread-cash/ThreadCashActiveTimeTracker';

// ─── Buyer tab layout ─────────────────────────────────────────────────────────
// Floating capsule: Home · Discover · Inbox · Search, plus a separate Profile
// circle that turns into Close while search is open. The bar is drawn over the
// scenes, so every screen pads its content with useBuyerTabBarInset().
// Friends, Cart, Orders, Following and Edit Profile are routes in this
// navigator (so the bar stays on screen) but have no slot of their own.

function BuyerTabLayout() {
  const colors = useColors();
  const [inboxBadgeCount, setInboxBadgeCount] = useState(0);

  const loadBadgeCount = useCallback(async () => {
    try {
      const [conversations, notifications] = await Promise.all([
        getConversations(),
        getNotifications(),
      ]);
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
        // No transition: the previous tab bar animation ('shift') added a
        // sideways glide on every tab tap, which is exactly the perceptible
        // delay the tab bar should never have now that switching is just a
        // visibility flip between already-mounted, already-fetched screens.
        animation: 'none',
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {/* Home — seller videos with product tagging, likes, comments, purchase */}
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarAccessibilityLabel: 'Home tab' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarAccessibilityLabel: 'Discover tab' }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarAccessibilityLabel: 'Inbox tab' }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarAccessibilityLabel: 'Search tab' }} />
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
    <BuyerSearchProvider>
      <BuyerTabLayout />
      {/* Daily Thread Cash reward: silent active-time tracker, no UI of its
          own — see ThreadCashActiveTimeTracker for the 7-minute trigger and
          CelebrationHost for the money-burst it plays on a successful claim. */}
      <ThreadCashActiveTimeTracker />
    </BuyerSearchProvider>
  );
}
