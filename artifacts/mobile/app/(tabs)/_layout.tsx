import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { LinearGradient } from 'expo-linear-gradient';
import { ProfileTabButton } from '@/components/ProfileTabButton';
import ModeSwitcher from '@/components/ModeSwitcher';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Seller / Both layout ─────────────────────────────────────────────────────
// Tabs: Dashboard · Products · Feed (centre pill) · More · Profile

function SellerTabLayout() {
  const colors = useColors();
  const isDark = true;
  const isIOS = Platform.OS === 'ios';
  const insets = useSafeAreaInsets();

  const pillBg       = '#131513F0';
  const inactiveTint = '#6E7A72';

  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && width >= 768;
  const tabBarStyle = isDesktopWeb ? { display: 'none' as const } : {
    position: 'relative' as const,
    height: 50 + insets.bottom,
    paddingBottom: insets.bottom,
    borderRadius: 0,
    borderTopWidth: 1,
    borderTopColor: '#232823',
    backgroundColor: pillBg,
    elevation: 0,
    shadowOpacity: 0,
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
        tabBarBackground: () => (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: pillBg }]} />
        ),
        tabBarItemStyle: { paddingVertical: 4 },
      }}
    >
      {/* Dashboard */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'house.fill' : 'house'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="home" color={color} focused={focused} />
            ),
        }}
      />

      {/* Products */}
      <Tabs.Screen
        name="products"
        options={{
          title: 'Products',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'square.grid.2x2.fill' : 'square.grid.2x2'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="box" color={color} focused={focused} />
            ),
        }}
      />

      {/* Always hidden — buyer-only screens kept here so routes still resolve */}
      <Tabs.Screen name="following" options={{ href: null }} />
      <Tabs.Screen name="analytics" options={{ href: null }} />
      <Tabs.Screen name="marketing" options={{ href: null }} />
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

      {/* More */}
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'ellipsis.circle.fill' : 'ellipsis.circle'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="grid" color={color} focused={focused} />
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
          // Double-tap swaps to the buyer profile when the account has both sides.
          tabBarButton: (props: any) => (
            <ProfileTabButton {...props} otherSidePath="/(buyer)/profile" />
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
        ? ['#39FF88', '#00C853', '#0B3B1F']
        : ['#1E5B36', '#0F3822', '#0B3B1F']}
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

function TabIcon({ name, color, focused }: { name: keyof typeof Feather.glyphMap; color: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Feather name={name} size={20} color={color} />
      {focused && (
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#39FF88' }} />
      )}
    </View>
  );
}

export default function TabLayout() {
  const [isBoth, setIsBoth] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('user_role').then(r => setIsBoth(r === 'both'));
  }, []);
  return (
    <View style={{ flex: 1 }}>
      {isBoth && <ModeSwitcher currentMode="seller" />}
      <SellerTabLayout />
    </View>
  );
}
