import React from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

// ─── Seller tab layout ────────────────────────────────────────────────────────
// Tabs: Home · Studio · Products · Orders · More

const BG     = '#0A0B0A';
const BORDER = '#1E221E';
const GREEN  = '#39FF88';
const MUTED  = '#4A5A4C';

export default function TabLayout() {
  const insets      = useSafeAreaInsets();
  const { width }   = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && width >= 768;

  const tabBarStyle = isDesktopWeb ? { display: 'none' as const } : {
    position:        'relative' as const,
    height:          54 + insets.bottom,
    paddingBottom:   insets.bottom,
    borderTopWidth:  1,
    borderTopColor:  BORDER,
    backgroundColor: BG + 'F8',
    elevation:       0,
    shadowOpacity:   0,
  };

  return (
    <Tabs
      screenOptions={{
        headerShown:          false,
        tabBarActiveTintColor: GREEN,
        tabBarInactiveTintColor: MUTED,
        tabBarShowLabel:      true,
        tabBarLabelStyle: {
          fontSize:    9,
          fontFamily: 'Inter_600SemiBold',
          marginTop:  -2,
          letterSpacing: 0.2,
        },
        tabBarItemStyle:  { paddingVertical: 6 },
        tabBarStyle,
        tabBarBackground: () => (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: BG + 'F8' }]} />
        ),
      }}
    >
      {/* Home */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? 'home' : 'home'} color={color} focused={focused} />
          ),
        }}
      />

      {/* Studio */}
      <Tabs.Screen
        name="studio"
        options={{
          title: 'Studio',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="pen-tool" color={color} focused={focused} />
          ),
        }}
      />

      {/* Products */}
      <Tabs.Screen
        name="products"
        options={{
          title: 'Products',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="box" color={color} focused={focused} />
          ),
        }}
      />

      {/* Orders */}
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="shopping-bag" color={color} focused={focused} />
          ),
        }}
      />

      {/* More */}
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="grid" color={color} focused={focused} />
          ),
        }}
      />

      {/* Hidden routes — still resolve but not shown in tab bar */}
      <Tabs.Screen name="profile"    options={{ href: null }} />
      <Tabs.Screen name="feed"       options={{ href: null }} />
      <Tabs.Screen name="following"  options={{ href: null }} />
      <Tabs.Screen name="analytics"  options={{ href: null }} />
      <Tabs.Screen name="marketing"  options={{ href: null }} />
      <Tabs.Screen name="wishlist"   options={{ href: null }} />
    </Tabs>
  );
}

// ─── Tab icon with active dot ─────────────────────────────────────────────────

function TabIcon({
  name,
  color,
  focused,
}: {
  name:    keyof typeof Feather.glyphMap;
  color:   string;
  focused: boolean;
}) {
  return (
    <View style={ti.wrap}>
      <Feather name={name} size={20} color={color} />
      {focused && <View style={ti.dot} />}
    </View>
  );
}

const ti = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 3 },
  dot:  { width: 3, height: 3, borderRadius: 1.5, backgroundColor: GREEN },
});
