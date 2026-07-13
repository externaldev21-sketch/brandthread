import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, useColorScheme, Alert, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { readableOn } from '@/lib/color';
import { loadStyleBadge, DEFAULT_STYLE_BADGE, type StyleBadgeState } from '@/lib/styleBadge';
import { loadBuyerProfile, DEFAULT_BUYER_PROFILE, type BuyerProfileFields } from '@/lib/buyerProfile';

const PROFILE_EMOJI = '😎';

const GRID_GAP = 2;
const GRID_COLS = 3;

// ─── Mock data ────────────────────────────────────────────────────────────────

const STATS = [
  { label: 'orders',    value: '3'  },
  { label: 'following', value: '5'  },
  { label: 'wishlist',  value: '6'  },
];

const RECENT_ORDERS = [
  { id: '#2041', name: 'Canvas Cargo Jacket',  brand: 'Vault Studio', initials: 'VS', price: '$189', status: 'Delivered',  color: '#00C853' },
  { id: '#1988', name: 'Archive Hoodie Vol.3', brand: 'NxGen Drops',  initials: 'NX', price: '$135', status: 'Shipped',    color: '#B45309' },
  { id: '#1740', name: 'Relaxed Tee — Sage',   brand: 'Meridian Co.', initials: 'MC', price: '$48',  status: 'Processing', color: '#0F766E' },
];

const FOLLOWED_BRANDS = [
  { initials: 'VS', name: 'Vault Studio',  color: '#00C853', hasNew: true  },
  { initials: 'MC', name: 'Meridian Co.',  color: '#0F766E', hasNew: true  },
  { initials: 'NX', name: 'NxGen Drops',   color: '#B45309', hasNew: false },
  { initials: 'SW', name: 'Softwear__',    color: '#BE185D', hasNew: true  },
  { initials: 'AG', name: 'Atlas Goods',   color: '#1D4ED8', hasNew: false },
];

const TABS = [
  { key: 'orders',   icon: 'grid'     as const },
  { key: 'brands',   icon: 'users'    as const },
  { key: 'wishlist', icon: 'heart'    as const },
  { key: 'reposts',  icon: 'repeat'   as const },
  { key: 'saved',    icon: 'bookmark' as const },
] as const;

type TabKey = typeof TABS[number]['key'];

