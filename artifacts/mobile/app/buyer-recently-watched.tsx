import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { LONG_LIST_TUNING } from '@/lib/listTuning';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CachedImage } from '@/components/CachedImage';
import { EmptyState } from '@/components/layout';
import { ErrorState } from '@/components/ui';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi, type WatchedVideo } from '@/lib/api';
import { profileVideosHref } from '@/lib/profileNavigation';
import { FONT, FS, SP } from '@/lib/theme';

type HistoryState = {
  owner: string | null;
  items: WatchedVideo[];
  cursor: string | null;
  loaded: boolean;
  error: boolean;
  loadingMore: boolean;
  moreError: boolean;
};
const initialState: HistoryState = {
  owner: null, items: [], cursor: null, loaded: false, error: false, loadingMore: false, moreError: false,
};

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (!Number.isFinite(minutes)) return 'Recently watched';
  if (minutes < 1) return 'Just watched';
  if (minutes < 60) return `Watched ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Watched ${hours}h ago`;
}

export default function BuyerRecentlyWatched() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const api = useApi();
  const generation = useRef(0);
  const fetchingMore = useRef(false);
  const [state, setState] = useState<HistoryState>(initialState);
  // Clerk can switch accounts without unmounting a route. Never render the
  // prior account's private history while the replacement request is in flight.
  const visible = state.owner === (userId ?? null) ? state : initialState;

  const reload = useCallback(() => {
    const request = ++generation.current;
    fetchingMore.current = false;
    setState({ ...initialState, owner: userId ?? null });
    if (!userId) {
      setState({ ...initialState, loaded: true });
      return;
    }
    void api.posts.watchedVideos().then(result => {
      if (request !== generation.current) return;
      setState({ owner: userId, items: result.items, cursor: result.nextCursor, loaded: true, error: false, loadingMore: false, moreError: false });
    }).catch(() => {
      if (request !== generation.current) return;
      setState({ ...initialState, owner: userId, loaded: true, error: true });
    });
  }, [api, userId]);

  useFocusEffect(useCallback(() => {
    reload();
    return () => { generation.current++; fetchingMore.current = false; };
  }, [reload]));

  const loadMore = useCallback((retry = false) => {
    if (!userId || !visible.loaded || !visible.cursor || visible.error || (visible.moreError && !retry) || fetchingMore.current) return;
    fetchingMore.current = true;
    const request = generation.current;
    const cursor = visible.cursor;
    setState(prev => ({ ...prev, loadingMore: true, moreError: false }));
    void api.posts.watchedVideos(cursor).then(result => {
      if (request !== generation.current) return;
      setState(prev => ({
        ...prev,
        items: [...prev.items, ...result.items.filter(item => !prev.items.some(existing => existing.postId === item.postId))],
        cursor: result.nextCursor,
        loadingMore: false,
        error: false,
        moreError: false,
      }));
    }).catch(() => {
      if (request !== generation.current) return;
      // Keep already-loaded videos visible and offer an explicit retry.
      setState(prev => ({ ...prev, loadingMore: false, moreError: true }));
    }).finally(() => { if (request === generation.current) fetchingMore.current = false; });
  }, [api, userId, visible]);

  const openVideo = useCallback((item: WatchedVideo) => {
    if (item.authorAccountType === 'buyer') {
      router.push(`/buyer-post-viewer?postId=${encodeURIComponent(item.postId)}` as never);
    } else {
      router.push(profileVideosHref({
        source: 'creator', id: item.authorId, startPostId: item.postId, title: item.authorName,
        exactPost: true,
      }) as never);
    }
  }, [router]);

  return (
    <View style={styles.page}>
      <ScreenHeader title="Recently watched" />
      {!visible.loaded ? (
        <ActivityIndicator style={styles.center} color={theme.text} />
      ) : visible.error ? (
        <ErrorState message="Couldn't load recently watched videos. Try again." onRetry={reload} />
      ) : (
        <FlatList
          {...LONG_LIST_TUNING}
          data={visible.items}
          keyExtractor={item => item.postId}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + SP.xxl }]}
          ListHeaderComponent={<Text style={styles.intro}>Videos you watched in the last 36 hours</Text>}
          ListEmptyComponent={
            <EmptyState icon="play-circle" title="No recently watched videos"
              message="Videos you watch will appear here for 36 hours." />
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => openVideo(item)} style={styles.row}
              accessibilityRole="button" accessibilityLabel={`Replay ${item.caption || 'video'} by ${item.authorName}`}
              testID={`recently-watched-${item.postId}`}>
              <View style={styles.poster}>
                {item.thumbnailUrl
                  ? <CachedImage source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  : null}
                <Feather name="play" size={20} color={theme.text} style={styles.play} />
              </View>
              <View style={styles.details}>
                <Text numberOfLines={2} style={styles.caption}>{item.caption || 'Video'}</Text>
                <Text numberOfLines={1} style={styles.author}>{item.authorName}</Text>
                <Text style={styles.time}>{relativeTime(item.watchedAt)}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.muted} />
            </Pressable>
          )}
          refreshControl={<RefreshControl refreshing={false} onRefresh={reload} tintColor={theme.text} />}
          onEndReached={() => loadMore()}
          onEndReachedThreshold={0.4}
          ListFooterComponent={visible.loadingMore
            ? <ActivityIndicator style={styles.footer} color={theme.text} />
            : visible.moreError
              ? <Pressable accessibilityRole="button" onPress={() => loadMore(true)} style={styles.footer}>
                  <Text style={styles.retry}>Couldn't load more videos. Tap to retry.</Text>
                </Pressable>
              : null}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1 },
  list: { paddingHorizontal: SP.md },
  intro: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, paddingVertical: SP.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  poster: { width: 68, height: 92, backgroundColor: theme.surface, overflow: 'hidden', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  play: { position: 'absolute', textShadowColor: theme.background, textShadowRadius: 6 },
  details: { flex: 1, gap: 4 },
  caption: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
  author: { color: theme.muted, fontFamily: FONT.medium, fontSize: FS.sm },
  time: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs },
  footer: { paddingVertical: SP.lg },
  retry: { color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm, textAlign: 'center' },
});