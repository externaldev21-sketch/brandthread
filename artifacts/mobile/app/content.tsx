import React, { useState } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Alert, Platform, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { DEMO_CONTENT } from '@/services/data';
import type { ContentPost, ContentType, ContentStatus } from '@/services/types';

const BG     = '#0A0B0A';
const CARD   = '#111311';
const BORDER = '#1E221E';
const FG     = '#EAF2ED';
const MUTED  = '#5A6B5C';
const GREEN  = '#39FF88';
const PURPLE = '#8B5CF6';
const BLUE   = '#3B82F6';
const ORANGE = '#F97316';
const CYAN   = '#06B6D4';

type FilterTab = 'all' | 'draft' | 'scheduled' | 'published';

const CONTENT_TYPES: { type: ContentType; label: string; icon: keyof typeof Feather.glyphMap; color: string }[] = [
  { type: 'video',        label: 'Video Post',      icon: 'video',        color: PURPLE },
  { type: 'image',        label: 'Image Post',      icon: 'image',        color: BLUE   },
  { type: 'slideshow',    label: 'Slideshow',       icon: 'layers',       color: CYAN   },
  { type: 'story',        label: 'Story',           icon: 'circle',       color: ORANGE },
  { type: 'announcement', label: 'Announcement',    icon: 'bell',         color: GREEN  },
  { type: 'countdown',    label: 'Drop Countdown',  icon: 'clock',        color: '#FBBF24' },
  { type: 'behind_scenes',label: 'Behind Scenes',   icon: 'camera',       color: '#EC4899' },
  { type: 'poll',         label: 'Poll',            icon: 'bar-chart-2',  color: BLUE   },
];

function statusColor(s: ContentStatus): string {
  switch (s) {
    case 'published':  return GREEN;
    case 'scheduled':  return BLUE;
    case 'draft':      return MUTED;
  }
}

function typeIcon(t: ContentType): keyof typeof Feather.glyphMap {
  const map: Record<ContentType, keyof typeof Feather.glyphMap> = {
    video: 'video', image: 'image', slideshow: 'layers', story: 'circle',
    announcement: 'bell', countdown: 'clock', behind_scenes: 'camera', poll: 'bar-chart-2',
  };
  return map[t];
}

