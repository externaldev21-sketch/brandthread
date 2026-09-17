import React, { useCallback, useEffect, useState } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import type { ContentPost, ContentType, ContentStatus } from '@/services/types';
import {
  archiveSellerPost, deleteSellerPost, getSellerPosts, updateSellerPost,
} from '@/services/socialService';
import { useColors } from '@/hooks/useColors';

const BG     = '#0A0A0B';
const CARD   = '#18181B';
const BORDER = 'rgba(255,255,255,0.07)';
const FG     = '#F4F4FF';
const MUTED  = 'rgba(244,244,255,0.50)';
const GREEN  = '#22C55E';
const BLUE   = '#D4D4D8';
const ORANGE = '#F97316';
type FilterTab = 'all' | ContentStatus;

const getContentTypes = (primary: string, secondary: string): { type: ContentType; label: string; icon: keyof typeof Feather.glyphMap; color: string }[] => [
  { type: 'video',        label: 'Video Post',      icon: 'video',        color: primary },
  { type: 'image',        label: 'Image Post',      icon: 'image',        color: BLUE   },
  { type: 'slideshow',    label: 'Slideshow',       icon: 'layers',       color: secondary },
  { type: 'story',        label: 'Story',           icon: 'circle',       color: ORANGE },
  { type: 'announcement', label: 'Announcement',    icon: 'bell',         color: GREEN  },
  { type: 'countdown',    label: 'Drop Countdown',  icon: 'clock',        color: '#FBBF24' },
  { type: 'behind_scenes',label: 'Behind Scenes',   icon: 'camera',       color: secondary },
  { type: 'poll',         label: 'Poll',            icon: 'bar-chart-2',  color: BLUE   },
];

function statusColor(s: ContentStatus): string {
  switch (s) {
    case 'published':  return GREEN;
    case 'scheduled':  return BLUE;
    case 'draft':      return MUTED;
    case 'archived':   return ORANGE;
  }
}

function typeIcon(t: ContentType): keyof typeof Feather.glyphMap {
  const map: Record<ContentType, keyof typeof Feather.glyphMap> = {
    video: 'video', image: 'image', slideshow: 'layers', story: 'circle',
    announcement: 'bell', countdown: 'clock', behind_scenes: 'camera', poll: 'bar-chart-2',
  };
  return map[t];
}

const VALID_TABS: FilterTab[] = ['all', 'published', 'scheduled', 'draft', 'archived'];

