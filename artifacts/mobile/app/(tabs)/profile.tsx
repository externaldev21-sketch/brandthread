import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const bg      = '#000000';
const card    = '#161616';
const border  = '#2A2A2A';
const fg      = '#FFFFFF';
const muted   = '#8C8C8C';
const primary = '#9F7AEA';
const pillBg  = '#232323';

const STATS = [
  { label: 'Following', value: '53'    },
  { label: 'Followers', value: '2,842' },
  { label: 'Likes',     value: '38.4k' },
];

const QUICK_LINKS: { icon: keyof typeof Feather.glyphMap; label: string; route: string }[] = [
  { icon: 'star',         label: 'Brand Studio', route: '/ai-studio' },
  { icon: 'shopping-bag', label: 'Your Orders',  route: '/payments'  },
];

const TABS: (keyof typeof Feather.glyphMap)[] = ['grid', 'smile', 'lock', 'repeat', 'bookmark', 'heart'];

type GridTile = {
  id: string;
  drafts?: number;
  name?: string;
  caption?: string;
  stat?: string;
  colors?: [string, string];
};

const GRID: GridTile[] = [
  { id: 'drafts', drafts: 3 },
  { id: 'g1', name: 'Summer Capsule',      caption: 'Best seller this week 🔥',      stat: '5.3k', colors: ['#5B4B8A', '#2E2450'] },
  { id: 'g2', name: 'Monochrome Series',   caption: 'Restocked — almost gone',       stat: '1.8k', colors: ['#1F6F63', '#0E332D'] },
  { id: 'g3', name: 'Heritage Collection', caption: 'Dropping this Friday',          stat: '2.1k', colors: ['#8A5A2E', '#402A14'] },
  { id: 'g4', name: 'Studio Essentials',   caption: 'Our most-loved staple',         stat: '4.6k', colors: ['#2E4A8A', '#152647'] },
  { id: 'g5', name: 'Limited Run 002',     caption: 'Only 40 left in stock',         stat: '1.5k', colors: ['#8A2E4A', '#3F1522'] },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(0);

  function nav(route: string | null) {
    if (!route) return;
    if (route === '__help__') {
      Alert.alert('Help & Support', 'How can we help?', [
        { text: 'Browse FAQ',  onPress: () => {} },
        { text: 'Contact Us',  onPress: () => {} },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: bg }]}
      contentContainerStyle={{ paddingBottom: 130 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ─ Top bar ─ */}
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
          onPress={() => nav('/team')}
        >
          <Feather name="user-plus" size={22} color={fg} />
        </TouchableOpacity>
        <View style={styles.topBarRight}>
          <TouchableOpacity
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            onPress={() => nav('/customers')}
          >
            <Feather name="bell" size={21} color={fg} />
          </TouchableOpacity>
          <TouchableOpacity
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              nav('/settings');
            }}
          >
            <Feather name="settings" size={20} color={fg} />
          </TouchableOpacity>
          <TouchableOpacity
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            onPress={() => nav('/settings')}
          >
            <Feather name="menu" size={22} color={fg} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ─ Avatar ─ */}
      <View style={styles.avatarWrap}>
        <View style={styles.avatarRing}>
          <LinearGradient colors={['#9F7AEA', '#5B3FA0']} style={styles.avatar}>
            <Text style={styles.avatarText}>BT</Text>
          </LinearGradient>
        </View>
        <TouchableOpacity
          style={styles.avatarPlus}
          activeOpacity={0.8}
          onPress={() => Alert.alert('Change photo', 'Upload a new brand avatar.')}
        >
          <Feather name="plus" size={14} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* ─ Name / Edit ─ */}
      <View style={styles.nameRow}>
        <Text style={styles.brandName}>Brandthread</Text>
        <Text style={styles.badgeEmoji}>💜</Text>
        <TouchableOpacity style={styles.editBtn} activeOpacity={0.8} onPress={() => nav('/edit-profile')}>
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.brandHandle}>@brandthread</Text>

      {/* ─ Stats row ─ */}
      <View style={styles.statsRow}>
        {STATS.map((s) => (
          <TouchableOpacity key={s.label} style={styles.statItem} activeOpacity={0.7}>
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ─ Add bio / Add category ─ */}
      <View style={styles.pillRow}>
        <TouchableOpacity
          style={styles.pillBtn}
          activeOpacity={0.8}
          onPress={() => nav('/brand')}
        >
          <Feather name="plus" size={13} color={fg} />
          <Text style={styles.pillText}>Add bio</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.pillBtn}
          activeOpacity={0.8}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/story-creator' as never); }}
        >
          <Feather name="camera" size={13} color={fg} />
          <Text style={styles.pillText}>Post on Story</Text>
        </TouchableOpacity>
      </View>

      {/* ─ Quick links ─ */}
      <View style={styles.quickLinksRow}>
        {QUICK_LINKS.map((q) => (
          <TouchableOpacity key={q.label} style={styles.quickLink} activeOpacity={0.7} onPress={() => nav(q.route)}>
            <Feather name={q.icon} size={14} color={primary} />
            <Text style={styles.quickLinkText}>{q.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ─ Filter tabs ─ */}
      <View style={[styles.tabsRow, { borderBottomColor: border }]}>
        {TABS.map((icon, i) => (
          <TouchableOpacity
            key={icon}
            style={[styles.tabItem, activeTab === i && styles.tabItemActive]}
            activeOpacity={0.7}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveTab(i); }}
          >
            <Feather name={icon} size={19} color={activeTab === i ? fg : muted} />
            {i === 0 && <Feather name="chevron-down" size={13} color={activeTab === i ? fg : muted} style={{ marginLeft: 2 }} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* ─ Content grid ─ */}
      <View style={styles.grid}>
        {GRID.map((tile) => (
          <TouchableOpacity
            key={tile.id}
            style={styles.gridTile}
            activeOpacity={0.85}
            onPress={() => nav(tile.id === 'drafts' ? '/products' : '/products')}
          >
            {tile.id === 'drafts' ? (
              <View style={[styles.gridInner, { backgroundColor: '#1E1E1E', alignItems: 'center', justifyContent: 'center' }]}>
                <Feather name="folder" size={22} color={muted} />
                <Text style={styles.draftsText}>Drafts: {tile.drafts}</Text>
              </View>
            ) : (
              <LinearGradient colors={tile.colors!} style={styles.gridInner}>
                <Text style={styles.gridCaption} numberOfLines={4}>{tile.caption}</Text>
                <View style={styles.gridBadge}>
                  <Feather name="message-circle" size={12} color="#FFF" />
                </View>
                <View style={styles.gridStatRow}>
                  <Feather name="play" size={11} color="#FFF" />
                  <Text style={styles.gridStatText}>{tile.stat}</Text>
                </View>
              </LinearGradient>
            )}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.noMore}>No more results</Text>

      {/* ─ Post on Story ─ */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16 },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },

  avatarWrap: { alignSelf: 'center', marginTop: 4, position: 'relative' },
  avatarRing: { width: 96, height: 96, borderRadius: 48, overflow: 'hidden' },
  avatar: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  avatarPlus: {
    position: 'absolute', bottom: 0, right: -2, width: 26, height: 26, borderRadius: 13,
    backgroundColor: primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: bg,
  },

  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 },
  brandName: { fontSize: 19, fontFamily: 'Inter_700Bold', color: fg },
  badgeEmoji: { fontSize: 13 },
  editBtn: { backgroundColor: pillBg, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  editBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: fg },
  brandHandle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: muted, textAlign: 'center', marginTop: 4 },

  statsRow: { flexDirection: 'row', justifyContent: 'center', gap: 36, marginTop: 20 },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 17, fontFamily: 'Inter_700Bold', color: fg },
  statLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: muted, marginTop: 2 },

  pillRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 18 },
  pillBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: pillBg, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  pillText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: fg },

  quickLinksRow: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 20 },
  quickLink: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quickLinkText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: fg },

  tabsRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 24, borderBottomWidth: 1, paddingBottom: 2 },
  tabItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemActive: { borderBottomColor: fg },

  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  gridTile: { width: '33.333%', aspectRatio: 0.78, padding: 1 },
  gridInner: { flex: 1, padding: 8, justifyContent: 'space-between' },
  draftsText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: muted, marginTop: 6 },
  gridCaption: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFF', lineHeight: 15 },
  gridBadge: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  gridStatRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gridStatText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#FFF' },

  noMore: { textAlign: 'center', fontSize: 12, fontFamily: 'Inter_400Regular', color: muted, paddingVertical: 22 },

  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },

  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },

  menuRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  menuIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium' },


});
