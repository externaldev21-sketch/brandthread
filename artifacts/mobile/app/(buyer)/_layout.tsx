import React from 'react';
import { Platform, Pressable, StyleSheet, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';

// ─── Buyer tab layout ─────────────────────────────────────────────────────────
// Tabs: Thread · Discover · Friends · Inbox · Profile

function BuyerTabLayout() {
  const colorScheme = useColorScheme();
  const isDark  = colorScheme === 'dark';
  const isIOS   = Platform.OS === 'ios';
  const insets  = useSafeAreaInsets();

  const pillBg       = isDark ? '#1B1917F0' : '#FAF7EEF0';
  const activeTint   = isDark ? '#39FF88'   : '#00C853';
  const inactiveTint = isDark ? '#6E685C'   : '#A69C87';

  const tabBarStyle = {
    position: 'relative' as const,
    height: 50 + insets.bottom,
    paddingBottom: insets.bottom,
    borderRadius: 0,
    borderTopWidth: 1,
    borderTopColor: isDark ? '#232823' : '#E6E0D2',
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
            style={[props.style, { alignItems: 'center', justifyContent: 'center' }]}
          />
        ),
      }}
    >
      {/* Thread — buyer home: seller videos, product tagging, likes, comments, purchase */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Thread',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'play.rectangle.fill' : 'play.rectangle'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="play-circle" color={color} focused={focused} />
            ),
        }}
      />

      {/* Discover — curated drops, for-you picks, trending brands */}
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'safari.fill' : 'safari'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="compass" color={color} focused={focused} />
            ),
        }}
      />

      {/* Friends */}
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'person.2.fill' : 'person.2'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="users" color={color} focused={focused} />
            ),
        }}
      />

      {/* Inbox */}
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'message.fill' : 'message'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="message-circle" color={color} focused={focused} />
            ),
        }}
      />

      {/* Profile */}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'person.fill' : 'person'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="user" color={color} focused={focused} />
            ),
        }}
      />

      {/* Hidden — keep routes alive but off the tab bar */}
      <Tabs.Screen name="following"    options={{ href: null }} />
      <Tabs.Screen name="wishlist"     options={{ href: null }} />
      <Tabs.Screen name="edit-profile" options={{ href: null }} />
      <Tabs.Screen name="search"       options={{ href: null }} />
      {/* feed re-export kept for deep-link compatibility; Thread is now the index */}
      <Tabs.Screen name="feed"         options={{ href: null }} />
    </Tabs>
  );
}

// ─── Regular tab icon ─────────────────────────────────────────────────────────

function TabIcon({
  name, color, focused,
}: {
  name: keyof typeof Feather.glyphMap;
  color: string;
  focused: boolean;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Feather name={name} size={20} color={color} />
      {focused && (
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#39FF88' }} />
      )}
    </View>
  );
}

export default function BuyerLayout() {
  return <BuyerTabLayout />;
}
