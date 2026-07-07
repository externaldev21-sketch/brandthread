import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';

// Always use the custom floating-pill layout for a consistent luxury look
// across all platforms (including iOS 26 liquid glass devices).
function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const insets = useSafeAreaInsets();
  const bottomOffset = isWeb ? 20 : Math.max(insets.bottom, 8) + 12;

  const pillBg = isDark ? '#111118F0' : '#FFFFFFF0';
  const inactiveTint = isDark ? '#555570' : '#9090B0';

  const tabBarStyle = {
    position: 'absolute' as const,
    bottom: bottomOffset,
    left: 20,
    right: 20,
    height: 64,
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
        tabBarShowLabel: false,
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
        tabBarItemStyle: {
          paddingVertical: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'house.fill' : 'house'} tintColor={color} size={22} />
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
              <SymbolView name={focused ? 'square.grid.2x2.fill' : 'square.grid.2x2'} tintColor={color} size={22} />
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
              <SymbolView name={focused ? 'chart.bar.fill' : 'chart.bar'} tintColor={color} size={22} />
            ) : (
              <TabIcon name="bar-chart-2" color={color} focused={focused} />
            ),
        }}
      />
      <Tabs.Screen
        name="marketing"
        options={{
          title: 'Marketing',
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <SymbolView name={focused ? 'megaphone.fill' : 'megaphone'} tintColor={color} size={22} />
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
              <SymbolView name={focused ? 'ellipsis.circle.fill' : 'ellipsis.circle'} tintColor={color} size={22} />
            ) : (
              <TabIcon name="grid" color={color} focused={focused} />
            ),
        }}
      />
    </Tabs>
  );
}

function TabIcon({ name, color, focused }: { name: keyof typeof Feather.glyphMap; color: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Feather name={name} size={21} color={color} />
      {focused && (
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#9F7AEA' }} />
      )}
    </View>
  );
}

export default function TabLayout() {
  return <ClassicTabLayout />;
}
