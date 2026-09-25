/**
 * Archive — shows posts the owner has archived and lets them restore or delete.
 * Tap navigates to the post viewer; long-press opens a restore/delete sheet.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions,
  FlatList, RefreshControl, Modal,
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
import { getMyPosts, unarchivePost, deletePost } from '@/services/socialService';
import type { BuyerPost } from '@/services/socialTypes';
import { Header } from '@/components/layout';
import { EmptyState } from '@/components/BrandthreadUI';

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
  const [archivedPosts, setArchivedPosts] = useState<BuyerPost[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPost, setSelectedPost] = useState<BuyerPost | null>(null);

  const loadData = useCallback(async () => {
    const all = await getMyPosts();
    setArchivedPosts(all.filter(p => p.isArchived));
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleRestore = async () => {
    if (!selectedPost) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await unarchivePost(selectedPost.id);
    setSelectedPost(null);
    await loadData();
  };

  const handleDelete = async () => {
    if (!selectedPost) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await deletePost(selectedPost.id);
    setSelectedPost(null);
    await loadData();
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
          <Feather name={postTypeIcon(item.type)} size={ICON.md} color={MUTED} />
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

  return (
    <View style={styles.page}>
      <Header title="Archive" />

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
          <EmptyState
            icon="archive"
            title="No archived posts"
            description="Posts you archive from your profile will appear here. Only you can see them."
          />
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
      ) : (
        <EmptyState
          icon="clock"
          title="No archived stories"
          description="Stories are automatically saved here after they expire. Only you can see them."
        />
      )}

      {/* Restore / Delete bottom sheet */}
      <Modal
        visible={!!selectedPost}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedPost(null)}
      >
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
      </Modal>
    </View>
  );
}

const makeStyles = (theme: { accent: string; accentDim: string }) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  tabRow: { flexDirection: 'row', paddingHorizontal: SP.md, paddingVertical: SP.sm, gap: SP.sm },
  tabPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER },
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
