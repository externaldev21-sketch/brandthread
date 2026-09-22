import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useColorScheme, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Path } from 'react-native-svg';

import { BORDER, SUBTLE } from '@/lib/theme';
import { getDeactivationStatus, reactivate } from '@/lib/accountService';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { getConversations, getNotifications, subscribeSocial } from '@/services/socialService';

// ─── Buyer tab layout ─────────────────────────────────────────────────────────
// Tabs: Thread · Search · Create · Inbox · Profile

function BuyerTabLayout() {
  const colorScheme = useColorScheme();
  const isDark  = colorScheme === 'dark';
  const isIOS   = Platform.OS === 'ios';
  const insets  = useSafeAreaInsets();
  const bottomInset = insets.bottom;
  const { theme } = useAppTheme();
  const [inboxBadgeCount, setInboxBadgeCount] = useState(0);

  const pillBg       = 'rgba(12, 12, 23, 0.65)'; // SURFACE with opacity
  const activeTint   = theme.accent;
  const inactiveTint = SUBTLE;

  const loadBadgeCount = useCallback(async () => {
    try {
      const [conversations, notifications] = await Promise.all([
        getConversations(),
        getNotifications(),
      ]);
      const unreadMessages = conversations.reduce((sum, conversation) => sum + (conversation.unreadCount ?? 0), 0);
      const unreadNotifications = notifications.filter(notification => !notification.isRead && !notification.isMuted).length;
      setInboxBadgeCount(unreadMessages + unreadNotifications);
    } catch {
      // Badges are non-critical and retain their last known count while offline.
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

  const tabBarStyle = {
    position: 'relative' as const,
    height: 64 + bottomInset,
    paddingBottom: bottomInset,
    paddingTop: 4,
    borderRadius: 0,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: pillBg,
    elevation: 0,
    shadowOpacity: 0,
  };

  return (
    <Tabs
      detachInactiveScreens
      tabBar={(props) => (
        <BuyerBottomTabBar
          {...props}
          inboxBadgeCount={inboxBadgeCount}
          accent={theme.accent}
          onAccent={theme.onAccent}
        />
      )}
      screenOptions={{
        freezeOnBlur: true,
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: inactiveTint,
        headerShown: false,
        sceneStyle: { backgroundColor: '#0A0A0B' },
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 9,
          fontFamily: 'Inter_500Medium',
          marginTop: -2,
        },
        tabBarStyle,
        tabBarBackground: () => (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: pillBg }]} />
        ),
        tabBarItemStyle: { paddingVertical: 0 },
        tabBarButton: (props: any) => (
          <Pressable
            {...props}
            accessibilityRole="tab"
            style={[props.style, { minHeight: 48, alignItems: 'center', justifyContent: 'center' }]}
          />
        ),
      }}
    >
      {/* Thread — buyer home: seller videos, product tagging, likes, comments, purchase */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Thread',
          tabBarAccessibilityLabel: 'Thread tab',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'play.rectangle.fill' : 'play.rectangle'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="play-circle" color={color} focused={focused} accent={theme.accent} />
            ),
        }}
      />

      {/* Discover — curated drops, for-you picks, trending brands */}
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarAccessibilityLabel: 'Discover tab',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'safari.fill' : 'safari'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="compass" color={color} focused={focused} accent={theme.accent} />
            ),
        }}
      />

      {/* Cart — hidden from tab bar */}
      <Tabs.Screen name="cart" options={{ href: null }} />

      {/* Friends */}
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarAccessibilityLabel: 'Friends tab',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'person.2.fill' : 'person.2'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="users" color={color} focused={focused} accent={theme.accent} />
            ),
        }}
      />

      {/* Inbox */}
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarAccessibilityLabel: inboxBadgeCount > 0 ? `Inbox tab, ${inboxBadgeCount} unread items` : 'Inbox tab',
          tabBarIcon: ({ color, focused }) => (
            <TabBadge count={inboxBadgeCount} accent={theme.accent} onAccent={theme.onAccent}>
              {isIOS ? (
                <SymbolView name={focused ? 'message.fill' : 'message'} tintColor={color} size={20} />
              ) : (
                <TabIcon name="message-circle" color={color} focused={focused} accent={theme.accent} />
              )}
            </TabBadge>
          ),
        }}
      />

      {/* Profile */}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarAccessibilityLabel: 'Profile tab',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'person.fill' : 'person'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="user" color={color} focused={focused} accent={theme.accent} />
            ),
        }}
      />

      {/* Hidden — keep routes alive but off the tab bar */}
      <Tabs.Screen name="following"    options={{ href: null }} />
      <Tabs.Screen name="edit-profile" options={{ href: null }} />
      <Tabs.Screen name="search"       options={{ href: null }} />
      <Tabs.Screen name="orders"       options={{ href: null }} />
      {/* feed re-export kept for deep-link compatibility; Thread is now the index */}
      <Tabs.Screen name="feed"         options={{ href: null }} />
    </Tabs>
  );
}

const BUYER_NAV_ITEMS: {
  name: 'index' | 'search' | 'inbox' | 'profile';
  label: string;
  icon: 'home' | 'search' | 'bell' | 'profile';
}[] = [
  { name: 'index', label: 'Thread', icon: 'home' },
  { name: 'search', label: 'Search', icon: 'search' },
  { name: 'inbox', label: 'Inbox', icon: 'bell' },
  { name: 'profile', label: 'Profile', icon: 'profile' },
];

