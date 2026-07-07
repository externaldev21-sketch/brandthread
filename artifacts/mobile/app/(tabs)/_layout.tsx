import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { LinearGradient } from 'expo-linear-gradient';
import { useRole } from '@/contexts/RoleContext';

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const insets = useSafeAreaInsets();
  const bottomOffset = isWeb ? 20 : Math.max(insets.bottom, 8) + 12;
  const { role } = useRole();
  const isBuyer = role === 'buyer';

  const pillBg      = isDark ? '#111118F0' : '#FFFFFFF0';
  const inactiveTint = isDark ? '#555570' : '#9090B0';

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
    shadowColor: isDark ? '#000000' : '#7C3AED',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: isDark ? 0.5 : 0.15,
    shadowRadius: 20,
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
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
      }}
    >
      {/* ─── Tab 1: Home (label changes by role) ───────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: isBuyer ? 'Discover' : 'Dashboard',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'house.fill' : 'house'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="home" color={color} focused={focused} />
            ),
        }}
      />

      {/* ─── Tab 2: Products (seller) or Following (buyer) ─────── */}
      <Tabs.Screen
        name="products"
        options={{
          href: isBuyer ? null : undefined,
          title: 'Products',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'square.grid.2x2.fill' : 'square.grid.2x2'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="box" color={color} focused={focused} />
            ),
        }}
      />
      <Tabs.Screen
        name="following"
        options={{
          href: isBuyer ? undefined : null,
          title: 'Following',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'heart.fill' : 'heart'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="heart" color={color} focused={focused} />
            ),
        }}
      />

      {/* ─── Always hidden ─────────────────────────────────────── */}
      <Tabs.Screen name="analytics"  options={{ href: null }} />
      <Tabs.Screen name="marketing"  options={{ href: null }} />

      {/* ─── Centre — Feed ─────────────────────────────────────── */}
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarLabel: () => null,
          tabBarIcon: ({ focused }) => <FeedCenterIcon focused={focused} />,
        }}
      />

      {/* ─── Tab 4: More (seller) or Wishlist (buyer) ──────────── */}
      <Tabs.Screen
        name="more"
        options={{
          href: isBuyer ? null : undefined,
          title: 'More',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'ellipsis.circle.fill' : 'ellipsis.circle'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="grid" color={color} focused={focused} />
            ),
        }}
      />
      <Tabs.Screen
        name="wishlist"
        options={{
          href: isBuyer ? undefined : null,
          title: 'Wishlist',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'bookmark.fill' : 'bookmark'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="bookmark" color={color} focused={focused} />
            ),
        }}
      />

      {/* ─── Tab 5: Profile (all roles) ────────────────────────── */}
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

// ─── Feed centre button ───────────────────────────────────────────────────────

function FeedCenterIcon({ focused }: { focused: boolean }) {
  return (
    <LinearGradient
      colors={focused
        ? ['#F0ABFC', '#C026D3', '#7C3AED']
        : ['#D946EF', '#A855F7', '#7C3AED']}
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
    shadowColor: '#C026D3',
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

function TabIcon({ name, color, focused }: { name: keyof typeof Feather.glyphMap; color: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Feather name={name} size={20} color={color} />
      {focused && (
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#9F7AEA' }} />
      )}
    </View>
  );
}

export default function TabLayout() {
  return <ClassicTabLayout />;
}
