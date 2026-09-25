import React, { useCallback, useEffect, useState } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import type { ContentPost, ContentType, ContentStatus } from '@/services/types';
import {
  archiveSellerPost, deleteSellerPost, getSellerPosts, updateSellerPost,
} from '@/services/socialService';
import { useColors } from '@/hooks/useColors';
import { Header } from '@/components/layout';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';

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
  const router  = useRouter();

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

  const tabLabel = tab === 'all' ? '' : `${tab} `;

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <Header
        title="Content"
        actions={[
          { icon: 'bar-chart-2', onPress: () => router.push('/(tabs)/analytics' as never), accessibilityLabel: 'View analytics' },
          {
            icon: 'plus',
            onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/create-post' as never); },
            accessibilityLabel: 'Create a new post',
          },
        ]}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        {/* Overview stats */}
        <View style={s.statsRow}>
          {[
            { label: 'Published', value: stats.published, color: colors.success },
            { label: 'Scheduled', value: stats.scheduled, color: colors.info },
            { label: 'Drafts',    value: stats.drafts,    color: colors.warning },
            { label: 'Archived',  value: stats.archived,  color: colors.mutedForeground },
          ].map(item => (
            <View key={item.label} style={[s.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[s.statValue, { color: item.color }]}>{item.value}</Text>
              <Text style={[s.statLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
            </View>
          ))}
        </View>

        {/* Create new */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: colors.foreground }]}>Create new</Text>
          <View style={s.typeGrid}>
            {contentTypes.map(ct => (
              <TouchableOpacity
                key={ct.type}
                style={[s.typeCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => createPost(ct.type)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Create a ${ct.label}`}
              >
                <View style={[s.typeIcon, { backgroundColor: ct.color + '20' }]}>
                  <Feather name={ct.icon} size={ICON.md} color={ct.color} />
                </View>
                <Text style={[s.typeLabel, { color: colors.foreground }]}>{ct.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Content library */}
        <View style={[s.section, s.librarySection]}>
          <View style={s.libraryHeaderRow}>
            <Text style={[s.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Content library</Text>
            <Text style={[s.libraryCount, { color: colors.mutedForeground }]}>
              {posts.length} {posts.length === 1 ? 'post' : 'posts'}
            </Text>
          </View>

          {/* Filter tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.filterScroll}
            contentContainerStyle={s.filterRow}
          >
            {VALID_TABS.map(t => (
              <TouchableOpacity
                key={t}
                style={[
                  s.filterTab,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  tab === t && { backgroundColor: colors.accent, borderColor: colors.primary },
                ]}
                onPress={() => { setTab(t); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: tab === t }}
              >
                <Text style={[
                  s.filterText,
                  { color: colors.mutedForeground },
                  tab === t && { color: colors.primary, fontFamily: FONT.semibold },
                ]}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {loading ? (
            <View style={s.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[s.loadingText, { color: colors.mutedForeground }]}>Loading your content…</Text>
            </View>
          ) : posts.length === 0 ? (
            <View style={s.empty}>
              <View style={[s.emptyIconWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="video" size={ICON.lg} color={colors.mutedForeground} />
              </View>
              <Text style={[s.emptyTitle, { color: colors.foreground }]}>No {tabLabel}posts yet</Text>
              <Text style={[s.emptyDesc, { color: colors.mutedForeground }]}>Create content to engage your audience.</Text>
            </View>
          ) : (
            <View style={s.postList}>
              {posts.map(post => (
                <TouchableOpacity
                  key={post.id}
                  style={[s.postCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  activeOpacity={0.82}
                  onPress={() => router.push(('/post-analytics?id=' + encodeURIComponent(post.id)) as never)}
                  accessibilityRole="button"
                  accessibilityLabel={post.caption || 'Untitled post'}
                >
                  <View style={[s.postThumb, { backgroundColor: colors.elevated }]}>
                    <Feather name={typeIcon(post.type)} size={ICON.md} color={colors.mutedForeground} />
                  </View>
                  <View style={s.postBody}>
                    <View style={s.postTopRow}>
                      <View style={[
                        s.statusBadge,
                        { backgroundColor: statusColor(post.status, colors) + '22', borderColor: statusColor(post.status, colors) + '44' },
                      ]}>
                        <Text style={[s.statusText, { color: statusColor(post.status, colors) }]}>
                          {post.status.charAt(0).toUpperCase() + post.status.slice(1)}
                        </Text>
                      </View>
                      <Text style={[s.postType, { color: colors.mutedForeground }]}>{post.type.replace('_', ' ')}</Text>
                    </View>
                    <Text style={[s.postCaption, { color: colors.foreground }]} numberOfLines={2}>{post.caption}</Text>
                    {post.status === 'published' && (
                      <View style={s.postMetrics}>
                        <View style={s.metric}>
                          <Feather name="heart" size={ICON.xs - 3} color={colors.mutedForeground} />
                          <Text style={[s.metricText, { color: colors.mutedForeground }]}>{post.likes.toLocaleString()}</Text>
                        </View>
                        <View style={s.metric}>
                          <Feather name="message-circle" size={ICON.xs - 3} color={colors.mutedForeground} />
                          <Text style={[s.metricText, { color: colors.mutedForeground }]}>{post.comments}</Text>
                        </View>
                      </View>
                    )}
                    {post.status === 'scheduled' && post.scheduledFor && (
                      <Text style={[s.scheduledText, { color: colors.info }]}>Goes live {formatScheduledDate(post.scheduledFor)}</Text>
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
                      : <Feather name="more-horizontal" size={ICON.sm} color={colors.mutedForeground} />}
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      <AIBrainFAB context={{ screen: 'content' as const }} bottomOffset={0} />
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { paddingBottom: SP.xxl * 2 },

  // Overview stats
  statsRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.xs },
  statCard: {
    flex: 1, borderRadius: RADIUS.md, borderWidth: 1,
    paddingVertical: SP.sm + 2, alignItems: 'center', gap: 2,
  },
  statValue: { fontSize: FS.lg, fontFamily: FONT.bold },
  statLabel: { fontSize: FS.xs, fontFamily: FONT.medium },

  // Sections
  section: { paddingHorizontal: SP.md, marginTop: SP.lg },
  librarySection: { marginTop: SP.xl },
  sectionTitle: { fontSize: FS.md, fontFamily: FONT.bold, marginBottom: SP.sm },

  // Create new
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  typeCard: {
    width: '31%', minWidth: 96, borderRadius: RADIUS.md, borderWidth: 1,
    alignItems: 'center', paddingVertical: SP.md, gap: SP.sm,
  },
  typeIcon: { width: 40, height: 40, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  typeLabel: { fontSize: FS.xs, fontFamily: FONT.medium, textAlign: 'center' },

  // Content library header + filters
  libraryHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: SP.sm },
  libraryCount: { fontSize: FS.xs, fontFamily: FONT.regular },
  filterScroll: { flexGrow: 0, marginBottom: SP.md },
  filterRow: { flexDirection: 'row', gap: SP.xs },
  filterTab: { borderRadius: RADIUS.pill, paddingHorizontal: SP.md, paddingVertical: SP.xs + 2, borderWidth: 1 },
  filterText: { fontSize: FS.sm, fontFamily: FONT.medium },

  // Post cards
  postList: { gap: SP.sm },
  postCard: { flexDirection: 'row', gap: SP.sm + 4, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.sm + 2 },
  postThumb: { width: 56, height: 56, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  postBody: { flex: 1, gap: 4 },
  postTopRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  statusBadge: { borderRadius: RADIUS.xs, paddingHorizontal: SP.xs + 3, paddingVertical: 3, borderWidth: 1 },
  statusText: { fontSize: FS.xs, fontFamily: FONT.bold },
  postType: { fontSize: FS.xs, fontFamily: FONT.regular, textTransform: 'capitalize' },
  postCaption: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 17 },
  postMetrics: { flexDirection: 'row', gap: SP.sm + 4 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metricText: { fontSize: FS.xs, fontFamily: FONT.regular },
  scheduledText: { fontSize: FS.xs, fontFamily: FONT.medium },
  moreBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: -SP.xs },

  // Loading / empty
  loading: { alignItems: 'center', paddingVertical: SP.xl + SP.md, gap: SP.sm },
  loadingText: { fontSize: FS.sm, fontFamily: FONT.regular },
  empty: { alignItems: 'center', paddingVertical: SP.xl + SP.md, gap: SP.sm },
  emptyIconWrap: { width: 64, height: 64, borderRadius: RADIUS.xxl, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: SP.xs },
  emptyTitle: { fontSize: FS.md, fontFamily: FONT.semibold },
  emptyDesc: { fontSize: FS.sm, fontFamily: FONT.regular },
});