function BuyerBottomTabBar({
  state,
  navigation,
  inboxBadgeCount,
  accent,
  onAccent,
}: any & {
  inboxBadgeCount: number;
  accent: string;
  onAccent: string;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const bottomInset = insets.bottom;
  const activeRoute = state.routes[state.index]?.name;

  const openTab = (name: string) => {
    Haptics.selectionAsync().catch(() => {});
    navigation.navigate(name);
  };

  return (
    <View
      style={[
        buyerBarStyles.bar,
        {
          height: 64 + bottomInset,
          paddingBottom: bottomInset,
        },
      ]}
      testID="buyer-bottom-tab-bar"
    >
      {BUYER_NAV_ITEMS.map((item, index) => {
          const isCenterGap = index === 2;
          const focused = activeRoute === item.name;
          const color = focused ? '#FFFFFF' : BUYER_INACTIVE_COLOR;
          const showInboxBadge = item.name === 'inbox' && inboxBadgeCount > 0;

          return (
            <React.Fragment key={item.name}>
              {isCenterGap && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create post"
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                    router.push('/create-post?accountType=buyer' as never);
                  }}
                  style={({ pressed }) => [buyerBarStyles.createButton, pressed && buyerBarStyles.pressed]}
                  testID="buyer-tab-create"
                >
                  <View style={buyerBarStyles.plusIcon}>
                    <View style={buyerBarStyles.plusHorizontal} />
                    <View style={buyerBarStyles.plusVertical} />
                  </View>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="tab"
                accessibilityLabel={
                  showInboxBadge
                    ? `${item.label} tab, ${inboxBadgeCount} unread items`
                    : `${item.label} tab`
                }
                accessibilityState={focused ? { selected: true } : {}}
                onPress={() => openTab(item.name)}
                style={({ pressed }) => [buyerBarStyles.tab, pressed && buyerBarStyles.pressed]}
                testID={`buyer-tab-${item.name}`}
              >
                <TabBadge count={showInboxBadge ? inboxBadgeCount : 0} accent={accent} onAccent={onAccent}>
                  <NavIcon name={item.icon} color={color} focused={focused} />
                </TabBadge>
              </Pressable>
            </React.Fragment>
          );
        })}
    </View>
  );
}

const BUYER_INACTIVE_COLOR = 'rgba(255,255,255,0.48)';

const buyerBarStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#050505',
    paddingTop: 4,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  createButton: {
    width: 52,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  tab: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusIcon: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  plusHorizontal: { position: 'absolute', width: 23, height: 2.5, borderRadius: 2, backgroundColor: '#050505' },
  plusVertical: { position: 'absolute', width: 2.5, height: 23, borderRadius: 2, backgroundColor: '#050505' },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.95 }],
  },
});

function NavIcon({
  name,
  color,
  focused,
}: {
  name: 'home' | 'search' | 'bell' | 'profile';
  color: string;
  focused: boolean;
}) {
  if (name === 'home') {
    return (
      <Svg width={27} height={27} viewBox="0 0 24 24">
        <Path
          d="M3.5 10.6 12 3.5l8.5 7.1v9.1a.8.8 0 0 1-.8.8h-5.1v-6.2H9.4v6.2H4.3a.8.8 0 0 1-.8-.8v-9.1Z"
          fill={focused ? color : 'none'}
          stroke={color}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  if (name === 'search') {
    return (
      <Svg width={27} height={27} viewBox="0 0 24 24">
        <Circle cx={10.5} cy={10.5} r={6.3} fill="none" stroke={color} strokeWidth={1.9} />
        <Path d="m15.2 15.2 4.6 4.6" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      </Svg>
    );
  }

  if (name === 'bell') {
    return (
      <Svg width={27} height={27} viewBox="0 0 24 24">
        <Path
          d="M6.4 9.8a5.6 5.6 0 0 1 11.2 0c0 5.2 2.1 5.8 2.1 5.8H4.3s2.1-.6 2.1-5.8Z"
          fill={focused ? color : 'none'}
          stroke={color}
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
        <Path d="M9.7 18.5a2.5 2.5 0 0 0 4.6 0" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      </Svg>
    );
  }

  return (
    <Svg width={29} height={29} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={10} fill={focused ? 'rgba(255,255,255,0.16)' : 'none'} stroke={color} strokeWidth={1.4} />
      <Circle cx={12} cy={9} r={3.1} fill={focused ? color : 'none'} stroke={color} strokeWidth={1.5} />
      <Path d="M6.9 19c.7-3 2.5-4.7 5.1-4.7s4.4 1.7 5.1 4.7" fill={focused ? color : 'none'} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

function TabBadge({
  count,
  accent,
  onAccent,
  children,
}: {
  count: number;
  accent: string;
  onAccent: string;
  children: React.ReactNode;
}) {
  return (
    <View style={badgeStyles.wrap}>
      {children}
      {count > 0 && (
        <View style={[badgeStyles.badge, { backgroundColor: accent }]}>
          <Text style={[badgeStyles.text, { color: onAccent }]}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  wrap: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -7,
    right: -11,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 9, fontFamily: 'Inter_700Bold', lineHeight: 11 },
});

// ─── Regular tab icon ─────────────────────────────────────────────────────────

function TabIcon({
  name, color, focused, accent,
}: {
  name: keyof typeof Feather.glyphMap;
  color: ColorValue;
  focused: boolean;
  accent: string;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Feather name={name} size={20} color={color} />
      {focused && (
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: accent }} />
      )}
    </View>
  );
}

export default function BuyerLayout() {
  // When the buyer is authenticated and reaches the tab layout, clear any local
  // deactivation record — signing back in is the reactivation mechanism.
  useEffect(() => {
    getDeactivationStatus().then(status => {
      if (status?.active) reactivate();
    });
  }, []);

  return <BuyerTabLayout />;
}
