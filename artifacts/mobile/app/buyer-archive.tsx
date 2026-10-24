import { Icon as Feather } from '@/components/ui/Icon';
/**
 * Archive — shows posts the owner has archived and lets them restore or delete,
 * plus the owner's expired stories (GET /api/social/highlights/stories, non-live).
 * Post tap navigates to the post viewer; long-press opens a restore/delete
 * action sheet. Expired stories can't be opened in the story viewer (the
 * server only serves live stories by id), so story cells are view-only with a
 * long-press "Delete permanently" (DELETE /api/social/stories/:id).
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, FlatList, RefreshControl, ActivityIndicator } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFocusEffect, useRouter } from 'expo-router';

import { haptics, haptic } from '@/lib/haptics';


import { LinearGradient } from 'expo-linear-gradient';

import { BG, SURFACE, CARD, BORDER, FG, MUTED, SUBTLE, FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { getMyArchivedPosts, unarchivePost, deletePost } from '@/services/socialService';
import type { BuyerPost } from '@/services/socialTypes';
import { useApi, type HighlightPickerStory } from '@/lib/api';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { previewHighlightPickerStories } from '@/lib/previewHighlights';
import { showAlert, confirmDestructiveActionSheet } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';
import { CachedImage } from '@/components/CachedImage';
import { ScreenHeader } from '@/components/ScreenHeader';

import { showActionSheet } from '@/components/ui/ActionSheet';

import { EmptyState } from '@/components/BrandthreadUI';

import { radius } from '@/constants/radii';

import { minHitSlop } from '@/lib/hitSlop';

const GAP = 1;

// Posts/Stories pills draw 35pt tall with a 1pt border (slop is measured from
// the 33pt padding box on web); pad the touch area vertically to 44pt.
const TAB_PILL_HIT_SLOP = minHitSlop({ height: 33 });

type ArchiveTab = 'posts' | 'stories';

export default function BuyerArchive() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  // Live window width so the 3-up grid re-fits on iPad rotation / split view.
  const { width } = useWindowDimensions();
  const CELL = (width - SP.md * 2 - GAP * 2) / 3;
  const styles = makeStyles(theme, CELL);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<ArchiveTab>('posts');
  const api = useApi();
  const [archivedPosts, setArchivedPosts] = useState<BuyerPost[]>([]);
  const [archivedStories, setArchivedStories] = useState<HighlightPickerStory[]>([]);
  const [postsFailed, setPostsFailed] = useState(false);
  const [storiesFailed, setStoriesFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // First fetch still in flight: show a spinner instead of the empty state.
  const [loaded, setLoaded] = useState(false);
  const [selectedPost, setSelectedPost] = useState<BuyerPost | null>(null);
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    const loadStories = async (): Promise<HighlightPickerStory[]> => {
      if (isPreviewDemoMode()) return previewHighlightPickerStories().filter((st) => !st.live);
      // A fresh (non-demo) preview session has no server stories.
      if (isBuyerDevPreview()) return [];
      const all = await api.social.highlightStories();
      return all.filter((st) => !st.live);
    };
    const [postsResult, storiesResult] = await Promise.allSettled([getMyArchivedPosts(), loadStories()]);
    if (postsResult.status === 'fulfilled') { setArchivedPosts(postsResult.value); setPostsFailed(false); }
    else setPostsFailed(true);
    if (storiesResult.status === 'fulfilled') { setArchivedStories(storiesResult.value); setStoriesFailed(false); }
    else setStoriesFailed(true);
    setLoaded(true);
  }, [api]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const restoreArchivedPost = async (post: typeof selectedPost) => {
    if (!post || busy) return;
    setBusy(true);
    try {
      await unarchivePost(post.id);
      haptic('save');
      setSelectedPost(null);
      setArchivedPosts(prev => prev.filter(p => p.id !== post.id));
      await loadData();
    } catch (error) {
      setSelectedPost(null);
      showAlert("Couldn't restore post", friendlyError(error, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = () => restoreArchivedPost(selectedPost);
  const deleteArchivedPost = async (post: typeof selectedPost) => {
    if (!post || busy) return;
    const ok = await confirmDestructiveActionSheet({
      title: 'Delete this post?',
      message: "It will be removed permanently. You can't undo this.",
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deletePost(post.id);
      haptic('select');
      setSelectedPost(null);
      setArchivedPosts(prev => prev.filter(p => p.id !== post.id));
      await loadData();
    } catch (error) {
      setSelectedPost(null);
      showAlert("Couldn't delete post", friendlyError(error, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteArchivedStory = async (story: HighlightPickerStory) => {
    if (busy) return;
    const ok = await confirmDestructiveActionSheet({
      title: 'Delete this story?',
      message: "It will be removed permanently, including from any highlight. You can't undo this.",
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setBusy(true);
    try {
      if (!isBuyerDevPreview()) await api.social.deleteStory(story.storyId);
      haptic('select');
      setArchivedStories(prev => prev.filter(st => st.storyId !== story.storyId));
    } catch (error) {
      showAlert("Couldn't delete story", friendlyError(error, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const postTypeIcon = (type: BuyerPost['type']): IconName => {
    if (type === 'photo') return 'image';
    if (type === 'slideshow') return 'layers';
    return 'video';
  };

  const handleDelete = () => deleteArchivedPost(selectedPost);

  function renderPost({ item }: { item: BuyerPost }) {
    const qs = new URLSearchParams({
      postId: item.id,
      postAuthorName: item.authorName,
      postAuthorInitials: item.authorInitials,
      postAuthorColor: item.authorColor,
      postCaption: item.caption,
      postMediaColor1: item.mediaColors?.[0] ?? SURFACE,
      postMediaColor2: item.mediaColors?.[1] ?? BG,
      postType: item.type,
    }).toString();
    return (
      <TouchableOpacity
        style={styles.cell}
        onPress={() => { router.push(`/buyer-post-viewer?${qs}` as never); }}
        onLongPress={() => {
          haptic('longPress');
          showActionSheet(item.caption || 'Archived post', undefined, [
            { text: 'Restore to profile', onPress: () => { void restoreArchivedPost(item); } },
            { text: 'Delete permanently', style: 'destructive', onPress: () => { void deleteArchivedPost(item); } },
            { text: 'Cancel', style: 'cancel' },
          ]);
        }}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={(item.mediaColors?.length >= 2 ? item.mediaColors : [SURFACE, BG]) as [string, string]}
          style={styles.cellInner}
        >
          {item.mediaUrl && item.type !== 'video' ? (
            <CachedImage source={{ uri: item.mediaUrl }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={item.id} />
          ) : (
            <Icon name={postTypeIcon(item.type)} size={ICON.md} color={MUTED} />
          )}
          {item.caption ? (
            <Text style={styles.cellCaption} numberOfLines={1}>{item.caption}</Text>
          ) : null}
          <View style={styles.archivedBadge}>
            <Icon name="archive" size={10} color={MUTED} />
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  function renderStory({ item }: { item: HighlightPickerStory }) {
    const dateLabel = new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return (
      <TouchableOpacity
        style={styles.cell}
        accessibilityLabel={`Archived story from ${dateLabel}`}
        accessibilityHint="Long-press to delete"
        testID={`archive-story-${item.storyId}`}
        // View-only: the story viewer can't open expired stories.
        disabled={busy}
        activeOpacity={1}
        onLongPress={() => {
          haptic('longPress');
          showActionSheet(`Story from ${dateLabel}`, undefined, [
            { text: 'Delete permanently', style: 'destructive', onPress: () => { void deleteArchivedStory(item); } },
            { text: 'Cancel', style: 'cancel' },
          ]);
        }}
      >
        <LinearGradient colors={[SURFACE, BG] as [string, string]} style={styles.cellInner}>
          {item.thumbnailUrl ? (
            <CachedImage source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={item.storyId} />
          ) : (
            <Feather name="clock" size={ICON.md} color={MUTED} />
          )}
          <Text style={styles.cellCaption} numberOfLines={1}>{dateLabel}</Text>
          <View style={styles.archivedBadge}>
            <Feather name="archive" size={10} color={MUTED} />
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.page}>
      <ScreenHeader title="Archive" />

      {/* Tab toggle */}
      <View style={styles.tabRow}>
        {(['posts', 'stories'] as const).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tabPill, tab === t && styles.tabPillActive]}
            onPress={() => setTab(t)}
            hitSlop={TAB_PILL_HIT_SLOP}
          >
            <Icon
              name={t === 'posts' ? 'grid' : 'clock'}
              size={ICON.sm}
              color={tab === t ? PURPLE : MUTED}
            />
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'posts' ? 'Posts' : 'Stories'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {!loaded ? (
        <View style={styles.loading} testID="archive-loading">
          <ActivityIndicator color={PURPLE} />
        </View>
      ) : tab === 'posts' ? (
        archivedPosts.length === 0 ? (
          postsFailed ? (
            <EmptyState
              icon="alert-circle"
              title="Couldn't load archived posts"
              description="Check your connection and try again."
              action={{ label: 'Try again', onPress: () => { void loadData(); } }}
            />
          ) : (
          <EmptyState
            icon="archive"
            title="No archived posts"
            description="Posts you archive from your profile will appear here. Only you can see them."
          />
          )
        ) : (
          <FlatList
            data={archivedPosts}
            keyExtractor={p => p.id}
            numColumns={3}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={{ gap: GAP }}
            renderItem={renderPost}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PURPLE} />}
          />
        )
      ) : archivedStories.length === 0 ? (
        storiesFailed ? (
          <EmptyState
            icon="alert-circle"
            title="Couldn't load archived stories"
            description="Check your connection and try again."
            action={{ label: 'Try again', onPress: () => { void loadData(); } }}
          />
        ) : (
        <EmptyState
          icon="clock"
          title="No archived stories"
          description="Stories are automatically saved here after they expire. Only you can see them."
        />
        )
      ) : (
        <FlatList
          data={archivedStories}
          keyExtractor={st => st.storyId}
          numColumns={3}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={{ gap: GAP }}
          renderItem={renderStory}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PURPLE} />}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: { accent: string; accentDim: string }, CELL: number) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  tabRow: { flexDirection: 'row', paddingHorizontal: SP.md, paddingVertical: SP.sm, gap: SP.sm },
  tabPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: SP.sm, backgroundColor: CARD, borderRadius: radius.sm, borderWidth: 1, borderColor: BORDER },
  tabPillActive: { backgroundColor: theme.accentDim, borderColor: theme.accent },
  tabText: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  tabTextActive: { color: theme.accent },
  grid: { paddingTop: SP.sm, gap: GAP, paddingBottom: 80 },
  cell: { width: CELL, height: CELL, borderRadius: RADIUS.sm, overflow: 'hidden' },
  cellInner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xs },
  cellCaption: { fontFamily: FONT.regular, fontSize: FS.meta, color: MUTED, position: 'absolute', bottom: SP.xs, left: SP.xs, right: SP.xs },
  archivedBadge: { position: 'absolute', top: SP.xs, right: SP.xs, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 4, padding: 2 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl, gap: SP.sm },
  emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG },
  emptyDesc: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', lineHeight: 20 },
});
