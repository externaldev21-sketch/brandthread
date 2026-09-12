import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { BORDER, SUBTLE } from '@/lib/theme';
import { getDeactivationStatus, reactivate } from '@/lib/accountService';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { getConversations, getNotifications, subscribeSocial } from '@/services/socialService';

// ─── Buyer tab layout ─────────────────────────────────────────────────────────
// Tabs: Thread · Discover · Friends · Inbox · Profile

function BuyerTabLayout() {
  const colorScheme = useColorScheme();
  const isDark  = colorScheme === 'dark';
  const isIOS   = Platform.OS === 'ios';
  const insets  = useSafeAreaInsets();
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
    height: 50 + insets.bottom,
    paddingBottom: insets.bottom,
    borderRadius: 0,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: pillBg,
    elevation: 0,
    shadowOpacity: 0,
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: inactiveTint,
        headerShown: false,
        sceneStyle: { backgroundColor: 'transparent' },
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
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarButton: (props: any) => (
          <Pressable
            {...props}
            accessibilityRole="tab"
            style={[props.style, { minHeight: 44, alignItems: 'center', justifyContent: 'center' }]}
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
  color: string;
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
