/**
 * Reposts (polish #146), TikTok's profile Reposts tab: every video or post
 * you reposted, newest first, as a three-column grid of covers. Opened from
 * Your Activity → Reposts. Server-backed (GET /api/posts/my-reposts), so it
 * matches what other people see on your profile.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import { useApi, type MyRepost } from '@/lib/api';
import { profileVideosHref } from '@/lib/profileNavigation';
import { FONT, FS, SP } from '@/lib/theme';

const COLUMNS = 3;
const GAP = 2;

type State = { owner: string | null; items: MyRepost[]; cursor: string | null; loaded: boolean; error: boolean; loadingMore: boolean };
const initialState: State = { owner: null, items: [], cursor: null, loaded: false, error: false, loadingMore: false };

export default function BuyerReposts() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { userId } = useAuth();
  const api = useApi();
  const generation = useRef(0);
  const fetchingMore = useRef(false);
  const [state, setState] = useState<State>(initialState);
  // Never show the previous account's reposts after an account switch.
  const visible = state.owner === (userId ?? null) ? state : initialState;
  const tile = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);

  const reload = useCallback(() => {
    const request = ++generation.current;
    fetchingMore.current = false;
    if (!userId) { setState({ ...initialState, loaded: true }); return; }
    setState({ ...initialState, owner: userId });
    void api.posts.myReposts().then((result) => {
      if (request !== generation.current) return;
      setState({ owner: userId, items: result.items, cursor: result.nextCursor, loaded: true, error: false, loadingMore: false });
    }).catch(() => {
      if (request !== generation.current) return;
      setState({ ...initialState, owner: userId, loaded: true, error: true });
    });
  }, [api, userId]);

  useFocusEffect(useCallback(() => {
    reload();
    return () => { generation.current++; fetchingMore.current = false; };
  }, [reload]));

  const loadMore = useCallback(() => {
    if (!userId || !visible.cursor || fetchingMore.current) return;
    fetchingMore.current = true;
    const request = generation.current;
    setState((prev) => ({ ...prev, loadingMore: true }));
    void api.posts.myReposts(visible.cursor).then((result) => {
      if (request !== generation.current) return;
      setState((prev) => ({
        ...prev,
        items: [...prev.items, ...result.items.filter((i) => !prev.items.some((p) => p.postId === i.postId))],
        cursor: result.nextCursor,
        loadingMore: false,
      }));
    }).catch(() => {
      if (request === generation.current) setState((prev) => ({ ...prev, loadingMore: false }));
    }).finally(() => { if (request === generation.current) fetchingMore.current = false; });
  }, [api, userId, visible.cursor]);

  const open = useCallback((item: MyRepost) => {
    if (item.authorAccountType === 'buyer' || item.mediaType !== 'video') {
      router.push(`/buyer-post-viewer?postId=${encodeURIComponent(item.postId)}` as never);
    } else {
      router.push(profileVideosHref({
        source: 'creator', id: item.authorId, startPostId: item.postId, title: item.authorName, exactPost: true,
      }) as never);
    }
  }, [router]);

  return (
    <View style={styles.page}>
      <ScreenHeader title="Reposts" />
      {!visible.loaded ? (
        <ActivityIndicator style={styles.center} color={theme.text} />
      ) : visible.error ? (
        <ErrorState message="Couldn't load your reposts. Try again." onRetry={reload} />
      ) : (
        <FlatList
          {...LONG_LIST_TUNING}
          data={visible.items}
          keyExtractor={(item) => item.postId}
          numColumns={COLUMNS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: insets.bottom + SP.xxl, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState icon="repeat" title="No reposts yet" message="Videos you repost show up here." />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => open(item)}
              style={[styles.tile, { width: tile, height: Math.round(tile * 4 / 3) }]}
              accessibilityRole="button"
              accessibilityLabel={`${item.caption || (item.mediaType === 'video' ? 'Video' : 'Post')} by ${item.authorName}`}
              testID={`repost-${item.postId}`}
            >
              {item.thumbnailUrl
                ? <CachedImage source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                : null}
              {item.mediaType === 'video' ? (
                <Feather name="play" size={14} color="#FFFFFF" style={styles.badge} />
              ) : null}
              <Text numberOfLines={1} style={styles.author}>{item.authorName}</Text>
            </Pressable>
          )}
          refreshControl={<RefreshControl refreshing={false} onRefresh={reload} tintColor={theme.text} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={visible.loadingMore ? <ActivityIndicator style={styles.footer} color={theme.text} /> : null}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1 },
  tile: { backgroundColor: theme.surface, overflow: 'hidden', justifyContent: 'flex-end' },
  // theme-exempt: white glyph/label with a shadow over the cover photo
  badge: { position: 'absolute', top: SP.xs + 2, right: SP.xs + 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  author: {
    color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: FS.xs, paddingHorizontal: SP.xs + 2, paddingBottom: SP.xs + 2,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  footer: { paddingVertical: SP.lg },
});
