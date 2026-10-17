/**
 * Archive — shows posts the owner has archived and lets them restore or delete.
 * Tap navigates to the post viewer; long-press opens a restore/delete sheet.
 * The Stories tab lists my expired stories (server story archive), newest first.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions,
  FlatList, RefreshControl, Modal, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BG, SURFACE, CARD, BORDER, FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON, OVERLAY, RED,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { getMyArchivedPosts, unarchivePost, deletePost } from '@/services/socialService';
import type { BuyerPost } from '@/services/socialTypes';
import { useApi, type HighlightPickerStory } from '@/lib/api';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { previewHighlightPickerStories } from '@/lib/previewHighlights';
import { apiErrorMessage } from '@/lib/safety';
import { CachedImage } from '@/components/CachedImage';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { EmptyState } from '@/components/BrandthreadUI';
import { radius } from '@/constants/radii';

const { width } = Dimensions.get('window');
const GAP = SP.xs;
const CELL = (width - SP.md * 2 - GAP * 2) / 3;

type ArchiveTab = 'posts' | 'stories';

export default function BuyerArchive() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<ArchiveTab>('posts');
  const api = useApi();
  const [archivedPosts, setArchivedPosts] = useState<BuyerPost[]>([]);
  const [archivedStories, setArchivedStories] = useState<HighlightPickerStory[]>([]);
  const [postsFailed, setPostsFailed] = useState(false);
  const [storiesFailed, setStoriesFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
  }, [api]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleRestore = async () => {
    if (!selectedPost || busy) return;
    const post = selectedPost;
    setBusy(true);
    try {
      await unarchivePost(post.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSelectedPost(null);
      setArchivedPosts(prev => prev.filter(p => p.id !== post.id));
      await loadData();
    } catch (error) {
      setSelectedPost(null);
      Alert.alert("Couldn't restore post", apiErrorMessage(error, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPost || busy) return;
    const post = selectedPost;
    setBusy(true);
    try {
      await deletePost(post.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setSelectedPost(null);
      setArchivedPosts(prev => prev.filter(p => p.id !== post.id));
      await loadData();
    } catch (error) {
      setSelectedPost(null);
      Alert.alert("Couldn't delete post", apiErrorMessage(error, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const postTypeIcon = (type: BuyerPost['type']): keyof typeof Feather.glyphMap => {
    if (type === 'photo') return 'image';
    if (type === 'slideshow') return 'layers';
    return 'video';
  };

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
        onPress={() => { Haptics.selectionAsync(); router.push(`/buyer-post-viewer?${qs}` as never); }}
        onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setSelectedPost(item); }}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={(item.mediaColors?.length >= 2 ? item.mediaColors : [SURFACE, BG]) as [string, string]}
          style={styles.cellInner}
        >
          {item.mediaUrl && item.type !== 'video' ? (
            <CachedImage source={{ uri: item.mediaUrl }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={item.id} />
          ) : (
            <Feather name={postTypeIcon(item.type)} size={ICON.md} color={MUTED} />
          )}
          {item.caption ? (
            <Text style={styles.cellCaption} numberOfLines={1}>{item.caption}</Text>
          ) : null}
          <View style={styles.archivedBadge}>
            <Feather name="archive" size={10} color={MUTED} />
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  function renderStory({ item }: { item: HighlightPickerStory }) {
    return (
      <View
        style={styles.cell}
        accessible
        accessibilityLabel={`Archived story from ${new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
        testID={`archive-story-${item.storyId}`}
      >
        <LinearGradient colors={[SURFACE, BG] as [string, string]} style={styles.cellInner}>
          {item.thumbnailUrl ? (
            <CachedImage source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={item.storyId} />
          ) : (
            <Feather name="clock" size={ICON.md} color={MUTED} />
          )}
          <Text style={styles.cellCaption} numberOfLines={1}>
            {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </Text>
          <View style={styles.archivedBadge}>
            <Feather name="archive" size={10} color={MUTED} />
          </View>
        </LinearGradient>
      </View>
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
          >
            <Feather
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

      {tab === 'posts' ? (
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

      {/* Restore / Delete bottom sheet */}
      <Modal
        visible={!!selectedPost}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedPost(null)}
      >
        <ModalSafeArea>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSelectedPost(null)}>
            <TouchableOpacity activeOpacity={1} style={[styles.sheet, { paddingBottom: insets.bottom + SP.md }]}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle} numberOfLines={1}>{selectedPost?.caption || 'Archived post'}</Text>

              <TouchableOpacity style={styles.sheetRow} onPress={handleRestore}>
                <Feather name="rotate-ccw" size={20} color={PURPLE} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetRowLabel}>Restore to profile</Text>
                  <Text style={styles.sheetRowSub}>Move this post back to your profile grid</Text>
                </View>
              </TouchableOpacity>

              <View style={styles.sheetDivider} />

              <TouchableOpacity style={styles.sheetRow} onPress={handleDelete}>
                <Feather name="trash-2" size={20} color={RED} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sheetRowLabel, { color: RED }]}>Delete permanently</Text>
                  <Text style={styles.sheetRowSub}>Cannot be undone</Text>
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </ModalSafeArea>
      </Modal>
    </View>
  );
}

const makeStyles = (theme: { accent: string; accentDim: string }) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  tabRow: { flexDirection: 'row', paddingHorizontal: SP.md, paddingVertical: SP.sm, gap: SP.sm },
  tabPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: SP.sm, backgroundColor: CARD, borderRadius: radius.sm, borderWidth: 1, borderColor: BORDER },
  tabPillActive: { backgroundColor: theme.accentDim, borderColor: theme.accent },
  tabText: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  tabTextActive: { color: theme.accent },
  grid: { paddingHorizontal: SP.md, paddingTop: SP.sm, gap: GAP, paddingBottom: 80 },
  cell: { width: CELL, height: CELL, borderRadius: RADIUS.sm, overflow: 'hidden' },
  cellInner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xs },
  cellCaption: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, position: 'absolute', bottom: SP.xs, left: SP.xs, right: SP.xs },
  archivedBadge: { position: 'absolute', top: SP.xs, right: SP.xs, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 4, padding: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl, gap: SP.sm },
  emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG },
  emptyDesc: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', lineHeight: 20 },
  backdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  sheet: { backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingHorizontal: SP.md, paddingTop: SP.md },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.md },
  sheetTitle: { fontFamily: FONT.bold, fontSize: FS.md, color: FG, marginBottom: SP.md, paddingHorizontal: SP.xs },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: SP.xs },
  sheetRowLabel: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  sheetRowSub: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
  sheetDivider: { height: 1, backgroundColor: BORDER, marginHorizontal: SP.xs },
});