const statusColor = (s: string) =>
  s === 'Delivered' ? '#4C9A5E' : s === 'Shipped' ? '#4A6FA5' : '#B98A2E';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BuyerProfileScreen() {
  const insets  = useSafeAreaInsets();
  const scheme  = useColorScheme();
  const isDark  = scheme !== 'light';
  const router  = useRouter();
  const [tab, setTab] = useState<TabKey>('orders');
  const { width: screenW } = useWindowDimensions();
  const tileSize = (screenW - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const [styleBadge, setStyleBadge] = useState<StyleBadgeState>({ ...DEFAULT_STYLE_BADGE, enabled: true });
  const [profileFields, setProfileFields] = useState<BuyerProfileFields>({ ...DEFAULT_BUYER_PROFILE });

  useFocusEffect(
    useCallback(() => {
      loadStyleBadge().then(setStyleBadge);
      loadBuyerProfile().then(setProfileFields);
    }, [])
  );

  const bg      = isDark ? '#121110' : '#F5F1E7';
  const border  = isDark ? '#33302A' : '#E3DCC9';
  const fg      = isDark ? '#EDE7D9' : '#17140F';
  const muted   = isDark ? '#8C8577' : '#6E6759';
  const primary = isDark ? '#39FF88' : '#00C853';
  const badgeColor = isDark ? '#39FF88' : '#00C853';

  function openOrderStatus() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(buyer)/orders' as never);
  }

  function openAccountSwitcher() {
    Haptics.selectionAsync();
    Alert.alert('Switch account', 'Sign into another account or create a new one.', [
      { text: 'Sign into another account', onPress: () => router.push({ pathname: '/sign-in', params: { initialMode: 'sign-in' } } as never) },
      { text: 'Create another account', onPress: () => router.push({ pathname: '/sign-in', params: { initialMode: 'sign-up' } } as never) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function openAccountMenu() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Account', undefined, [
      { text: 'My orders',         onPress: () => router.push('/(buyer)/orders' as never) },
      { text: 'Style preferences', onPress: () => router.push('/onboarding' as never) },
      { text: 'Drop notifications', onPress: () => router.push('/notifications-settings' as never) },
      { text: 'Help & support',    onPress: () => router.push('/help' as never) },
      { text: 'Sign out', style: 'destructive', onPress: () => Alert.alert('Sign out', 'Are you sure you want to sign out?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign out', style: 'destructive', onPress: async () => {
              await AsyncStorage.clear();
              router.replace('/onboarding' as never);
            } },
        ]) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <ScrollView
      style={[s.container, { backgroundColor: bg }]}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ─ Top bar ─ */}
      <View style={[s.topBar, { paddingHorizontal: 20 }]}>
        <TouchableOpacity style={s.usernameRow} activeOpacity={0.7} onPress={openAccountSwitcher}>
          <Feather name="lock" size={13} color={muted} />
          <Text style={[s.username, { color: fg }]}>{profileFields.username || 'jordan'}</Text>
          <Feather name="chevron-down" size={16} color={fg} />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(buyer)/inbox' as never); }}
          >
            <Feather name="bell" size={22} color={fg} />
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} onPress={openAccountMenu}>
            <Feather name="menu" size={22} color={fg} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ─ Avatar + stats ─ */}
      <View style={[s.hero, { paddingHorizontal: 20 }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/story-picker' as never); }}
        >
          <View style={[s.avatarRing, { borderColor: border }]}>
            <View style={[s.avatarFill, { backgroundColor: primary }]}>
              <Text style={s.avatarEmoji}>{PROFILE_EMOJI}</Text>
            </View>
          </View>
          <View style={[s.avatarBadge, { backgroundColor: primary, borderColor: bg }]}>
            <Feather name="plus" size={12} color="#FFF" />
          </View>
        </TouchableOpacity>

        <View style={s.statsRow}>
          {STATS.map(stat => (
            <View key={stat.label} style={s.statItem}>
              <Text style={[s.statValue, { color: fg }]}>{stat.value}</Text>
              <Text style={[s.statLabel, { color: muted }]}>{stat.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ─ Name + bio ─ */}
      <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[s.heroName, { color: fg }]}>{profileFields.name.trim() || 'Jordan'}</Text>
          {!!profileFields.pronouns.trim() && (
            <Text style={[s.heroPronouns, { color: muted }]}>({profileFields.pronouns})</Text>
          )}
          {profileFields.aiCreator && (
            <View style={[s.aiPill, { borderColor: border }]}>
              <Text style={[s.aiPillText, { color: muted }]}>AI creator</Text>
            </View>
          )}
        </View>
        <Text style={[s.heroSub, { color: muted }]}>@{profileFields.username || 'jordan'} · Joined Jul 2026</Text>
        {!!profileFields.bio.trim() && (
          <Text style={[s.heroBio, { color: fg }]}>{profileFields.bio}</Text>
        )}
        {!!profileFields.links.trim() && (
          <Text style={[s.heroLink, { color: primary }]} numberOfLines={1}>{profileFields.links}</Text>
        )}
        {styleBadge.enabled && (
          <View style={[s.styleBadge, { backgroundColor: badgeColor + '18', borderColor: badgeColor + '40' }]}>
            <Text style={s.styleBadgeEmoji}>{styleBadge.emoji}</Text>
            <Text style={[s.styleBadgeLabel, { color: badgeColor }]}>{styleBadge.label}</Text>
          </View>
        )}
      </View>

      {/* ─ Action buttons ─ */}
      <View style={[s.actionsRow, { paddingHorizontal: 20 }]}>
        <TouchableOpacity
          style={[s.actionBtn, { borderColor: border }]}
          activeOpacity={0.75}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(buyer)/edit-profile' as never); }}
        >
          <Text style={[s.actionBtnText, { color: fg }]}>Edit profile</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.actionBtn, { borderColor: border }]}
          activeOpacity={0.75}
          onPress={async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            await Clipboard.setStringAsync(`https://brandthread.app/u/${profileFields.username || 'jordan'}`);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert('Link copied', 'Your profile link has been copied to the clipboard.');
          }}
        >
          <Text style={[s.actionBtnText, { color: fg }]}>Share profile</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.iconActionBtn, { borderColor: border }]}
          activeOpacity={0.75}
          onPress={async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            const { Share } = await import('react-native');
            Share.share({ message: 'Join me on Brandthread! https://brandthread.app' });
          }}
        >
          <Feather name="user-plus" size={16} color={fg} />
        </TouchableOpacity>
      </View>

      {/* ─ Order status ─ */}
      <View style={{ paddingHorizontal: 20, paddingVertical: 18 }}>
        <TouchableOpacity
          style={[s.statusBtn, { backgroundColor: primary }]}
          activeOpacity={0.85}
          onPress={openOrderStatus}
        >
          <Feather name="truck" size={17} color="#03150B" />
          <Text style={s.statusBtnText}>Check Status On Orders</Text>
        </TouchableOpacity>
      </View>

      {/* ─ Tabs ─ */}
      <View style={[s.tabsRow, { borderTopColor: border, borderBottomColor: border }]}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[s.tabItem, tab === t.key && { borderBottomColor: fg }]}
            activeOpacity={0.7}
            onPress={() => { Haptics.selectionAsync(); setTab(t.key); }}
          >
            <Feather name={t.icon} size={20} color={tab === t.key ? fg : muted} />
          </TouchableOpacity>
        ))}
      </View>

      {/* ─ Grid content ─ */}
      {tab === 'orders' && (
        RECENT_ORDERS.length > 0 ? (
          <View style={s.grid}>
            {RECENT_ORDERS.map(order => {
              const onColor = readableOn(order.color);
              return (
                <TouchableOpacity
                  key={order.id}
                  style={[s.tile, { width: tileSize, height: tileSize, backgroundColor: order.color }]}
                  activeOpacity={0.85}
                  onPress={() => router.push('/(buyer)/orders' as never)}
                >
                  <Text style={[s.tileInitials, { color: onColor }]}>{order.initials}</Text>
                  <Text style={[s.tileName, { color: onColor }]} numberOfLines={2}>{order.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <Text style={[s.tilePrice, { color: onColor }]}>{order.price}</Text>
                    <View style={[s.tileStatusPill, { backgroundColor: onColor === '#FFFFFF' ? '#00000040' : '#FFFFFF60' }]}>
                      <View style={[s.tileStatusDot, { backgroundColor: statusColor(order.status) }]} />
                      <Text style={[s.tileStatus, { color: onColor }]}>{order.status}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <EmptyState icon="package" label="No orders yet" muted={muted} border={border} />
        )
      )}

      {tab === 'brands' && (
        FOLLOWED_BRANDS.length > 0 ? (
          <View style={s.grid}>
            {FOLLOWED_BRANDS.map(brand => {
              const onColor = readableOn(brand.color);
              return (
                <TouchableOpacity
                  key={brand.initials}
                  style={[s.tile, { width: tileSize, height: tileSize, backgroundColor: brand.color, alignItems: 'center', justifyContent: 'center' }]}
                  activeOpacity={0.85}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(buyer)/feed' as never); }}
                >
                  <Text style={[s.tileBrandInitials, { color: onColor }]}>{brand.initials}</Text>
                  <Text style={[s.tileBrandName, { color: onColor }]} numberOfLines={1}>{brand.name}</Text>
                  {brand.hasNew && <View style={[s.tileDot, { backgroundColor: onColor }]} />}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <EmptyState icon="users" label="Not following any brands yet" muted={muted} border={border} />
        )
      )}

      {tab === 'wishlist' && (
        <EmptyState icon="heart" label="No liked videos yet" muted={muted} border={border} />
      )}

      {tab === 'reposts' && (
        <EmptyState icon="repeat" label="No reposts yet" muted={muted} border={border} />
      )}

      {tab === 'saved' && (
        <EmptyState icon="bookmark" label="No saved posts yet" muted={muted} border={border} />
      )}
    </ScrollView>
  );
}

// ─── Empty state (matches "No posts yet" reference pattern) ────────────────────

function EmptyState({ icon, label, muted, border }: { icon: keyof typeof Feather.glyphMap; label: string; muted: string; border: string }) {
  return (
    <View style={s.emptyState}>
      <View style={[s.emptyIconRing, { borderColor: border }]}>
        <Feather name={icon} size={30} color={muted} />
      </View>
      <Text style={[s.emptyLabel, { color: muted }]}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  usernameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  username: { fontSize: 17, fontFamily: 'Inter_700Bold' },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  avatarRing: { width: 78, height: 78, borderRadius: 39, borderWidth: 1, padding: 3 },
  avatarFill: { flex: 1, borderRadius: 33, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 28 },
  avatarBadge: {
    position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2,
  },

  statsRow:  { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  statItem:  { alignItems: 'center' },
  statValue: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  statLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 3 },

  heroName:   { fontSize: 14, fontFamily: 'Inter_700Bold' },
  heroSub:    { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 3 },
  heroBio:    { fontSize: 12.5, fontFamily: 'Inter_400Regular', marginTop: 6 },
  heroPronouns: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  heroLink:   { fontSize: 12.5, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
  aiPill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  aiPillText: { fontSize: 9.5, fontFamily: 'Inter_600SemiBold' },

  styleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1, marginTop: 10,
  },
  styleBadgeEmoji: { fontSize: 14 },
  styleBadgeLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  actionBtn: { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  actionBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  iconActionBtn: { width: 38, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  statusBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 50, borderRadius: 14,
  },
  statusBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#03150B' },

  tabsRow: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  tile: {
    padding: 10, justifyContent: 'space-between',
  },
  tileInitials: { fontSize: 11, fontFamily: 'Inter_700Bold', opacity: 0.85 },
  tileName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', lineHeight: 15 },
  tilePrice: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  tileStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  tileStatusDot: { width: 5, height: 5, borderRadius: 2.5 },
  tileStatus: { fontSize: 9, fontFamily: 'Inter_600SemiBold' },

  tileBrandInitials: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  tileBrandName: { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
  tileDot: { position: 'absolute', top: 10, right: 10, width: 6, height: 6, borderRadius: 3 },

  emptyState: { alignItems: 'center', paddingVertical: 64, gap: 14 },
  emptyIconRing: { width: 76, height: 76, borderRadius: 38, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  emptyLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
