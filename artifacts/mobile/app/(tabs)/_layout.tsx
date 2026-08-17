import React from 'react';
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
  PURPLE,
  BORDER,
  BG,
  MUTED,
  FG,
  FONT,
  FS,
  SP,
} from '@/lib/theme';

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

  if (Platform.OS === 'web') return null;

  return (
    <View
      style={[
        styles.bar,
        {
          height: 72 + insets.bottom,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {state.routes.map((route: any, index: number) => {
        const descriptor = descriptors[route.key];
        // Only render routes that are in our visible TABS list
        const tabDef = TABS.find((t) => t.name === route.name);
        if (!tabDef) return null;

        const isFocused = state.index === index;
        const color = isFocused ? PURPLE : INACTIVE_COLOR;

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
              {isFocused && <View style={styles.pill} />}
            </View>

            <Feather name={tabDef.icon} size={22} color={color} />

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
    backgroundColor: PURPLE,
  },
  label: {
    fontSize:   10,
    fontFamily: FONT.medium,
    lineHeight: 12,
  },
});
