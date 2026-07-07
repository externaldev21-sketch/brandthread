import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  useColorScheme, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const STATS = [
  { label: 'Products',  value: '847'  },
  { label: 'Orders',    value: '1.2k' },
  { label: 'Customers', value: '384'  },
];

const RECENT_DROPS = [
  { name: 'Summer Capsule',     status: 'Active',   revenue: '$14,200', type: 'Pre-Made',   color: '#7C3AED' },
  { name: 'Monochrome Series',  status: 'Closed',   revenue: '$8,900',  type: 'Pre-Order',  color: '#0F766E' },
  { name: 'Heritage Collection',status: 'Upcoming', revenue: '—',       type: 'Pre-Order',  color: '#B45309' },
];

const MENU = [
  { icon: 'settings'     as const, label: 'Account settings',  route: '/brand'    },
  { icon: 'users'        as const, label: 'Team members',       route: '/team'     },
  { icon: 'truck'        as const, label: 'Shipping setup',     route: '/shipping' },
  { icon: 'bar-chart-2'  as const, label: 'Analytics',          route: '/analytics'},
  { icon: 'credit-card'  as const, label: 'Payments & billing', route: '/payments' },
  { icon: 'help-circle'  as const, label: 'Help & support',     route: '__help__'  },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';
  const router = useRouter();

  const bg      = isDark ? '#08080F' : '#F8F7FF';
  const card    = isDark ? '#111118' : '#FFFFFF';
  const border  = isDark ? '#1E1E30' : '#DDD6FE';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#6D6892';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';
  const secondary = isDark ? '#1C1C2E' : '#F0EEFF';

  function nav(route: string | null) {
    if (!route) return;
    if (route === '__help__') {
      Alert.alert('Help & Support', 'How can we help?', [
        { text: 'Browse FAQ',   onPress: () => {} },
        { text: 'Contact Us',  onPress: () => {} },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  const statusColor = (s: string) =>
    s === 'Active' ? '#22C55E' : s === 'Upcoming' ? '#F59E0B' : muted;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: bg }]}
      contentContainerStyle={{ paddingBottom: 130 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ─ Header ─ */}
      <View style={[styles.hero, { paddingTop: insets.top + 20, backgroundColor: card, borderBottomColor: border }]}>
        {/* Avatar */}
        <View style={[styles.avatarRing, { borderColor: primary }]}>
          <View style={[styles.avatar, { backgroundColor: primary }]}>
            <Text style={styles.avatarText}>BT</Text>
          </View>
        </View>

        <Text style={[styles.brandName, { color: fg }]}>Brandthread</Text>
        <Text style={[styles.brandHandle, { color: muted }]}>@brandthread · Est. 2024</Text>

        {/* Stats row */}
        <View style={[styles.statsRow, { borderTopColor: border }]}>
          {STATS.map((s, i) => (
            <View
              key={s.label}
              style={[
                styles.statItem,
                i < STATS.length - 1 && { borderRightWidth: 1, borderRightColor: border },
              ]}
            >
              <Text style={[styles.statValue, { color: fg }]}>{s.value}</Text>
              <Text style={[styles.statLabel, { color: muted }]}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ─ Post on Story ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/story-creator' as never); }}
          activeOpacity={0.85}
          style={styles.storyBtnWrap}
        >
          <LinearGradient colors={['#A855F7', '#7C3AED']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.storyBtnGrad}>
            <Feather name="camera" size={17} color="#FFF" />
            <Text style={styles.storyBtnText}>Post on Story</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* ─ Recent Drops ─ */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: fg }]}>Recent Drops</Text>
          <TouchableOpacity onPress={() => nav('/more')} activeOpacity={0.7}>
            <Text style={[styles.sectionAction, { color: primary }]}>See all</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          {RECENT_DROPS.map((drop, i) => (
            <View
              key={drop.name}
              style={[styles.dropRow, i > 0 && { borderTopWidth: 1, borderTopColor: border }]}
            >
              <View style={[styles.dropDot, { backgroundColor: drop.color }]} />
              <View style={styles.dropInfo}>
                <Text style={[styles.dropName, { color: fg }]}>{drop.name}</Text>
                <Text style={[styles.dropType, { color: muted }]}>{drop.type}</Text>
              </View>
              <View style={styles.dropRight}>
                <Text style={[styles.dropRevenue, { color: fg }]}>{drop.revenue}</Text>
                <Text style={[styles.dropStatus, { color: statusColor(drop.status) }]}>{drop.status}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ─ Menu ─ */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: fg, marginBottom: 12 }]}>Settings</Text>
        <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
          {MENU.map((item, i) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.menuRow, i > 0 && { borderTopWidth: 1, borderTopColor: border }]}
              onPress={() => nav(item.route)}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIcon, { backgroundColor: secondary }]}>
                <Feather name={item.icon} size={16} color={primary} />
              </View>
              <Text style={[styles.menuLabel, { color: fg }]}>{item.label}</Text>
              <Feather name="chevron-right" size={16} color={muted} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ─ Sign out ─ */}
      <View style={{ paddingHorizontal: 20 }}>
        <TouchableOpacity
          style={[styles.signOutBtn, { borderColor: '#EF4444' }]}
          activeOpacity={0.8}
          onPress={() => Alert.alert('Sign out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: async () => {
              await AsyncStorage.clear();
              router.replace('/onboarding' as never);
            }},
          ])}
        >
          <Feather name="log-out" size={16} color="#EF4444" />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  hero: { alignItems: 'center', paddingBottom: 0, borderBottomWidth: 1, marginBottom: 24 },
  avatarRing: { width: 82, height: 82, borderRadius: 41, borderWidth: 3, padding: 3, marginBottom: 12 },
  avatar: { flex: 1, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  brandName: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.4, marginBottom: 4 },
  brandHandle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },

  statsRow: { flexDirection: 'row', width: '100%', borderTopWidth: 1, marginTop: 4 },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: 16 },
  statValue: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },

  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  sectionAction: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },

  dropRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  dropDot: { width: 10, height: 10, borderRadius: 5 },
  dropInfo: { flex: 1, gap: 2 },
  dropName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  dropType: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  dropRight: { alignItems: 'flex-end', gap: 2 },
  dropRevenue: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  dropStatus: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  menuRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  menuIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium' },

  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 15, borderRadius: 14, borderWidth: 1 },
  signOutText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },

  storyBtnWrap: { borderRadius: 16, overflow: 'hidden' },
  storyBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15 },
  storyBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },
});
