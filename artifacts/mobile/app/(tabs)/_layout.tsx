import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { LinearGradient } from 'expo-linear-gradient';

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const insets = useSafeAreaInsets();
  const bottomOffset = isWeb ? 20 : Math.max(insets.bottom, 8) + 12;

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
      {/* ─── Left side ─────────────────────────────────────────── */}
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
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Analytics',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'chart.bar.fill' : 'chart.bar'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="bar-chart-2" color={color} focused={focused} />
            ),
        }}
      />

      {/* ─── Centre — Feed (stands out) ────────────────────────── */}
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarLabelStyle: {
            fontSize: 9,
            fontFamily: 'Inter_700Bold',
            color: isDark ? '#C4B5FD' : '#7C3AED',
            marginTop: 0,
          },
          tabBarIcon: ({ focused }) => (
            <FeedCenterIcon focused={focused} isDark={isDark} />
          ),
          tabBarItemStyle: { paddingVertical: 4 },
        }}
      />

      {/* ─── Right side ────────────────────────────────────────── */}
      <Tabs.Screen
        name="marketing"
        options={{
          title: 'Marketing',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'megaphone.fill' : 'megaphone'} tintColor={color} size={20} />
            ) : (
              <TabIcon name="send" color={color} focused={focused} />
            ),
        }}
      />
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

function FeedCenterIcon({ focused, isDark }: { focused: boolean; isDark: boolean }) {
  return (
    <View style={feedStyles.wrapper}>
      {/* white halo ring — visible on both web and native */}
      <View style={[feedStyles.halo, { borderColor: isDark ? '#1C1C2E' : '#F8F7FF' }]} />
      <LinearGradient
        colors={focused
          ? ['#F0ABFC', '#C026D3', '#7C3AED']
          : ['#D946EF', '#A855F7', '#7C3AED']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={feedStyles.circle}
      >
        {/* stacked bars icon — feels like a "content feed" */}
        <View style={feedStyles.iconStack}>
          <View style={feedStyles.iconBar} />
          <View style={[feedStyles.iconBar, { width: 14 }]} />
          <View style={feedStyles.iconBar} />
        </View>
      </LinearGradient>
    </View>
  );
}

const feedStyles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    height: 64,
    marginTop: -28,
  },
  halo: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
  },
  circle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C026D3',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 24,
  },
  iconStack: { gap: 5, alignItems: 'center' },
  iconBar:   { width: 20, height: 2.5, borderRadius: 2, backgroundColor: '#FFFFFF' },
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
