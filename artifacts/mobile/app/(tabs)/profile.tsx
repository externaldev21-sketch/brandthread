import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { getSellerPosts, subscribeSocial, type SellerThreadPost } from '@/services/socialService';
import { useApi } from '@/lib/api';

// ─── Design tokens ─────────────────────────────────────────────────────────

const BG     = '#07070F';
const CARD   = '#12121F';
const BORDER = 'rgba(255,255,255,0.07)';
const FG     = '#F4F4FF';
const MUTED  = 'rgba(244,244,255,0.50)';
const GREEN  = '#8B5CF6';
const GREEN_DIM = 'rgba(139,92,246,0.18)';

// ─── Mock data ──────────────────────────────────────────────────────────────

const PROFILE_STATS = [
  { label: 'Following', value: '53'      },
  { label: 'Followers', value: '2,842'   },
  { label: 'Likes',     value: '142.3K'  },
];

const QUICK_ACTIONS: { icon: keyof typeof Feather.glyphMap; label: string; route: string }[] = [
  { icon: 'video',      label: 'Create Post',   route: '/create-post' },
  { icon: 'tag',        label: 'Add Product',   route: '/add-product' },
  { icon: 'send',       label: 'New Campaign',  route: '/(tabs)/marketing' },
  { icon: 'user',       label: 'My Profile',    route: '/seller-profile?isOwner=true' },
];

const CONTENT_TABS = ['Posts', 'Drafts', 'Scheduled', 'Analytics'];

const SPARK_A = [30, 42, 38, 55, 48, 65, 58, 72, 66, 80, 74, 100];
const SPARK_B = [55, 62, 50, 70, 60, 78, 68, 85, 75, 90, 82, 98];
const SPARK_C = [40, 50, 44, 60, 52, 70, 60, 76, 68, 84, 76, 95];
const SPARK_D = [28, 38, 32, 48, 42, 58, 50, 66, 60, 76, 68, 90];

const PERF_STATS = [
  { label: 'Total Revenue',   value: '$83,491', change: '37.5%', spark: SPARK_A },
  { label: 'Visitors',        value: '98,241',  change: '19.6%', spark: SPARK_B },
  { label: 'Orders',          value: '1,892',   change: '24.1%', spark: SPARK_C },
  { label: 'Conversion Rate', value: '5.21%',   change: '8.3%',  spark: SPARK_D },
];

type GridTile =
  | { id: 'create' }
  | { id: string; caption: string; likes: string; comments: string; views: string; colors: [string, string] };

const GRID: GridTile[] = [
  { id: 'create' },
  { id: 'g1', caption: 'New drop this Friday. Are you ready?',    likes: '2.1k', comments: '243', views: '5.3k', colors: ['#4A3B7A', '#1E1540'] },
  { id: 'g2', caption: 'Vintage Wash Tee now available.',         likes: '1.8k', comments: '187', views: '4.2k', colors: ['#1F3A5F', '#0A1828'] },
  { id: 'g3', caption: 'Grind now, shine later.',                 likes: '1.2k', comments: '98',  views: '3.1k', colors: ['#3D1F0F', '#1A0A05'] },
  { id: 'g4', caption: 'Disrupt the industry.',                   likes: '2.4k', comments: '312', views: '6.8k', colors: ['#1A1A1A', '#0A0A0A'] },
  { id: 'g5', caption: 'Details matter.',                         likes: '900',  comments: '74',  views: '2.2k', colors: ['#1A1A1A', '#0D0D0D'] },
];

// ─── Mini sparkline ─────────────────────────────────────────────────────────

