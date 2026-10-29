/**
 * Discover's in-place search — TikTok's search, copied step for step
 * (Mobbin flow "Searching TikTok",
 * https://mobbin.com/flows/97a8565f-1675-4edb-b8e0-a2668bf009d7) and
 * reskinned black/white/silver:
 *
 *   tap the bar → the SAME bar slides/expands to the full width, Cancel
 *   slides in on the right, the keyboard opens, and the search page fades in
 *   over Discover (opaque — no translucent overlay) → Recent + Trending +
 *   trending brands/products → live grouped suggestions while typing →
 *   submit → tabbed results with the query kept in the bar.
 *
 * Nothing is pushed onto the navigation stack: this renders inside Discover,
 * starting from the tapped bar's measured rect, so the bar the buyer tapped
 * is the bar they type in. One spring (critically damped, ~240ms) drives
 * every piece on the UI thread; Cancel, a left-edge swipe or Android back
 * runs it in reverse and hands control back to Discover exactly as it was.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useContentDimensions } from '@/components/web/DesktopShellContext';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useApi } from '@/hooks/useApi';
import { useSignInGate } from '@/hooks/useSignInGate';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import type { SearchPerson } from '@/components/search/PersonRow';
import { hapticFollow, hapticLight, hapticPrimaryAction, hapticSelection } from '@/lib/haptics';
import { hashtagHref, normalizeTag } from '@/lib/hashtagText';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { capSuggestions, dedupePeopleAgainstBrands } from '@/lib/discoverSearch';
import type { SearchFilters } from '@/lib/searchFilters';
import { SearchEmptyState } from './SearchEmptyState';
import { SearchSuggestions, type SuggestionSection } from './SearchSuggestions';
import { SearchResults } from './SearchResults';
import { useSearchTrending } from './useSearchTrending';
import { useLiveSearch, type BrandResult, type ProductResult, type VideoResult } from './useLiveSearch';

export interface BarRect { x: number; y: number; width: number; height: number }

/** Same height as DiscoverSearchHeader's bar, so the hand-off is seamless. */
export const SEARCH_BAR_HEIGHT = 44;
const CANCEL_W = 56;
const SPRING = { duration: 240, dampingRatio: 1 } as const;

// Session-scoped filters (same lifetime the old search screen gave them).
let sessionFilters: SearchFilters = {};

