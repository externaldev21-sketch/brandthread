/**
 * Location page — place name, city, post count, Top / Recent tabs and a
 * 3-column grid of public posts tagged there. Layout follows Instagram's
 * location page (Mobbin): title block, post count, tab row, edge-to-edge
 * 3-up grid, reskinned monochrome and map-less. Tiles reuse ProfileVideoTile
 * and open the existing post viewer.
 *
 * Preview: no network. Fresh preview shows the empty state; `&demo=1` fills
 * the grid from the bundled demo posts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { ProfileGridSkeleton, ProfileVideoTile, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { PROFILE_GRID_GAP, useProfileLayout } from '@/components/profile/profileLayout';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi, type PlaceInfo, type PlacePostsPage } from '@/lib/api';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { formatCompactCount } from '@/lib/compactFormat';
import { hapticSelection } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { FASHION_PREVIEW_POSTS } from '@/app/(tabs)/feed';

type Sort = 'top' | 'recent';

function toGridItem(post: PlacePostsPage['items'][number]): ProfileGridItem {
  const kind = post.mediaType === 'video' ? 'video' : post.mediaType === 'slideshow' ? 'slideshow' : 'photo';
  return {
    id: post.id,
    kind,
    posterUri: kind === 'video' ? post.thumbnailUrl : (post.thumbnailUrl || post.mediaUrls?.[0] || post.mediaUrl || null),
    caption: post.caption ?? '',
    likesCount: post.likesCount ?? undefined,
    productCount: 0,
  };
}

function demoItems(): ProfileGridItem[] {
  return FASHION_PREVIEW_POSTS.map((post) => ({
    id: post.id,
    kind: 'video' as const,
    posterUri: post.videoPosterUri ?? null,
    caption: post.caption ?? '',
    likesCount: post.likes,
    productCount: 0,
  }));
}

const DEMO_PLACE: PlaceInfo = {
  id: 'demo', name: 'Café de Flore', city: 'Paris', region: null, country: 'France', lat: null, lng: null,
};

function subtitleFor(place: PlaceInfo | null): string {
  if (!place) return '';
  return [place.city, place.region, place.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
}

export default function LocationScreen() {
  const params = useLocalSearchParams<{ placeId: string; name?: string }>();
  const placeId = String(params.placeId ?? '');
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const layout = useProfileLayout();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const preview = isBuyerDevPreview();
  const demo = preview && isPreviewDemoMode();

  const [place, setPlace] = useState<PlaceInfo | null>(null);
  const [sort, setSort] = useState<Sort>('top');
  const [items, setItems] = useState<ProfileGridItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [postCount, setPostCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (nextSort: Sort) => {
    const id = ++requestId.current;
    setLoading(true);
    setFailed(false);
    if (preview) {
      const list = demo ? demoItems() : [];
      setPlace(demo ? DEMO_PLACE : null);
      setItems(nextSort === 'recent' ? [...list].reverse() : list);
      setPostCount(list.length);
      setCursor(null);
      setLoading(false);
      return;
    }
    try {
      const page = await api.places.page(placeId, nextSort);
      if (id !== requestId.current) return;
      setPlace(page.place);
      setItems(page.posts.items.map(toGridItem));
      setCursor(page.posts.nextCursor);
      setPostCount(page.postCount);
      setMissing(false);
    } catch (err: any) {
      if (id !== requestId.current) return;
      if (err?.status === 404) setMissing(true); else setFailed(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [api, placeId, preview, demo]);

  useEffect(() => { void load(sort); }, [load, sort]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || loading || preview) return;
    setLoadingMore(true);
    try {
      const page = await api.places.posts(placeId, sort, cursor);
      setItems((current) => {
        const seen = new Set(current.map((i) => i.id));
        return [...current, ...page.items.filter((p) => !seen.has(p.id)).map(toGridItem)];
      });
      setCursor(page.nextCursor);
    } catch { /* keep what is already on screen */ }
    finally { setLoadingMore(false); }
  }, [api, placeId, sort, cursor, loadingMore, loading, preview]);

  const openPost = useCallback((item: ProfileGridItem) => {
    hapticSelection();
    router.push(`/buyer-post-viewer?postId=${encodeURIComponent(item.id)}` as never);
  }, [router]);

  const title = place?.name ?? (typeof params.name === 'string' && params.name ? params.name : 'Location');
  const subtitle = subtitleFor(place);

  const header = (
    <View>
      <View style={styles.hero}>
        <View style={[styles.badge, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <Feather name="map-pin" size={28} color={theme.text} />
        </View>
        <View style={styles.heroText}>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <Text style={styles.count}>
            {loading && items.length === 0 ? ' ' : `${formatCompactCount(postCount)} ${postCount === 1 ? 'post' : 'posts'}`}
          </Text>
        </View>
      </View>
      <View style={[styles.tabs, { borderBottomColor: theme.border }]} accessibilityRole="tablist">
        {(['top', 'recent'] as const).map((key) => {
          const active = sort === key;
          return (
            <TouchableOpacity
              key={key}
              style={styles.tab}
              onPress={() => { if (!active) { hapticSelection(); setSort(key); } }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={key === 'top' ? 'Top posts' : 'Recent posts'}
              testID={`location-tab-${key}`}
            >
              <Text style={[styles.tabText, { color: active ? theme.text : theme.muted, fontFamily: active ? FONT.semibold : FONT.medium }]}>
                {key === 'top' ? 'Top' : 'Recent'}
              </Text>
              <View style={[styles.tabUnderline, { backgroundColor: active ? theme.text : 'transparent' }]} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="" />
      <FlatList
        key={`cols-${layout.gridColumns}`}
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={layout.gridColumns}
        columnWrapperStyle={{ gap: PROFILE_GRID_GAP }}
        ListHeaderComponent={header}
        renderItem={({ item, index }) => (
          <ProfileVideoTile
            item={item}
            index={index}
            width={layout.tileWidth}
            height={layout.tileHeight}
            onPress={openPost}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <ProfileGridSkeleton columns={layout.gridColumns} width={layout.tileWidth} height={layout.tileHeight} />
          ) : missing ? (
            <EmptyState icon="map-pin" title="Location not available" description="This location can't be shown." />
          ) : failed ? (
            <EmptyState
              icon="wifi-off"
              title="Couldn't load this location"
              description="Check your connection and try again."
              action={{ label: 'Try again', onPress: () => void load(sort) }}
            />
          ) : (
            <EmptyState icon="map-pin" title="No posts yet" description="Posts tagged here will show up on this page." />
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: SPACING.md }} color={theme.muted} /> : null}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xl, alignSelf: 'center', width: layout.columnWidth }}
        showsVerticalScrollIndicator={false}
        testID="location-screen"
      />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  badge: { width: 76, height: 76, borderRadius: RADII.avatar, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1 },
  title: { ...TYPE_SCALE.title2, color: theme.text, fontFamily: FONT.bold },
  subtitle: { ...TYPE_SCALE.body, color: theme.muted, marginTop: 2 },
  count: { ...TYPE_SCALE.body, color: theme.muted, marginTop: 2 },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: PROFILE_GRID_GAP },
  tab: { flex: 1, alignItems: 'center', paddingTop: SPACING.sm },
  tabText: { ...TYPE_SCALE.body, paddingBottom: SPACING.sm },
  tabUnderline: { height: 2, alignSelf: 'stretch' },
});