export default function ContentScreen() {
  const colors = useColors();
  const contentTypes = React.useMemo(() => getContentTypes(colors.primary, colors.info), [colors.primary, colors.info]);
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const topPad  = Platform.OS === 'web' ? 20 : insets.top;

  // Read optional tab query param (e.g. from /content?tab=draft)
  const params  = useLocalSearchParams<{ tab?: string }>();
  const initialTab: FilterTab = (
    params.tab && VALID_TABS.includes(params.tab as FilterTab)
      ? params.tab as FilterTab
      : 'all'
  );

  const [tab, setTab] = useState<FilterTab>(initialTab);

  // Keep tab in sync if the route param changes (e.g. router.replace('/content?tab=draft'))
  useEffect(() => {
    if (params.tab && VALID_TABS.includes(params.tab as FilterTab)) {
      setTab(params.tab as FilterTab);
    }
  }, [params.tab]);

  const [content, setContent] = useState<ContentPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);

  function back() { router.back(); }

  const loadContent = useCallback(async () => {
    setLoading(true);
    try {
      const posts = await getSellerPosts();
      setContent(posts.map((post): ContentPost => ({
        id: post.id,
        type: post.contentType as ContentType,
        status: post.postStatus === 'archived'
          ? 'archived'
          : post.postStatus === 'scheduled'
            ? 'scheduled'
            : post.isDraft
              ? 'draft'
              : 'published',
        caption: post.caption,
        hashtags: post.hashtags,
        scheduledFor: post.scheduledAt ?? undefined,
        publishedAt: post.publishedAt,
        views: 0,
        likes: post.likesCount,
        comments: post.commentsCount,
        saves: post.savedCount,
        shares: post.repostsCount,
        productTags: post.productTags.map(tag => tag.productName),
      })));
    } catch {
      setContent([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadContent(); }, [loadContent]);

  const posts = content.filter(p => tab === 'all' || p.status === tab);

  const stats = {
    published: content.filter(p => p.status === 'published').length,
    scheduled: content.filter(p => p.status === 'scheduled').length,
    drafts:    content.filter(p => p.status === 'draft').length,
    archived:  content.filter(p => p.status === 'archived').length,
  };

  function createPost(type: ContentType) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(('/create-post?type=' + type) as never);
  }

  function openPostActions(post: ContentPost) {
    Haptics.selectionAsync();
    Alert.alert('Manage post', post.caption || 'Untitled post', [
      {
        text: 'Edit',
        onPress: () => router.push(('/create-post?editId=' + encodeURIComponent(post.id)) as never),
      },
      {
        text: post.status === 'archived' ? 'Restore' : 'Archive',
        onPress: async () => {
          setDeletingPostId(post.id);
          try {
            if (post.status === 'archived') {
              await updateSellerPost(post.id, {
                postStatus: 'published',
                isArchived: false,
                scheduledAt: null,
              });
              setContent(current => current.map(item => (
                item.id === post.id ? { ...item, status: 'published' } : item
              )));
            } else {
              await archiveSellerPost(post.id);
              setContent(current => current.map(item => (
                item.id === post.id ? { ...item, status: 'archived' } : item
              )));
            }
          } catch {
            Alert.alert(
              post.status === 'archived' ? 'Post not restored' : 'Post not archived',
              'Check your connection and try again.',
            );
          } finally {
            setDeletingPostId(null);
          }
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => Alert.alert(
          'Delete this post?',
          'It will be removed from your content library and will no longer appear to buyers.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                setDeletingPostId(post.id);
                try {
                  await deleteSellerPost(post.id);
                  setContent(current => current.filter(item => item.id !== post.id));
                } catch {
                  Alert.alert('Post not deleted', 'Check your connection and try again.');
                } finally {
                  setDeletingPostId(null);
                }
              },
            },
          ],
        ),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
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
            style={[s.createBtn, { backgroundColor: colors.primary }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/create-post' as never); }}
            activeOpacity={0.85}
          >
            <Feather name="plus" size={15} color="#FFFFFF" />
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
              { label: 'Archived',   value: stats.archived,                              color: MUTED },
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
              {contentTypes.map(ct => (
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
          {(['all', 'published', 'scheduled', 'draft', 'archived'] as FilterTab[]).map(t => (
            <TouchableOpacity
              key={t}
              style={[s.filterTab, tab === t && [s.filterTabActive, { backgroundColor: colors.accent, borderColor: colors.primary }]]}
              onPress={() => { setTab(t); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Text style={[s.filterText, tab === t && [s.filterTextActive, { color: colors.primary }]]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Content library */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Content library</Text>
          {loading ? (
            <View style={s.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={s.loadingText}>Loading your content…</Text>
            </View>
          ) : posts.length === 0 ? (
            <View style={s.empty}>
              <Feather name="video" size={32} color={MUTED} />
              <Text style={s.emptyTitle}>No {tab === 'all' ? '' : tab} posts yet</Text>
              <Text style={s.emptyDesc}>Create content to engage your audience.</Text>
            </View>
          ) : (
            posts.map(post => (
              <TouchableOpacity
                key={post.id}
                style={s.postCard}
                activeOpacity={0.82}
                onPress={() => router.push(('/post-analytics?id=' + encodeURIComponent(post.id)) as never)}
              >
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
                        <Feather name="heart"  size={11} color={MUTED} />
                        <Text style={s.metricText}>{post.likes.toLocaleString()}</Text>
                      </View>
                      <View style={s.metric}>
                        <Feather name="message-circle" size={11} color={MUTED} />
                        <Text style={s.metricText}>{post.comments}</Text>
                      </View>
                    </View>
                  )}
                  {post.status === 'scheduled' && post.scheduledFor && (
                    <Text style={s.scheduledText}>Scheduled: {post.scheduledFor}</Text>
                  )}
                </View>
                <TouchableOpacity
                  style={s.moreBtn}
                  onPress={() => openPostActions(post)}
                  disabled={deletingPostId === post.id}
                  accessibilityRole="button"
                  accessibilityLabel="Manage post"
                >
                  {deletingPostId === post.id
                    ? <ActivityIndicator size="small" color={MUTED} />
                    : <Feather name="more-horizontal" size={16} color={MUTED} />}
                </TouchableOpacity>
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
  root:    { flex: 1, backgroundColor: 'transparent' },
  header:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  title:   { flex: 1, fontSize: 22, fontFamily: 'Inter_700Bold', color: FG },
  analyticsBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  createBtn:{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  createText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
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
  moreBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  postThumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#18181B', alignItems: 'center', justifyContent: 'center' },
  postTopRow:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge:{ borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  statusText:{ fontSize: 9, fontFamily: 'Inter_700Bold' },
  postType:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, textTransform: 'capitalize' },
  postCaption: { fontSize: 12, fontFamily: 'Inter_400Regular', color: FG, lineHeight: 17 },
  postMetrics: { flexDirection: 'row', gap: 12 },
  metric:    { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metricText:{ fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  scheduledText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: BLUE },
  loading: { alignItems: 'center', paddingVertical: 36, gap: 10 },
  loadingText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  empty:     { alignItems: 'center', paddingVertical: 36, gap: 8 },
  emptyTitle:{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },
  emptyDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
});

