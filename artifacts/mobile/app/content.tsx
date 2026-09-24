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
import { FS } from '@/lib/theme';

type FilterTab = 'all' | ContentStatus;

// Only types that create-post.tsx actually supports today. See docs/polish/punch-list.md
// ("Seller: create post, AI, analytics & finance" — content.tsx item) for why the rest were cut.
const getContentTypes = (primary: string, secondary: string, colors: ReturnType<typeof useColors>): { type: ContentType; label: string; icon: keyof typeof Feather.glyphMap; color: string }[] => [
  { type: 'video',        label: 'Video Post',      icon: 'video',        color: primary },
  { type: 'image',        label: 'Image Post',      icon: 'image',        color: colors.subtle },
];

function formatScheduledDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusColor(s: ContentStatus, colors: ReturnType<typeof useColors>): string {
  switch (s) {
    case 'published':  return colors.success;
    case 'scheduled':  return colors.info;
    case 'draft':      return colors.mutedForeground;
    case 'archived':   return colors.warning;
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
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const contentTypes = React.useMemo(() => getContentTypes(colors.primary, colors.info, colors), [colors]);
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
        <Feather name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.title}>Content</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            style={s.analyticsBtn}
            onPress={() => router.push('/(tabs)/analytics' as never)}
            activeOpacity={0.8}
          >
            <Feather name="bar-chart-2" size={17} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.createBtn, { backgroundColor: colors.primary }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/create-post' as never); }}
            activeOpacity={0.85}
          >
             <Feather name="plus" size={15} color={colors.primaryForeground} />
            <Text style={s.createText}>Create</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Stats strip */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          <View style={s.statsRow}>
            {[
               { label: 'Published',  value: stats.published, color: colors.success },
               { label: 'Scheduled',  value: stats.scheduled, color: colors.info },
               { label: 'Drafts',     value: stats.drafts, color: colors.warning },
               { label: 'Archived',   value: stats.archived, color: colors.mutedForeground },
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
               <Feather name="video" size={32} color={colors.mutedForeground} />
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
                     <Feather name={typeIcon(post.type)} size={20} color={colors.mutedForeground} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={s.postTopRow}>
                     <View style={[s.statusBadge, { backgroundColor: statusColor(post.status, colors) + '22', borderColor: statusColor(post.status, colors) + '44' }]}>
                       <Text style={[s.statusText, { color: statusColor(post.status, colors) }]}>
                        {post.status.charAt(0).toUpperCase() + post.status.slice(1)}
                      </Text>
                    </View>
                    <Text style={s.postType}>{post.type.replace('_', ' ')}</Text>
                  </View>
                  <Text style={s.postCaption} numberOfLines={2}>{post.caption}</Text>
                  {post.status === 'published' && (
                    <View style={s.postMetrics}>
                      <View style={s.metric}>
                         <Feather name="heart"  size={11} color={colors.mutedForeground} />
                        <Text style={s.metricText}>{post.likes.toLocaleString()}</Text>
                      </View>
                      <View style={s.metric}>
                         <Feather name="message-circle" size={11} color={colors.mutedForeground} />
                        <Text style={s.metricText}>{post.comments}</Text>
                      </View>
                    </View>
                  )}
                  {post.status === 'scheduled' && post.scheduledFor && (
                    <Text style={s.scheduledText}>Goes live {formatScheduledDate(post.scheduledFor)}</Text>
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
                     ? <ActivityIndicator size="small" color={colors.mutedForeground} />
                     : <Feather name="more-horizontal" size={16} color={colors.mutedForeground} />}
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

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  header:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  title:   { flex: 1, fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.text },
  analyticsBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  createBtn:{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.success, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  createText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primaryForeground },
  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  statCard: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', minWidth: 84 },
  statValue:{ fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel:{ fontSize: FS.xs, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, marginTop: 2 },
  section:  { paddingHorizontal: 16, marginTop: 16 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.text, marginBottom: 12 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeCard: { width: '22.5%', backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', paddingVertical: 14, gap: 8 },
  typeIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  typeLabel:{ fontSize: FS.xs, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, textAlign: 'center' },
  filterRow:{ flexDirection: 'row', gap: 6, paddingHorizontal: 16, marginTop: 16, marginBottom: 4 },
  filterTab:{ backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: colors.border },
  filterTabActive: { backgroundColor: colors.accent + '22', borderColor: colors.primary },
  filterText:{ fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.mutedForeground },
  filterTextActive: { color: colors.primary },
  postCard:  { flexDirection: 'row', gap: 12, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  moreBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  postThumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  postTopRow:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge:{ borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  statusText:{ fontSize: FS.xs, fontFamily: 'Inter_700Bold' },
  postType:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textTransform: 'capitalize' },
  postCaption: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.text, lineHeight: 17 },
  postMetrics: { flexDirection: 'row', gap: 12 },
  metric:    { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metricText:{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground },
  scheduledText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: colors.info },
  loading: { alignItems: 'center', paddingVertical: 36, gap: 10 },
  loadingText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground },
  empty:     { alignItems: 'center', paddingVertical: 36, gap: 8 },
  emptyTitle:{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.text },
  emptyDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground },
});

