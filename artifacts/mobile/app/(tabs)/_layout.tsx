import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import {
  BORDER,
  BG,
  MUTED,
  FG,
  FONT,
  FS,
  SP,
} from '@/lib/theme';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  getBadgeCount,
  getLastViewedAt,
  setBadgeCount,
  subscribe,
  initFromStorage,
} from '@/lib/orderBadgeStore';

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS: {
  name: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
}[] = [
  { name: 'index',    label: 'Home',     icon: 'home' },
  { name: 'studio',   label: 'Studio',   icon: 'zap' },
  { name: 'products', label: 'Products', icon: 'package' },
  { name: 'orders',   label: 'Orders',   icon: 'shopping-bag' },
  { name: 'profile',  label: 'Profile',  icon: 'user' },
];

const INACTIVE_COLOR = 'rgba(244,244,255,0.40)';

// ─── Custom Tab Bar ───────────────────────────────────────────────────────────

function CustomTabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { userId } = useAuth();
  const { theme } = useAppTheme();

  // Sync local state with the shared in-memory badge store so the badge
  // clears immediately when orders.tsx calls clearBadge(userId), without
  // waiting for the next poll cycle.
  const [newOrderCount, setNewOrderCount] = useState(() =>
    userId ? getBadgeCount(userId) : 0,
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // No authenticated seller → clear badge and stop.
    if (!userId) {
      setNewOrderCount(0);
      return;
    }

    // Subscribe to store changes → re-render on any badge update.
    const unsub = subscribe(() => setNewOrderCount(getBadgeCount(userId)));

    let cancelled = false;

    const poll = async () => {
      // Record poll start time before the async fetch. If the seller opens
      // Orders while the request is in-flight, clearBadge() advances
      // lastViewedAt past pollStartMs, and setBadgeCount will discard the
      // stale result.
      const pollStartMs = Date.now();
      try {
        const rows = await api.orders.list();
        if (cancelled) return;

        // Count orders placed after the seller last viewed the Orders screen.
        const lastViewed = getLastViewedAt(userId);
        const count = Array.isArray(rows)
          ? (rows as any[]).filter(
              (r: any) =>
                r.status === 'pending' &&
                new Date(r.createdAt).getTime() > lastViewed,
            ).length
          : 0;

        // setBadgeCount discards this result if lastViewedAt advanced past
        // pollStartMs (i.e. the seller opened Orders mid-flight).
        setBadgeCount(userId, count, pollStartMs);
      } catch {
        // Non-critical — badge simply won't show if offline.
      }
    };

    // Hydrate the per-seller watermark from AsyncStorage (cross-launch
    // persistence), then kick off the first poll and periodic interval.
    initFromStorage(userId).then(() => {
      if (!cancelled) {
        poll();
        pollRef.current = setInterval(poll, 30_000);
      }
    });

    return () => {
      cancelled = true;
      unsub();
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [api, userId]);

  if (Platform.OS === 'web') return null;

  return (
    <View
      style={[
        styles.bar,
        {
          height: 72 + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: BG,
          borderTopColor: BORDER,
        },
      ]}
    >
      {state.routes.map((route: any, index: number) => {
        const descriptor = descriptors[route.key];
        // Only render routes that are in our visible TABS list
        const tabDef = TABS.find((t) => t.name === route.name);
        if (!tabDef) return null;

        const isFocused = state.index === index;
        const color = isFocused ? theme.accent : INACTIVE_COLOR;

        // Show new-order badge on Orders tab only when the tab is not active
        const showOrderBadge =
          tabDef.name === 'orders' && newOrderCount > 0 && !isFocused;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        const onLongPress = () => {
          navigation.emit({ type: 'tabLongPress', target: route.key });
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={descriptor.options.tabBarAccessibilityLabel}
            onPress={onPress}
            onLongPress={onLongPress}
            style={styles.tab}
          >
            {/* Purple pill indicator above icon */}
            <View style={styles.pillWrap}>
              {isFocused && <View style={[styles.pill, { backgroundColor: theme.accent }]} />}
            </View>

            {/* Icon + optional new-order badge */}
            <View style={styles.iconWrap}>
              <Feather name={tabDef.icon} size={22} color={color} />
              {showOrderBadge && (
                <View style={[styles.badge, { backgroundColor: theme.accent, borderColor: BG }]}>
                  <Text style={styles.badgeText}>
                    {newOrderCount > 99 ? '99+' : String(newOrderCount)}
                  </Text>
                </View>
              )}
            </View>

            <Text style={[styles.label, { color }]} numberOfLines={1}>
              {tabDef.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function TabLayout() {
  return (
    <>
      <Tabs
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        {/* Visible tabs */}
        <Tabs.Screen name="index"    options={{ title: 'Home' }} />
        <Tabs.Screen name="studio"   options={{ title: 'Studio' }} />
        <Tabs.Screen name="products" options={{ title: 'Products' }} />
        <Tabs.Screen name="orders"   options={{ title: 'Orders' }} />
        <Tabs.Screen name="profile"  options={{ title: 'Profile' }} />

        {/* Hidden routes — resolve but not shown in tab bar */}
        <Tabs.Screen name="more"      options={{ href: null }} />
        <Tabs.Screen name="feed"      options={{ href: null }} />
        <Tabs.Screen name="following" options={{ href: null }} />
        <Tabs.Screen name="analytics" options={{ href: null }} />
        <Tabs.Screen name="marketing" options={{ href: null }} />
        <Tabs.Screen name="wishlist"  options={{ href: null }} />
      </Tabs>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bar: {
    flexDirection:   'row',
    backgroundColor: '#07070F',
    borderTopWidth:  StyleSheet.hairlineWidth,
    borderTopColor:  'rgba(255,255,255,0.07)',
    paddingTop:      8,
  },
  tab: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'flex-start',
    gap:            4,
  },
  pillWrap: {
    height:      3,
    width:       '100%',
    alignItems:  'center',
    marginBottom: 6,
  },
  pill: {
    width:           28,
    height:          3,
    borderRadius:    1.5,
  },
  label: {
    fontSize:   10,
    fontFamily: FONT.medium,
    lineHeight: 12,
  },
  iconWrap: {
    position: 'relative',
  },
  badge: {
    position:        'absolute',
    top:             -5,
    right:           -8,
    minWidth:        16,
    height:          16,
    borderRadius:    8,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: 3,
    borderWidth:     1.5,
    borderColor:     '#07070F',
  },
  badgeText: {
    fontSize:   9,
    fontFamily: FONT.medium,
    color:      '#FFFFFF',
    lineHeight: 11,
  },
});
