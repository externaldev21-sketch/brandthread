import React from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

// ─── Mock data ────────────────────────────────────────────────────────────────

const STYLE_BADGE = { label: 'Archive Fashion', emoji: '🎞️', color: '#7C3AED' };

const STATS = [
  { label: 'Wishlist',  value: '6'  },
  { label: 'Following', value: '5'  },
  { label: 'Orders',    value: '3'  },
];

const RECENT_ORDERS = [
  { id: '#2041', name: 'Canvas Cargo Jacket', brand: 'Vault Studio', price: '$189', status: 'Delivered',  color: '#7C3AED' },
  { id: '#1988', name: 'Archive Hoodie Vol.3', brand: 'NxGen Drops', price: '$135', status: 'Shipped',    color: '#B45309' },
  { id: '#1740', name: 'Relaxed Tee — Sage',   brand: 'Meridian Co.', price: '$48', status: 'Processing', color: '#0F766E' },
];

const FOLLOWED_BRANDS = [
  { initials: 'VS', name: 'Vault Studio',  color: '#7C3AED', hasNew: true  },
  { initials: 'MC', name: 'Meridian Co.',  color: '#0F766E', hasNew: true  },
  { initials: 'NX', name: 'NxGen Drops',   color: '#B45309', hasNew: false },
  { initials: 'SW', name: 'Softwear__',    color: '#BE185D', hasNew: true  },
  { initials: 'AG', name: 'Atlas Goods',   color: '#1D4ED8', hasNew: false },
];

const MENU = [
  { icon: 'package'      as const, label: 'My orders',          sub: 'Track & manage purchases'  },
  { icon: 'sliders'      as const, label: 'Style preferences',  sub: 'Update your taste profile' },
  { icon: 'bell'         as const, label: 'Drop notifications',  sub: 'Never miss a release'      },
  { icon: 'help-circle'  as const, label: 'Help & support',      sub: 'FAQ, contact us'           },
];

