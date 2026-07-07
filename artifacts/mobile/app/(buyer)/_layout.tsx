import React from 'react';
import {
  Platform, StyleSheet, TouchableOpacity,
  useColorScheme, View,
} from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Buyer tab bar ────────────────────────────────────────────────────────────
// Intentionally completely different from the seller pill layout:
//   · No floating pill, no blur, no shadow, no rounded corners
//   · Full-width, flush to the bottom of the screen
//   · Icons only — no text labels
//   · Active indicator: thin coloured line above the icon
//   · Clean editorial feel — consumer shopping app, not a business dashboard

const TAB_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  index:     'compass',
  following: 'heart',
  feed:      'zap',
  wishlist:  'bookmark',
  profile:   'user',
};

function BuyerTabBar({ state, descriptors, navigation }: {
  state: any;
  descriptors: any;
  navigation: any;
}) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const insets = useSafeAreaInsets();
  const isWeb  = Platform.OS === 'web';

  const bg       = isDark ? '#0D0D14' : '#FFFFFF';
  const border   = isDark ? '#1C1C28' : '#EBEBF0';
  const active   = isDark ? '#9F7AEA' : '#7C3AED';
  const inactive = isDark ? '#3A3A55' : '#C0BEDD';

  const bottomPad = isWeb ? 16 : Math.max(insets.bottom, 10);

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: bg,
          borderTopColor: border,
          paddingBottom: bottomPad,
        },
      ]}
    >
      {state.routes.map((route: any, i: number) => {
        const focused = state.index === i;
        const icon = TAB_ICONS[route.name] ?? 'circle';

        function onPress() {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        }

        return (
          <TouchableOpacity
            key={route.key}
            style={styles.tab}
            onPress={onPress}
            activeOpacity={0.65}
          >
            {/* Active indicator line — sits at the very top of the tab */}
            <View
              style={[
                styles.indicator,
                { backgroundColor: focused ? active : 'transparent' },
              ]}
            />

            <Feather
              name={icon}
              size={22}
              color={focused ? active : inactive}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 10,
    paddingBottom: 4,
    gap: 0,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    width: 28,
    height: 2,
    borderRadius: 1,
  },
});

// ─── Layout export ────────────────────────────────────────────────────────────

export default function BuyerLayout() {
  return (
    <Tabs
      tabBar={(props) => <BuyerTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index"     />
      <Tabs.Screen name="following" />
      <Tabs.Screen name="feed"      />
      <Tabs.Screen name="wishlist"  />
      <Tabs.Screen name="profile"   />
    </Tabs>
  );
}
