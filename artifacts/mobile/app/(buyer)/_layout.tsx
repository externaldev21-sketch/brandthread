import React, { useCallback, useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';

import { useColors } from '@/hooks/useColors';
import { getDeactivationStatus, reactivate } from '@/lib/accountService';
import { BuyerSearchProvider } from '@/contexts/BuyerSearchContext';
import { BuyerTabBar } from '@/components/buyer-nav/BuyerTabBar';
import { getConversations, getNotifications, subscribeSocial } from '@/services/socialService';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { useApi } from '@/lib/api';
import { CheckInSheet } from '@/components/thread-cash/CheckInSheet';
import type { ThreadCashCheckInResult } from '@/lib/threadCashTypes';

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
        // Scenes glide a little sideways as they cross-fade, in the direction
        // of the tab tapped, so switching tabs feels spatial rather than a cut.
        animation: 'shift',
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

// ─── Thread Cash daily check-in ─────────────────────────────────────────────
// On the first buyer-tab-layout mount each buyer-local day, silently claim
// today's check-in and show the streak sheet if it was actually awarded
// (never re-shows for an already-claimed day, even across app restarts).

const CHECK_IN_SHOWN_KEY = 'bt:thread-cash:last-shown-checkin:v1';

function useDailyThreadCashCheckIn() {
  const { userId } = useAuth();
  const api = useApi();
  const threadCashEnabled = useFeatureFlag('threadCash');
  const [checkInResult, setCheckInResult] = useState<ThreadCashCheckInResult | null>(null);

  useEffect(() => {
    if (!threadCashEnabled || !userId) return;
    let active = true;
    void (async () => {
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const result = await api.threadCash.checkIn({ timezone });
        if (!active) return;
        const shownKey = `${CHECK_IN_SHOWN_KEY}:${userId}`;
        const alreadyShownDate = await AsyncStorage.getItem(shownKey);
        if (alreadyShownDate === result.streak.lastCheckInDate) return;
        await AsyncStorage.setItem(shownKey, result.streak.lastCheckInDate ?? '');
        setCheckInResult(result);
      } catch {
        // Already checked in today (409), offline, or a transient error —
        // never block or interrupt app open for this.
      }
    })();
    return () => { active = false; };
  }, [api, threadCashEnabled, userId]);

  return { checkInResult, dismiss: () => setCheckInResult(null) };
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function BuyerLayout() {
  const { checkInResult, dismiss } = useDailyThreadCashCheckIn();

  useEffect(() => {
    getDeactivationStatus().then(status => {
      if (status?.active) reactivate();
    });
  }, []);

  return (
    <BuyerSearchProvider>
      <BuyerTabLayout />
      <CheckInSheet visible={checkInResult != null} result={checkInResult} onClose={dismiss} />
    </BuyerSearchProvider>
  );
}