const statusColor = (s: string) =>
  s === 'Delivered' ? '#22C55E' : s === 'Shipped' ? '#3B82F6' : '#F59E0B';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BuyerProfileScreen() {
  const insets  = useSafeAreaInsets();
  const scheme  = useColorScheme();
  const isDark  = scheme !== 'light';
  const router  = useRouter();

  const bg      = isDark ? '#08080F' : '#F9F9FC';
  const card    = isDark ? '#111118' : '#FFFFFF';
  const border  = isDark ? '#1E1E30' : '#E8E6F0';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#6D6892';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';

  return (
    <ScrollView
      style={[s.container, { backgroundColor: bg }]}
      contentContainerStyle={{ paddingTop: insets.top + 20, paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ─ Avatar + name ─ */}
      <View style={[s.hero, { paddingHorizontal: 20 }]}>
        <View style={[s.avatarRing, { borderColor: primary + '60' }]}>
          <LinearGradient
            colors={['#9F7AEA', '#7C3AED']}
            style={s.avatarGradient}
          >
            <Text style={s.avatarInitials}>JD</Text>
          </LinearGradient>
        </View>
        <View style={s.heroText}>
          <Text style={[s.heroName, { color: fg }]}>Jordan</Text>
          <Text style={[s.heroSub, { color: muted }]}>@jordan · Joined Jul 2026</Text>
        </View>

        {/* Style badge */}
        <View style={[s.styleBadge, { backgroundColor: STYLE_BADGE.color + '18', borderColor: STYLE_BADGE.color + '40' }]}>
          <Text style={s.styleBadgeEmoji}>{STYLE_BADGE.emoji}</Text>
          <Text style={[s.styleBadgeLabel, { color: STYLE_BADGE.color }]}>{STYLE_BADGE.label}</Text>
        </View>
      </View>

      {/* ─ Stats row ─ */}
      <View style={[s.statsRow, { backgroundColor: card, borderColor: border, marginHorizontal: 20 }]}>
        {STATS.map((stat, i) => (
          <View
            key={stat.label}
            style={[
              s.statItem,
              i < STATS.length - 1 && { borderRightWidth: 1, borderRightColor: border },
            ]}
          >
            <Text style={[s.statValue, { color: fg }]}>{stat.value}</Text>
            <Text style={[s.statLabel, { color: muted }]}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* ─ Post on Story ─ */}
      <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/story-creator' as never); }}
          activeOpacity={0.85}
        >
          <LinearGradient colors={['#A855F7', '#7C3AED']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.storyBtn}>
            <Feather name="camera" size={17} color="#FFF" />
            <Text style={s.storyBtnText}>Post on Story</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* ─ Recent orders ─ */}
      <View style={[s.section, { paddingHorizontal: 20, marginTop: 28 }]}>
        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: fg }]}>Recent Orders</Text>
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={[s.sectionAction, { color: primary }]}>View all</Text>
          </TouchableOpacity>
        </View>
        <View style={[s.card, { backgroundColor: card, borderColor: border }]}>
          {RECENT_ORDERS.map((order, i) => (
            <View
              key={order.id}
              style={[s.orderRow, i > 0 && { borderTopWidth: 1, borderTopColor: border }]}
            >
              <View style={[s.orderAccent, { backgroundColor: order.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={[s.orderProduct, { color: fg }]}>{order.name}</Text>
                <Text style={[s.orderBrand, { color: muted }]}>{order.brand} · {order.id}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={[s.orderPrice, { color: fg }]}>{order.price}</Text>
                <Text style={[s.orderStatus, { color: statusColor(order.status) }]}>
                  {order.status}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ─ Settings menu ─ */}
      <View style={[s.section, { paddingHorizontal: 20, marginTop: 28 }]}>
        <Text style={[s.sectionTitle, { color: fg, marginBottom: 12 }]}>Account</Text>
        <View style={[s.card, { backgroundColor: card, borderColor: border }]}>
          {MENU.map((item, i) => (
            <TouchableOpacity
              key={item.label}
              style={[s.menuRow, i > 0 && { borderTopWidth: 1, borderTopColor: border }]}
              activeOpacity={0.7}
              onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
            >
              <View style={[s.menuIcon, { backgroundColor: primary + '15' }]}>
                <Feather name={item.icon} size={16} color={primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.menuLabel, { color: fg }]}>{item.label}</Text>
                <Text style={[s.menuSub, { color: muted }]}>{item.sub}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={muted} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ─ Sign out ─ */}
      <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
        <TouchableOpacity
          style={[s.signOut, { borderColor: '#EF444440' }]}
          activeOpacity={0.8}
        >
          <Feather name="log-out" size={16} color="#EF4444" />
          <Text style={s.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },

  hero:       { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20, flexWrap: 'wrap' },
  avatarRing: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, padding: 3 },
  avatarGradient: { flex: 1, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  heroText:   { flex: 1 },
  heroName:   { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  heroSub:    { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },

  styleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  styleBadgeEmoji: { fontSize: 14 },
  styleBadgeLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  statsRow:  {
    flexDirection: 'row', borderRadius: 16, borderWidth: 1, overflow: 'hidden',
  },
  statItem:  { flex: 1, alignItems: 'center', paddingVertical: 16 },
  statValue: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },

  section:      {},
  sectionHeader:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  sectionAction:{ fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  brandItem:       { alignItems: 'center', gap: 6, width: 64 },
  brandRing:       { width: 60, height: 60, borderRadius: 30, padding: 2.5, alignItems: 'center', justifyContent: 'center' },
  brandRingViewed: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  brandRingInner:  { width: 53, height: 53, borderRadius: 27, padding: 2, alignItems: 'center', justifyContent: 'center' },
  brandCircle:     { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  brandInitials:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  brandName:       { fontSize: 10, fontFamily: 'Inter_500Medium', textAlign: 'center' },

  card:      { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  orderRow:  { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  orderAccent: { width: 3, height: 38, borderRadius: 2 },
  orderProduct:{ fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  orderBrand:  { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  orderPrice:  { fontSize: 13, fontFamily: 'Inter_700Bold' },
  orderStatus: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  menuRow:   { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  menuIcon:  { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  menuSub:   { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },

  storyBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, borderRadius: 16 },
  storyBtnText:{ fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },

  signOut:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 15, borderRadius: 14, borderWidth: 1 },
  signOutText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },
});
