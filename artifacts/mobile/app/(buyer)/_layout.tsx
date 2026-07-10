import React from 'react';
import { Platform, Pressable, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { LinearGradient } from 'expo-linear-gradient';

// ─── Buyer tab layout ─────────────────────────────────────────────────────────
// Tabs: Home · Friends · Feed (centre pill) · Inbox · Profile

function BuyerTabLayout() {
  const colorScheme = useColorScheme();
  const isDark  = colorScheme === 'dark';
  const isIOS   = Platform.OS === 'ios';
  const isWeb   = Platform.OS === 'web';
  const insets  = useSafeAreaInsets();
  const bottomOffset = isWeb ? 20 : Math.max(insets.bottom, 8) + 12;

  const pillBg       = isDark ? '#1B1917F0' : '#FAF7EEF0';
  const activeTint   = isDark ? '#39FF88'   : '#00C853';
  const inactiveTint = isDark ? '#6E685C'   : '#A69C87';

  const tabBarStyle = {
    position: 'absolute' as const,
    bottom: bottomOffset,
    left: 12,
    right: 12,
    height: 72,
    borderRadius: 32,
    borderTopWidth: 0,
    backgroundColor: isIOS ? 'transparent' : pillBg,
    elevation: 24,
    shadowColor: isDark ? '#000000' : '#00C853',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: isDark ? 0.5 : 0.15,
    shadowRadius: 20,
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
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={70}
              tint={isDark ? 'dark' : 'light'}
              style={[StyleSheet.absoluteFill, { borderRadius: 32, overflow: 'hidden' }]}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { borderRadius: 32, backgroundColor: pillBg }]} />
          ),
        tabBarItemStyle: { paddingVertical: 8 },
        // Ensure the whole tab item (icon + label) is tappable, not just the icon glyph.
        tabBarButton: (props: any) => (
          <Pressable
            {...props}
            style={[props.style, { alignItems: 'center', justifyContent: 'center' }]}
          />
        ),
      }}
    >
      {/* Home */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'house.fill' : 'house'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="home" color={color} focused={focused} />
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

      {/* Hidden screens — keep routes alive but off the tab bar */}
      <Tabs.Screen name="following" options={{ href: null }} />
      <Tabs.Screen name="wishlist"  options={{ href: null }} />

      {/* Feed — centre gradient pill */}
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarLabel: () => null,
          tabBarIcon: ({ focused }) => <FeedCenterIcon focused={focused} />,
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
    </Tabs>
  );
}

// ─── Feed centre gradient pill ────────────────────────────────────────────────

function FeedCenterIcon({ focused }: { focused: boolean }) {
  return (
    <LinearGradient
      colors={focused
        ? ['#39FF88', '#00C853', '#00C853']
        : ['#39FF88', '#0F3822', '#00C853']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={feedStyles.pill}
    >
      <Text style={feedStyles.label}>Feed</Text>
    </LinearGradient>
  );
}

const feedStyles = StyleSheet.create({
  pill: {
    width: 62,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00C853',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 12,
  },
  label: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});

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
