import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  Animated, Keyboard, Platform, Pressable, StyleSheet,
  Text, TextInput, View, type ColorValue, type KeyboardEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import Svg, { Circle, Path } from 'react-native-svg';

import { FS } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { getDeactivationStatus, reactivate } from '@/lib/accountService';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { getConversations, getNotifications, subscribeSocial } from '@/services/socialService';

// ─── Buyer tab layout ─────────────────────────────────────────────────────────
// Tabs: Home · Discover · Inbox · Search + separate Profile circle

function BuyerTabLayout() {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const colors = useColors();
  const [inboxBadgeCount, setInboxBadgeCount] = useState(0);

  const activeTint = theme.accent;
  const inactiveTint = colors.subtle;

  const loadBadgeCount = useCallback(async () => {
    try {
      const [conversations, notifications] = await Promise.all([
        getConversations(),
        getNotifications(),
      ]);
      const unreadMessages = conversations.reduce(
        (sum, conv) => sum + (conv.unreadCount ?? 0), 0,
      );
      const unreadNotifications = notifications.filter(
        n => !n.isRead && !n.isMuted,
      ).length;
      setInboxBadgeCount(unreadMessages + unreadNotifications);
    } catch {
      // Badges are non-critical.
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

  return (
    <Tabs
      detachInactiveScreens
      tabBar={(props) => (
        <BuyerBottomTabBar
          {...props}
          inboxBadgeCount={inboxBadgeCount}
          accent={theme.accent}
          onAccent={theme.onAccent}
        />
      )}
      screenOptions={{
        freezeOnBlur: true,
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: inactiveTint,
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {/* Home — buyer home: seller videos, product tagging, likes, comments, purchase */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home tab',
          tabBarIcon: ({ color, focused }) =>
            Platform.OS === 'ios' ? (
              <SymbolView
                name={focused ? 'house.fill' : 'house'}
                tintColor={color}
                size={20}
              />
            ) : (
              <NavIcon name="home" color={color as string} focused={focused} />
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
            Platform.OS === 'ios' ? (
              <SymbolView
                name={focused ? 'safari.fill' : 'safari'}
                tintColor={color}
                size={20}
              />
            ) : (
              <NavIcon name="discover" color={color as string} focused={focused} />
            ),
        }}
      />

      {/* Cart — hidden from tab bar */}
      <Tabs.Screen name="cart" options={{ href: null }} />

      {/* Friends — hidden from tab bar (reachable from Profile) */}
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          href: null,
        }}
      />

      {/* Inbox */}
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarAccessibilityLabel:
            inboxBadgeCount > 0
              ? `Inbox tab, ${inboxBadgeCount} unread items`
              : 'Inbox tab',
          tabBarIcon: ({ color, focused }) => (
            <TabBadge
              count={inboxBadgeCount}
              accent={theme.accent}
              onAccent={theme.onAccent}
            >
              {Platform.OS === 'ios' ? (
                <SymbolView
                  name={focused ? 'message.fill' : 'message'}
                  tintColor={color}
                  size={20}
                />
              ) : (
                <NavIcon name="inbox" color={color as string} focused={focused} />
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
            Platform.OS === 'ios' ? (
              <SymbolView
                name={focused ? 'person.fill' : 'person'}
                tintColor={color}
                size={20}
              />
            ) : (
              <NavIcon name="profile" color={color as string} focused={focused} />
            ),
        }}
      />

      {/* Hidden — keep routes alive but off the tab bar */}
      <Tabs.Screen name="following"    options={{ href: null }} />
      <Tabs.Screen name="edit-profile" options={{ href: null }} />
      <Tabs.Screen name="search"       options={{ href: null }} />
      <Tabs.Screen name="orders"       options={{ href: null }} />
      {/* feed re-export kept for deep-link compatibility; Home is now the index */}
      <Tabs.Screen name="feed"         options={{ href: null }} />
    </Tabs>
  );
}

// ─── Nav items for the capsule ────────────────────────────────────────────────

const BUYER_NAV_ITEMS: {
  name: 'index' | 'discover' | 'inbox' | 'search';
  label: string;
  icon: 'home' | 'discover' | 'inbox' | 'search';
}[] = [
  { name: 'index',    label: 'Home',     icon: 'home' },
  { name: 'discover', label: 'Discover', icon: 'discover' },
  { name: 'inbox',    label: 'Inbox',    icon: 'inbox' },
  { name: 'search',   label: 'Search',   icon: 'search' },
];

// ─── Keyboard-tracking hook ───────────────────────────────────────────────────

function useKeyboardOffset(bottomInset: number) {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const updateOffset = (event: KeyboardEvent) => {
      setOffset(Math.max(0, event.endCoordinates.height - bottomInset));
    };
    const frameEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const frame = Keyboard.addListener(frameEvent, updateOffset);
    const hide = Keyboard.addListener(hideEvent, () => {
      setOffset(0);
    });
    return () => { frame.remove(); hide.remove(); };
  }, [bottomInset]);

  return offset;
}

// ─── Compact Floating Tab Bar ─────────────────────────────────────────────────

function BuyerBottomTabBar({
  state,
  navigation,
  inboxBadgeCount,
  accent,
  onAccent,
}: any & {
  inboxBadgeCount: number;
  accent: string;
  onAccent: string;
}) {
  const insets         = useSafeAreaInsets();
  const router         = useRouter();
  const colors         = useColors();
  const { theme }      = useAppTheme();
  const bottomInset    = insets.bottom;
  const isDark         = true; // always dark glass
  const activeRoute    = state.routes[state.index]?.name as string;
  const searchActive   = activeRoute === 'search';
  const searchInputRef = useRef<TextInput>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const inactiveColor  = colors.subtle;
  const [pillWidth, setPillWidth] = useState(0);

  // Keyboard tracking — bar rides up with the keyboard
  const keyboardOffset = useKeyboardOffset(bottomInset);
  const barTranslate   = useRef(new Animated.Value(0)).current;
  const searchTransition = useRef(new Animated.Value(searchActive ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(barTranslate, {
      toValue: -keyboardOffset,
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
      mass: 0.6,
    }).start();
  }, [keyboardOffset, barTranslate]);

  useEffect(() => {
    Animated.spring(searchTransition, {
      toValue: searchActive ? 1 : 0,
      useNativeDriver: true,
      damping: 22,
      stiffness: 240,
      mass: 0.72,
    }).start();
  }, [searchActive, searchTransition]);

  // Auto-focus search input when search tab is activated
  useEffect(() => {
    if (!searchActive) return;
    const t = setTimeout(() => searchInputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [searchActive]);

  const openTab = (name: string) => {
    if (name !== 'search' && searchActive) {
      // Dismiss keyboard when leaving search
      Keyboard.dismiss();
    }
    Haptics.selectionAsync().catch(() => {});
    navigation.navigate(name);
  };

  const updateSearch = (value: string) => {
    setSearchQuery(value);
    router.setParams({ q: value } as never);
  };

  const pillBg     = colors.tabBarBackground;
  const borderCol  = theme.border;

  // Total bar height = capsule (54) + bottom inset + 8px breathing room
  const barHeight = 54 + bottomInset + 8;
  const measuredTravel = Math.max(pillWidth, 1);
  const standardTranslateX = Animated.multiply(searchTransition, -measuredTravel);
  const searchTranslateX = Animated.multiply(
    Animated.subtract(1, searchTransition),
    measuredTravel,
  );
  const standardOpacity = searchTransition.interpolate({
    inputRange: [0, 0.72, 1],
    outputRange: [1, 0, 0],
  });
  const searchOpacity = searchTransition.interpolate({
    inputRange: [0, 0.28, 1],
    outputRange: [0, 0, 1],
  });

  const measurePill = (event: LayoutChangeEvent) => {
    setPillWidth(event.nativeEvent.layout.width);
  };

  return (
    <Animated.View
      style={[
        buyerBarStyles.wrapper,
        {
          height: barHeight,
          paddingBottom: bottomInset + 4,
          transform: [{ translateY: barTranslate }],
        },
      ]}
      testID="buyer-bottom-tab-bar"
      pointerEvents="box-none"
    >
      {/* ── Main capsule pill ─────────────────────────────────────── */}
      <View
        style={[
          buyerBarStyles.mainPill,
          { borderColor: borderCol },
        ]}
        onLayout={measurePill}
        accessibilityRole="tablist"
      >
        <BlurView
          intensity={72}
          tint={isDark ? 'dark' : 'light'}
          experimentalBlurMethod="dimezisBlurView"
          style={[StyleSheet.absoluteFill, { backgroundColor: pillBg }]}
        />

        {/* Hairline overlay */}
        <View style={[buyerBarStyles.pillHairline, { borderColor: borderCol }]} />

        <Animated.View
          pointerEvents={searchActive ? 'auto' : 'none'}
          style={[
            buyerBarStyles.searchMode,
            {
              opacity: searchOpacity,
              transform: [{ translateX: searchTranslateX }],
            },
          ]}
        >
            {/* Home stays on the left */}
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel="Home tab"
              onPress={() => openTab('index')}
              style={({ pressed }) => [
                buyerBarStyles.searchHome,
                pressed && buyerBarStyles.pressed,
              ]}
              testID="buyer-search-home"
              hitSlop={4}
            >
              <NavIcon name="home" color={inactiveColor} focused={false} />
              <Text style={[buyerBarStyles.tabLabel, { color: inactiveColor }]}>
                Home
              </Text>
            </Pressable>

            {/* Expanded search field */}
            <View
              style={[
                buyerBarStyles.searchField,
                { backgroundColor: `${theme.surface}CC`, borderColor: borderCol },
              ]}
            >
              <NavIcon name="search" color={accent} focused />
              <TextInput
                ref={searchInputRef}
                value={searchQuery}
                onChangeText={updateSearch}
                placeholder="Search Brandthread"
                placeholderTextColor={colors.subtle}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={[
                  buyerBarStyles.searchInput,
                  { color: colors.foreground },
                  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null,
                ]}
                testID="buyer-tab-search-input"
                onSubmitEditing={() => {
                  if (searchQuery.trim()) router.setParams({ q: searchQuery } as never);
                }}
              />
              {!!searchQuery && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => updateSearch('')}
                  hitSlop={14}
                  style={({ pressed }) => pressed && { opacity: 0.6 }}
                  testID="buyer-tab-search-clear"
                >
                  <Feather name="x-circle" size={16} color={inactiveColor} />
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open search filters"
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  router.setParams({ filters: '1' } as never);
                }}
                hitSlop={13}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
                testID="buyer-tab-search-filters"
              >
                <Feather name="sliders" size={18} color={accent} />
              </Pressable>
            </View>
        </Animated.View>

        <Animated.View
          pointerEvents={searchActive ? 'none' : 'auto'}
          style={[
            buyerBarStyles.standardTabs,
            {
              opacity: standardOpacity,
              transform: [{ translateX: standardTranslateX }],
            },
          ]}
        >
            {BUYER_NAV_ITEMS.map((item) => {
              const focused = activeRoute === item.name;
              const color   = focused ? accent : inactiveColor;
              const showBadge = item.name === 'inbox' && inboxBadgeCount > 0;
              return (
                <Pressable
                  key={item.name}
                  accessibilityRole="tab"
                  accessibilityLabel={
                    showBadge
                      ? `${item.label} tab, ${inboxBadgeCount} unread items`
                      : `${item.label} tab`
                  }
                  accessibilityState={focused ? { selected: true } : {}}
                  onPress={() => openTab(item.name)}
                  style={({ pressed }) => [
                    buyerBarStyles.tab,
                    pressed && buyerBarStyles.pressed,
                  ]}
                  testID={`buyer-tab-${item.name}`}
                  hitSlop={2}
                >
                  <TabBadge
                    count={showBadge ? inboxBadgeCount : 0}
                    accent={accent}
                    onAccent={onAccent}
                  >
                    <NavIcon
                      name={item.icon}
                      color={color}
                      focused={focused}
                    />
                  </TabBadge>
                  <Text style={[buyerBarStyles.tabLabel, { color }]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
        </Animated.View>
      </View>

      {/* ── Separate Profile circle ───────────────────────────────── */}
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel="Profile tab"
        accessibilityState={activeRoute === 'profile' ? { selected: true } : {}}
        onPress={() => openTab('profile')}
        style={({ pressed }) => [
          buyerBarStyles.profileButton,
          { borderColor: activeRoute === 'profile' ? accent : borderCol },
          pressed && buyerBarStyles.pressed,
        ]}
        testID="buyer-tab-profile"
      >
        <BlurView
          intensity={72}
          tint={isDark ? 'dark' : 'light'}
          experimentalBlurMethod="dimezisBlurView"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: colors.tabBarBackground },
          ]}
        />
        <View style={buyerBarStyles.profileIcon}>
          <NavIcon
            name="profile"
            color={activeRoute === 'profile' ? accent : inactiveColor}
            focused={activeRoute === 'profile'}
          />
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const buyerBarStyles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 4,
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 10,
    backgroundColor: 'transparent',
  },
  mainPill: {
    width: 286,
    maxWidth: '76%',
    height: 54,
    borderRadius: 27,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    position: 'relative',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 9,
  },
  pillHairline: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 27,
    borderWidth: StyleSheet.hairlineWidth,
    pointerEvents: 'none',
  },
  standardTabs: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    height: 54,
  },
  tab: {
    flex: 1,
    height: 54,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    lineHeight: 12,
  },
  pressed: {
    opacity: 0.68,
    transform: [{ scale: 0.94 }],
  },

  // Search mode
  searchMode: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: 54,
    paddingHorizontal: 4,
    gap: 4,
  },
  searchHome: {
    width: 52,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 44,
  },
  searchField: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: 4,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 38,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    padding: 0,
  },

  // Profile circle
  profileButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 9,
  },
  profileIcon: {
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ─── Nav icons (thin outline, filled when focused) ────────────────────────────

function NavIcon({
  name,
  color,
  focused,
}: {
  name: 'home' | 'discover' | 'inbox' | 'search' | 'profile';
  color: string;
  focused: boolean;
}) {
  if (name === 'home') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24">
        <Path
          d="M3.5 10.6 12 3.5l8.5 7.1v9.1a.8.8 0 0 1-.8.8h-5.1v-6.2H9.4v6.2H4.3a.8.8 0 0 1-.8-.8v-9.1Z"
          fill={focused ? color : 'none'}
          stroke={color}
          strokeWidth={1.7}
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  if (name === 'search') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24">
        <Circle cx={10.5} cy={10.5} r={6.3} fill="none" stroke={color} strokeWidth={1.8} />
        <Path
          d="m15.2 15.2 4.6 4.6"
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      </Svg>
    );
  }

  if (name === 'discover') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24">
        <Circle
          cx={12}
          cy={12}
          r={8.4}
          fill={focused ? color : 'none'}
          fillOpacity={focused ? 0.14 : 0}
          stroke={color}
          strokeWidth={1.7}
        />
        <Path
          d="m14.9 9.1-1.8 4-4 1.8 1.8-4 4-1.8Z"
          fill={focused ? color : 'none'}
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  if (name === 'inbox') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24">
        <Path
          d="M4.2 6.4A2.4 2.4 0 0 1 6.6 4h10.8a2.4 2.4 0 0 1 2.4 2.4v8.2a2.4 2.4 0 0 1-2.4 2.4h-7l-4.2 3v-3.1a2.4 2.4 0 0 1-2-2.3V6.4Z"
          fill={focused ? color : 'none'}
          stroke={color}
          strokeWidth={1.7}
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  // profile
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Circle
        cx={12}
        cy={12}
        r={10}
        fill={focused ? `${color}22` : 'none'}
        stroke={color}
        strokeWidth={1.4}
      />
      <Circle
        cx={12}
        cy={9}
        r={3.1}
        fill={focused ? color : 'none'}
        stroke={color}
        strokeWidth={1.4}
      />
      <Path
        d="M6.9 19c.7-3 2.5-4.7 5.1-4.7s4.4 1.7 5.1 4.7"
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// ─── Unread badge ─────────────────────────────────────────────────────────────

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
          <Text style={[badgeStyles.text, { color: onAccent }]}>
            {count > 99 ? '99+' : count}
          </Text>
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
  text: { fontSize: FS.xs, fontFamily: 'Inter_700Bold', lineHeight: 11 },
});

// ─── Unused export kept for legacy compat ─────────────────────────────────────
function TabIcon({
  name,
  color,
  focused,
  accent,
}: {
  name: keyof typeof Feather.glyphMap;
  color: ColorValue;
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

// ─── Root export ──────────────────────────────────────────────────────────────

export default function BuyerLayout() {
  useEffect(() => {
    getDeactivationStatus().then(status => {
      if (status?.active) reactivate();
    });
  }, []);

  return <BuyerTabLayout />;
}