export function DiscoverSearchOverlay({
  from,
  initialQuery,
  onClosed,
}: {
  /** The tapped bar's rect inside Discover's root view; null opens without the morph (deep link). */
  from: BarRect | null;
  /** Deep link `?q=` — submit straight away. */
  initialQuery?: string;
  onClosed: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const { push } = useThreadPull();
  const api = useApi();
  const { isSignedIn } = useAuth();
  const { goToSignIn } = useSignInGate();
  const topPad = useHeaderTopInset();
  const barInset = useBuyerTabBarInset();
  const { width: W } = useContentDimensions();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState(initialQuery ?? '');
  const [submitted, setSubmitted] = useState(!!initialQuery);
  const [filters, setFiltersState] = useState<SearchFilters>(sessionFilters);
  const [followPending, setFollowPending] = useState<Record<string, boolean>>({});
  const [closing, setClosing] = useState(false);
  const setFilters = useCallback((next: SearchFilters) => { sessionFilters = next; setFiltersState(next); }, []);

  const recents = useRecentSearches();
  const trending = useSearchTrending(true);
  const live = useLiveSearch(query, filters);
  const trimmed = query.trim();

  // ── Geometry: where the bar starts (the tapped bar) and where it lands. ──
  const target = useMemo(() => {
    const naturalY = topPad + 12; // DiscoverSearchHeader's own paddingTop
    return {
      x: SCREEN_GUTTER,
      y: Math.max(from?.y ?? naturalY, naturalY),
      width: W - SCREEN_GUTTER * 2 - CANCEL_W - SPACING.xs,
    };
  }, [from?.y, topPad, W]);
  const start = from ?? { x: target.x, y: target.y, width: target.width, height: SEARCH_BAR_HEIGHT };
  const headerHeight = target.y + SEARCH_BAR_HEIGHT + SPACING.xs;

  const p = useSharedValue(0);

  useEffect(() => {
    p.value = withSpring(1, SPRING);
    hapticLight();
    if (!initialQuery) inputRef.current?.focus();
    else recents.add(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishClose = useCallback(() => onClosed(), [onClosed]);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    // Collapse back as the same empty "Search" bar Discover shows (TikTok/Instagram clear on Cancel).
    setQuery('');
    setSubmitted(false);
    hapticSelection();
    Keyboard.dismiss();
    inputRef.current?.blur();
    p.value = withSpring(0, SPRING, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [closing, p, finishClose]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
  }, [close]);

  // Left-edge swipe scrubs the same progress value, so the collapse follows the finger.
  const swipeBack = useMemo(() => Gesture.Pan()
    .hitSlop({ left: 0, width: 24 })
    .activeOffsetX(10)
    .failOffsetY([-15, 15])
    .onStart(() => { runOnJS(Keyboard.dismiss)(); })
    .onUpdate((e) => { p.value = Math.max(0, Math.min(1, 1 - e.translationX / (W * 0.8))); })
    .onEnd((e) => {
      if (e.translationX > W * 0.3 || e.velocityX > 800) runOnJS(close)();
      else p.value = withSpring(1, SPRING);
    }), [W, p, close]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: p.value }));
  const barStyle = useAnimatedStyle(() => ({
    width: interpolate(p.value, [0, 1], [start.width, target.width]),
    opacity: from ? 1 : p.value,
    transform: [
      { translateX: interpolate(p.value, [0, 1], [start.x, target.x]) },
      { translateY: interpolate(p.value, [0, 1], [start.y, target.y]) },
    ],
  }));
  const cancelStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateX: interpolate(p.value, [0, 1], [CANCEL_W, 0]) }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.35, 1], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(p.value, [0, 1], [12, 0]) }],
  }));

  // ── Actions ──────────────────────────────────────────────────────────────
  const submitTerm = useCallback((term: string) => {
    const t = term.trim();
    if (!t) return;
    setQuery(t);
    setSubmitted(true);
    inputRef.current?.blur();
    Keyboard.dismiss();
    recents.add(t);
  }, [recents]);

  const fillTerm = useCallback((term: string) => {
    setQuery(term);
    setSubmitted(false);
    inputRef.current?.focus();
  }, []);

  const openBrand = useCallback((sellerId?: string) => {
    hapticPrimaryAction();
    if (sellerId) router.push({ pathname: '/seller-profile' as never, params: { sellerId, src: 'search' } } as never);
  }, [router]);

  const openProduct = useCallback((productId?: string) => {
    if (productId) push({ pathname: '/thread-product-detail' as never, params: { productId, src: 'search' } } as never);
  }, [push]);

  const openVideo = useCallback((v: VideoResult) => {
    hapticPrimaryAction();
    router.push({ pathname: '/buyer-other-profile' as never, params: { userId: v.authorId, postId: v.postId } } as never);
  }, [router]);

  const openPerson = useCallback((person: SearchPerson) => {
    hapticPrimaryAction();
    if (person.accountType === 'seller') {
      router.push({ pathname: '/seller-profile' as never, params: { sellerId: person.userId, src: 'search' } } as never);
    } else {
      router.push({
        pathname: '/buyer-other-profile' as never,
        params: { userId: person.userId, name: person.name, handle: person.handle, initials: person.initials, color: person.color },
      } as never);
    }
  }, [router]);

  const openHashtag = useCallback((tag: string) => {
    hapticPrimaryAction();
    router.push(hashtagHref(normalizeTag(tag)) as never);
  }, [router]);

  const toggleFollow = useCallback(async (person: SearchPerson) => {
    if (followPending[person.userId]) return;
    const wasFollowing = person.isFollowing;
    hapticFollow(!wasFollowing);
    setFollowPending((cur) => ({ ...cur, [person.userId]: true }));
    try {
      let requested = false;
      if (wasFollowing) await api.social.unfollow(person.userId);
      else requested = (await api.social.follow(person.userId))?.status === 'requested';
      // A private account only received a request — not following yet.
      live.setPeople((cur) => cur.map((x) => (x.userId === person.userId ? { ...x, isFollowing: !wasFollowing && !requested } : x)));
    } catch {
      // Keep the previous state.
    } finally {
      setFollowPending((cur) => {
        const next = { ...cur };
        delete next[person.userId];
        return next;
      });
    }
  }, [api, followPending, live]);

  // ── Suggestions (grouped) ────────────────────────────────────────────────
  const sections = useMemo<SuggestionSection[]>(() => {
    if (!trimmed || live.settledQuery !== trimmed) return [];
    const brandIds = new Set(live.brands.map((b) => b.sellerId ?? b.id));
    const g = capSuggestions({
      brands: live.brands,
      people: dedupePeopleAgainstBrands(live.people, brandIds),
      products: live.products,
      hashtags: live.tags,
    });
    return [
      {
        key: 'brands', title: 'Brands',
        rows: g.brands.map((b: BrandResult) => ({
          key: `b-${b.id}`, title: b.name, subtitle: b.handle, initials: b.initials, imageUri: b.imageUri ?? null,
          onPress: () => openBrand(b.sellerId ?? b.id),
        })),
      },
      {
        key: 'people', title: 'People',
        rows: g.people.map((u) => ({
          key: `u-${u.userId}`, title: u.name, subtitle: u.handle, initials: u.initials, imageUri: u.avatarUrl ?? null,
          onPress: () => openPerson(u),
        })),
      },
      {
        key: 'products', title: 'Products',
        rows: g.products.map((pr: ProductResult) => ({
          key: `p-${pr.id}`, title: pr.name, subtitle: pr.brand, imageUri: pr.imageUri ?? null, icon: 'shopping-bag' as const, square: true,
          onPress: () => openProduct(pr.productId ?? pr.id),
        })),
      },
      {
        key: 'hashtags', title: 'Hashtags',
        rows: g.hashtags.map((t) => ({
          key: `t-${t.tag}`, title: `#${t.tag}`, subtitle: t.postCount === 1 ? '1 post' : `${t.postCount} posts`, icon: 'hash' as const,
          onPress: () => openHashtag(t.tag),
          onFill: () => fillTerm(`#${t.tag}`),
        })),
      },
    ];
  }, [trimmed, live.settledQuery, live.brands, live.people, live.products, live.tags, openBrand, openPerson, openProduct, openHashtag, fillTerm]);

  const contentBottom = barInset + SPACING.xl;

  let body: React.ReactNode;
  if (submitted && trimmed) {
    body = (
      <SearchResults
        query={trimmed}
        products={live.products}
        brands={live.brands}
        videos={live.videos}
        people={live.people}
        isSignedIn={!!isSignedIn}
        followPending={followPending}
        filters={filters}
        facets={live.facets}
        onFiltersChange={setFilters}
        onProductPress={(pr) => openProduct(pr.productId ?? pr.id)}
        onBrandPress={(b) => openBrand(b.sellerId ?? b.id)}
        onVideoPress={openVideo}
        onPersonPress={openPerson}
        onToggleFollow={toggleFollow}
        onSignIn={goToSignIn}
        onClear={() => fillTerm('')}
        bottomInset={contentBottom}
      />
    );
  } else {
    body = (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: contentBottom }}
        nativeID="buyer-search-scroll"
      >
        {trimmed ? (
          <>
            {!trimmed && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
                {['Streetwear', 'Vintage', 'Y2K', 'Accessories', 'Sneakers', 'Denim', 'Outerwear', 'Luxury'].map(category => (
                  <Pressable key={category} onPress={() => submitTerm(category)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}>
                    <Text style={{ color: theme.text }}>{category}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <SearchSuggestions query={trimmed} sections={sections} searching={live.searching} onSubmitQuery={() => submitTerm(trimmed)} />
          </>
        ) : (
          <SearchEmptyState
            recent={recents.recent}
            onRecentPress={submitTerm}
            onRecentRemove={recents.remove}
            onClearRecent={recents.clear}
            queries={trending.queries}
            brands={trending.brands}
            products={trending.products}
            onQueryPress={submitTerm}
            onBrandPress={(id) => openBrand(id)}
            onProductPress={(id) => openProduct(id)}
          />
        )}
      </ScrollView>
    );
  }

  return (
    <GestureDetector gesture={swipeBack}>
      <View style={StyleSheet.absoluteFill} pointerEvents={closing ? 'none' : 'auto'} testID="discover-search-overlay">
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }, backdropStyle]} />

        <Animated.View style={[styles.bar, barStyle]}>
          <Feather name="search" size={16} color={theme.muted} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={(v) => { setQuery(v); setSubmitted(false); }}
            onFocus={() => setSubmitted(false)}
            onSubmitEditing={() => submitTerm(query)}
            placeholder="Search"
            placeholderTextColor={theme.muted}
            style={[styles.input, WEB_INPUT_RESET]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search products and brands"
            testID="buyer-search-field"
            maxFontSizeMultiplier={1.3}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => { hapticSelection(); fillTerm(''); }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
              testID="buyer-search-clear"
            >
              <Feather name="x-circle" size={16} color={theme.muted} />
            </Pressable>
          )}
        </Animated.View>

        <Animated.View style={[styles.cancelWrap, { top: target.y }, cancelStyle]}>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Cancel search" hitSlop={8} testID="buyer-search-cancel" style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Animated.View>

        <Animated.View style={[styles.content, { top: headerHeight }, contentStyle]}>
          {body}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  // Matches DiscoverSearchHeader's searchBar exactly (fill, border, radius, padding, icon, type).
  bar: {
    position: 'absolute', top: 0, left: 0,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    height: SEARCH_BAR_HEIGHT, borderRadius: RADII.pill, borderWidth: 0,
    paddingHorizontal: SPACING.sm,
    backgroundColor: theme.cardElevated,
  },
  input: { flex: 1, minWidth: 0, ...TYPE_SCALE.body, fontFamily: FONT.regular, color: theme.text, padding: 0 },
  cancelWrap: { position: 'absolute', right: SCREEN_GUTTER, width: CANCEL_W, height: SEARCH_BAR_HEIGHT, justifyContent: 'center' },
  cancel: { alignItems: 'flex-end', justifyContent: 'center', minHeight: 44 },
  cancelText: { ...TYPE_SCALE.body, fontFamily: FONT.semibold, color: theme.text },
  content: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