export default function ContentScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const topPad  = Platform.OS === 'web' ? 20 : insets.top;

  const [tab, setTab] = useState<FilterTab>('all');

  function back() { router.back(); }

  const posts = DEMO_CONTENT.filter(p => tab === 'all' || p.status === tab);

  const stats = {
    published: DEMO_CONTENT.filter(p => p.status === 'published').length,
    scheduled:  DEMO_CONTENT.filter(p => p.status === 'scheduled').length,
    drafts:     DEMO_CONTENT.filter(p => p.status === 'draft').length,
    totalViews: DEMO_CONTENT.reduce((s, p) => s + p.views, 0),
  };

  function createPost(type: ContentType) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(('/create-post?type=' + type) as never);
  }

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={back}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Content</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            style={s.analyticsBtn}
            onPress={() => router.push('/(tabs)/analytics' as never)}
            activeOpacity={0.8}
          >
            <Feather name="bar-chart-2" size={17} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.createBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/create-post' as never); }}
            activeOpacity={0.85}
          >
            <Feather name="plus" size={15} color="#0A0B0A" />
            <Text style={s.createText}>Create</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Stats strip */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          <View style={s.statsRow}>
            {[
              { label: 'Published',  value: stats.published,                             color: GREEN  },
              { label: 'Scheduled',  value: stats.scheduled,                             color: BLUE   },
              { label: 'Drafts',     value: stats.drafts,                                color: ORANGE },
              { label: 'Total Views',value: (stats.totalViews / 1000).toFixed(1) + 'K', color: PURPLE, isStr: true },
            ].map(item => (
              <View key={item.label} style={s.statCard}>
                <Text style={[s.statValue, { color: item.color }]}>{item.value}</Text>
                <Text style={s.statLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Create options */}
        {(
          <View style={s.section}>
            <Text style={s.sectionTitle}>Create new</Text>
            <View style={s.typeGrid}>
              {CONTENT_TYPES.map(ct => (
                <TouchableOpacity
                  key={ct.type}
                  style={s.typeCard}
                  onPress={() => createPost(ct.type)}
                  activeOpacity={0.8}
                >
                  <View style={[s.typeIcon, { backgroundColor: ct.color + '20' }]}>
                    <Feather name={ct.icon} size={18} color={ct.color} />
                  </View>
                  <Text style={s.typeLabel}>{ct.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Filter tabs */}
        <View style={s.filterRow}>
          {(['all', 'published', 'scheduled', 'draft'] as FilterTab[]).map(t => (
            <TouchableOpacity
              key={t}
              style={[s.filterTab, tab === t && s.filterTabActive]}
              onPress={() => { setTab(t); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Text style={[s.filterText, tab === t && s.filterTextActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Content library */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Content library</Text>
          {posts.length === 0 ? (
            <View style={s.empty}>
              <Feather name="video" size={32} color={MUTED} />
              <Text style={s.emptyTitle}>No {tab === 'all' ? '' : tab} posts yet</Text>
              <Text style={s.emptyDesc}>Create content to engage your audience.</Text>
            </View>
          ) : (
            posts.map(post => (
              <TouchableOpacity key={post.id} style={s.postCard} activeOpacity={0.82}>
                <View style={s.postThumb}>
                  <Feather name={typeIcon(post.type)} size={20} color={MUTED} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={s.postTopRow}>
                    <View style={[s.statusBadge, { backgroundColor: statusColor(post.status) + '22', borderColor: statusColor(post.status) + '44' }]}>
                      <Text style={[s.statusText, { color: statusColor(post.status) }]}>
                        {post.status.charAt(0).toUpperCase() + post.status.slice(1)}
                      </Text>
                    </View>
                    <Text style={s.postType}>{post.type.replace('_', ' ')}</Text>
                  </View>
                  <Text style={s.postCaption} numberOfLines={2}>{post.caption}</Text>
                  {post.status === 'published' && (
                    <View style={s.postMetrics}>
                      <View style={s.metric}>
                        <Feather name="eye"    size={11} color={MUTED} />
                        <Text style={s.metricText}>{(post.views / 1000).toFixed(1)}K</Text>
                      </View>
                      <View style={s.metric}>
                        <Feather name="heart"  size={11} color={MUTED} />
                        <Text style={s.metricText}>{post.likes.toLocaleString()}</Text>
                      </View>
                      <View style={s.metric}>
                        <Feather name="message-circle" size={11} color={MUTED} />
                        <Text style={s.metricText}>{post.comments}</Text>
                      </View>
                      <View style={s.metric}>
                        <Feather name="bookmark" size={11} color={MUTED} />
                        <Text style={s.metricText}>{post.saves}</Text>
                      </View>
                    </View>
                  )}
                  {post.status === 'scheduled' && post.scheduledFor && (
                    <Text style={s.scheduledText}>Scheduled: {post.scheduledFor}</Text>
                  )}
                </View>
                <Feather name="more-horizontal" size={16} color={MUTED} />
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
      <AIBrainFAB context={{ screen: 'content' as const }} bottomOffset={0} />
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },
  header:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  title:   { flex: 1, fontSize: 22, fontFamily: 'Inter_700Bold', color: FG },
  analyticsBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  createBtn:{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  createText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  statCard: { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', minWidth: 84 },
  statValue:{ fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel:{ fontSize: 10, fontFamily: 'Inter_500Medium', color: MUTED, marginTop: 2 },
  section:  { paddingHorizontal: 16, marginTop: 16 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 12 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeCard: { width: '22.5%', backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, alignItems: 'center', paddingVertical: 14, gap: 8 },
  typeIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  typeLabel:{ fontSize: 9, fontFamily: 'Inter_500Medium', color: MUTED, textAlign: 'center' },
  filterRow:{ flexDirection: 'row', gap: 6, paddingHorizontal: 16, marginTop: 16, marginBottom: 4 },
  filterTab:{ backgroundColor: CARD, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: BORDER },
  filterTabActive: { backgroundColor: GREEN + '22', borderColor: GREEN },
  filterText:{ fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  filterTextActive: { color: GREEN },
  postCard:  { flexDirection: 'row', gap: 12, backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14, marginBottom: 10 },
  postThumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#1A1E1A', alignItems: 'center', justifyContent: 'center' },
  postTopRow:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge:{ borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  statusText:{ fontSize: 9, fontFamily: 'Inter_700Bold' },
  postType:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, textTransform: 'capitalize' },
  postCaption: { fontSize: 12, fontFamily: 'Inter_400Regular', color: FG, lineHeight: 17 },
  postMetrics: { flexDirection: 'row', gap: 12 },
  metric:    { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metricText:{ fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  scheduledText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: BLUE },
  empty:     { alignItems: 'center', paddingVertical: 36, gap: 8 },
  emptyTitle:{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },
  emptyDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
});

