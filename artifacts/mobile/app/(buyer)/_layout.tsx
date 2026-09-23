import React, { useCallback, useEffect, useState } from 'react';
import { Tabs } from 'expo-router';

import { useColors } from '@/hooks/useColors';
import { getDeactivationStatus, reactivate } from '@/lib/accountService';
import { BuyerSearchProvider } from '@/contexts/BuyerSearchContext';
import { BuyerTabBar } from '@/components/buyer-nav/BuyerTabBar';
import { getConversations, getNotifications, subscribeSocial } from '@/services/socialService';

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
      detachInactiveScreens
      tabBar={(props) => <BuyerTabBar {...props} inboxBadgeCount={inboxBadgeCount} />}
      screenOptions={{
        freezeOnBlur: true,
        headerShown: false,
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
    </BuyerSearchProvider>
  );
}