function MiniSparkline({ data, color, width, height = 36 }: { data: number[]; color: string; width: number; height?: number }) {
  if (data.length < 2) return null;
  const padY = 3;
  const plotH = height - padY * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => ({ x: i * stepX, y: padY + plotH - ((v - min) / range) * plotH }));
  const line = pts.reduce((a, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = pts[i - 1];
    const mx = (prev.x + p.x) / 2;
    return `${a} C ${mx} ${prev.y}, ${mx} ${p.y}, ${p.x} ${p.y}`;
  }, '');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <Svg width={width} height={height}>
      <Path d={area} fill={color} fillOpacity={0.15} />
      <Path d={line} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" />
      <Circle cx={last.x} cy={last.y} r={2.5} fill={color} />
    </Svg>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const api = useApi();
  const [activeTab, setActiveTab] = useState(0);
  const [sellerPosts, setSellerPosts] = useState<SellerThreadPost[]>([]);
  const [myStoryIds, setMyStoryIds] = useState<string[]>([]);

  const loadPosts = useCallback(async () => {
    try {
      const posts = await getSellerPosts();
      setSellerPosts(posts);
    } catch {}
  }, []);

  const loadMyStories = useCallback(async () => {
    try {
      const rows = await api.social.myStories();
      const now  = Date.now();
      const active = (Array.isArray(rows) ? rows : [])
        .filter((s: any) => s.expiresAt > now)
        .map((s: any) => s.id as string);
      setMyStoryIds(active);
    } catch {}
  }, [api]);

  useEffect(() => {
    loadPosts();
    loadMyStories();
    const unsub = subscribeSocial(() => { loadPosts(); loadMyStories(); });
    return unsub;
  }, [loadPosts, loadMyStories]);

  function nav(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  function openSettings() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    nav('/settings');
  }

  return (
    <ScrollView
      style={[s.root, { backgroundColor: BG }]}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>My Brand</Text>
          <Text style={s.headerSub}>Manage your brand, grow your audience, and scale your empire.</Text>
        </View>
        <View style={s.headerIcons}>
          <TouchableOpacity style={s.headerIconBtn} onPress={() => nav('/notifications-settings')} activeOpacity={0.75}>
            <Feather name="bell" size={18} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity style={s.headerIconBtn} onPress={() => nav('/settings')} activeOpacity={0.75}>
            <Feather name="settings" size={18} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Profile card */}
      <View style={s.profileCard}>
        {/* Avatar — story ring when active stories exist */}
        <View style={s.avatarSection}>
          {/* Tapping avatar views own stories (if any) or opens story creator */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (myStoryIds.length > 0) {
                router.push({
                  pathname: '/buyer-story-viewer' as any,
                  params: { storyId: myStoryIds[0], allStoryIds: myStoryIds.join(',') },
                });
              } else {
                router.push({ pathname: '/story-picker' as any, params: { accountType: 'seller' } });
              }
            }}
          >
            {/* Gradient ring when active story */}
            {myStoryIds.length > 0 ? (
              <LinearGradient
                colors={['#A855F7', '#8B5CF6', '#6D28D9']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.avatarGlow}
              >
                <View style={s.avatarRing}>
                  <View style={s.avatar}>
                    <BrandthreadLogo size={48} />
                  </View>
                </View>
              </LinearGradient>
            ) : (
              <View style={s.avatarGlow}>
                <View style={s.avatarRing}>
                  <View style={s.avatar}>
                    <BrandthreadLogo size={48} />
                  </View>
                </View>
              </View>
            )}
          </TouchableOpacity>

          {/* Camera button — change avatar photo */}
          <TouchableOpacity
            style={s.cameraBtn}
            activeOpacity={0.8}
            onPress={async () => {
              const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to update your brand avatar.'); return; }
              await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.85 });
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }}
          >
            <Feather name="camera" size={12} color={FG} />
          </TouchableOpacity>

          {/* Add Story "+" badge */}
          <TouchableOpacity
            style={s.addStoryBtn}
            activeOpacity={0.85}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push({ pathname: '/story-picker' as any, params: { accountType: 'seller' } });
            }}
          >
            <Feather name="plus" size={12} color={FG} />
          </TouchableOpacity>
        </View>

        {/* Name + verified + plan */}
        <View style={s.nameBlock}>
          <View style={s.nameRow}>
            <Text style={s.brandName}>Brandthread</Text>
            <Feather name="check-circle" size={17} color={GREEN} />
          </View>
          <Text style={s.brandHandle}>@brandthread</Text>
          <View style={s.planPill}>
            <Text style={s.planText}>Pro Plan</Text>
          </View>

          {/* Stats */}
          <View style={s.statsRow}>
            {PROFILE_STATS.map((st, i) => (
              <React.Fragment key={st.label}>
                {i > 0 && <View style={s.statDivider} />}
                <TouchableOpacity style={s.statItem} activeOpacity={0.7}>
                  <Text style={s.statValue}>{st.value}</Text>
                  <Text style={s.statLabel}>{st.label}</Text>
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </View>
        </View>
      </View>

      {/* Quick Actions */}
      <View style={s.quickRow}>
        {QUICK_ACTIONS.map((qa) => (
          <TouchableOpacity key={qa.label} style={s.quickItem} activeOpacity={0.75} onPress={() => nav(qa.route)}>
            <View style={s.quickIconBox}>
              <Feather name={qa.icon} size={18} color={GREEN} />
            </View>
            <Text style={s.quickLabel}>{qa.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content Tabs */}
      <View style={s.tabsBar}>
        {CONTENT_TABS.map((tab, i) => {
          const active = activeTab === i;
          const icons: (keyof typeof Feather.glyphMap)[] = ['grid', 'file-text', 'clock', 'bar-chart-2'];
          return (
            <TouchableOpacity
              key={tab}
              style={[s.tabItem, active && s.tabItemActive]}
              activeOpacity={0.75}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveTab(i); }}
            >
              <Feather name={icons[i]} size={13} color={active ? GREEN : MUTED} />
              <Text style={[s.tabLabel, active && s.tabLabelActive]}>{tab}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content grid */}
      <View style={s.grid}>
        {/* Create Post tile — always first */}
        <TouchableOpacity
          style={s.gridTile}
          activeOpacity={0.85}
          onPress={() => nav('/create-post')}
        >
          <View style={s.createTile}>
            <View style={s.createPlus}>
              <Feather name="plus" size={20} color={MUTED} />
            </View>
            <Text style={s.createTitle}>Create Post</Text>
            <Text style={s.createSub}>Share something with{'\n'}your audience</Text>
          </View>
        </TouchableOpacity>

        {/* Real seller posts — filtered by tab */}
        {sellerPosts
          .filter(p => {
            if (activeTab === 0) return !p.isDraft && !p.isArchived;
            if (activeTab === 1) return p.isDraft && !p.isArchived;
            if (activeTab === 2) return !p.isDraft && !p.isArchived && !!p.scheduledAt;
            return false; // Analytics tab has no grid items
          })
          .map(post => (
            <TouchableOpacity
              key={post.id}
              style={s.gridTile}
              activeOpacity={0.85}
            >
              <LinearGradient colors={['#4A3B7A', '#1E1540']} style={s.gridInner}>
                <View style={[s.gridMenuBtn, { opacity: 0.7 }]}>
                  <Feather name={post.contentType === 'video' ? 'video' : 'image'} size={11} color="#FFF" />
                </View>
                <Text style={s.gridCaption} numberOfLines={3}>{post.caption || '(No caption)'}</Text>
                <View style={s.gridStatRow}>
                  <Feather name="clock" size={10} color="#FFFFFF99" />
                  <Text style={s.gridStat}>{new Date(post.createdAt).toLocaleDateString()}</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ))
        }

        {/* Empty state for tabs when no posts */}
        {activeTab !== 3 && sellerPosts.filter(p => {
          if (activeTab === 0) return !p.isDraft && !p.isArchived;
          if (activeTab === 1) return p.isDraft && !p.isArchived;
          if (activeTab === 2) return !p.isDraft && !p.isArchived && !!p.scheduledAt;
          return false;
        }).length === 0 && (
          <View style={s.emptyState}>
            <Feather name="inbox" size={24} color={MUTED} />
            <Text style={s.emptyText}>
              {activeTab === 0 ? 'No posts yet. Create your first post!' :
               activeTab === 1 ? 'No drafts saved.' :
               'No scheduled posts.'}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header:         { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 20, gap: 12 },
  headerTitle:    { fontSize: 22, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 4 },
  headerSub:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 17, maxWidth: 220 },
  headerIcons:    { flexDirection: 'row', gap: 8, marginTop: 2 },
  headerIconBtn:  { width: 38, height: 38, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },

  // Profile card
  profileCard:    { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, marginBottom: 20, gap: 16 },

  // Avatar
  avatarSection:  { position: 'relative' },
  avatarGlow:     { width: 88, height: 88, borderRadius: 44, padding: 3, backgroundColor: GREEN, shadowColor: GREEN, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 14, elevation: 12 },
  avatarRing:     { flex: 1, borderRadius: 42, overflow: 'hidden', backgroundColor: BG, padding: 3 },
  avatar:         { flex: 1, borderRadius: 39, backgroundColor: '#18182E', alignItems: 'center', justifyContent: 'center' },
  avatarText:     { fontSize: 30, fontFamily: 'Inter_700Bold', color: GREEN },
  cameraBtn:      { position: 'absolute', bottom: 0, right: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: '#333', borderWidth: 2, borderColor: BG, alignItems: 'center', justifyContent: 'center' },
  addStoryBtn:    { position: 'absolute', bottom: 0, left: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: '#8B5CF6', borderWidth: 2, borderColor: BG, alignItems: 'center', justifyContent: 'center' },

  // Name
  nameBlock:      { flex: 1, paddingTop: 4 },
  nameRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  brandName:      { fontSize: 18, fontFamily: 'Inter_700Bold', color: FG },
  brandHandle:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 8 },
  planPill:       { alignSelf: 'flex-start', backgroundColor: GREEN_DIM, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 14 },
  planText:       { fontSize: 11, fontFamily: 'Inter_700Bold', color: GREEN },

  // Stats
  statsRow:       { flexDirection: 'row', alignItems: 'center', gap: 0 },
  statDivider:    { width: 1, height: 28, backgroundColor: BORDER, marginHorizontal: 14 },
  statItem:       { alignItems: 'flex-start' },
  statValue:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  statLabel:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },

  // Quick actions
  quickRow:       { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 16, paddingVertical: 4, backgroundColor: CARD, borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER, marginBottom: 24 },
  quickItem:      { alignItems: 'center', paddingVertical: 14, gap: 6 },
  quickIconBox:   { width: 44, height: 44, borderRadius: 12, backgroundColor: GREEN_DIM, alignItems: 'center', justifyContent: 'center' },
  quickLabel:     { fontSize: 11, fontFamily: 'Inter_500Medium', color: FG, textAlign: 'center' },

  // Section
  section:        { paddingHorizontal: 20, marginBottom: 20 },
  sectionHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle:   { fontSize: 17, fontFamily: 'Inter_700Bold', color: FG },
  weekPill:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  weekPillText:   { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: FG },
  viewReport:     { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: GREEN },

  // Performance grid
  perfGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  perfCard:       { width: '48.5%', backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14 },
  perfLabel:      { fontSize: 11, fontFamily: 'Inter_500Medium', color: MUTED, marginBottom: 6 },
  perfValueRow:   { flexDirection: 'row', alignItems: 'baseline', marginBottom: 8 },
  perfValue:      { fontSize: 18, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.3 },
  perfChange:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: GREEN },

  // Brand Health
  healthCard:     { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(139,92,246,0.45)' },
  healthGradient: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  healthCircle:   { width: 52, height: 52, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  healthScore:    { position: 'absolute', fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  healthTitle:    { fontSize: 17, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 4 },
  healthDesc:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },

  // Content tabs
  tabsBar:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, marginBottom: 1 },
  tabItem:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemActive:  { borderBottomColor: GREEN },
  tabLabel:       { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  tabLabelActive: { color: FG, fontFamily: 'Inter_600SemiBold' },

  // Grid
  grid:           { flexDirection: 'row', flexWrap: 'wrap' },
  gridTile:       { width: '33.333%', aspectRatio: 0.78, padding: 1 },
  createTile:     { flex: 1, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12 },
  createPlus:     { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  createTitle:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: FG, textAlign: 'center' },
  createSub:      { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', lineHeight: 14 },
  gridInner:      { flex: 1, padding: 8, justifyContent: 'space-between' },
  gridMenuBtn:    { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  gridCaption:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFF', lineHeight: 14, marginTop: 4 },
  gridStatRow:    { flexDirection: 'row', alignItems: 'center', gap: 3 },
  gridStat:       { fontSize: 10, fontFamily: 'Inter_500Medium', color: '#FFFFFF99' },
  emptyState:     { width: '100%', alignItems: 'center', padding: 24, gap: 8 },
  emptyText:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center' },
});
