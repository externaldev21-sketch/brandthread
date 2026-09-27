import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Platform, useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { type SearchResult, type TrendingTerm } from '@/lib/searchData';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { AnimatedEntrance, EmptyState } from '@/components/BrandthreadUI';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { FONT, GUTTER, GRID_MAX_WIDTH, RADIUS } from '@/lib/theme';
import { ResponsiveContainer, useGridColumns } from '@/components/layout';
import { Chip } from '@/components/ui';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { hapticPrimaryAction, hapticSelection } from '@/lib/haptics';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { ProductTile } from '@/components/search/ProductTile';
import { PersonRow, type SearchPerson } from '@/components/search/PersonRow';
import { SegmentedTabs, type SearchTabKey } from '@/components/search/SegmentedTabs';
import { VideoTile } from '@/components/search/VideoTile';
import { FASHION_PREVIEW_POSTS } from '@/app/(tabs)/feed';

type ProductResult = Extract<SearchResult, { kind: 'product' }>;
type BrandResult = Extract<SearchResult, { kind: 'brand' }>;
type VideoResult = Extract<SearchResult, { kind: 'video' }>;

const TRENDING_FALLBACK = ['black wool coat', 'silver dress', 'Atelier Noire', 'streetwear drops'];
const DEBOUNCE_MS = 150;
const VIDEO_GRID_GAP = 8;

/**
 * Rejects punctuation-only fragments ("...", ",,") and anything shorter than
 * 2 letters — guards both "You may like" (trending API terms) and recent
 * searches against junk that slipped in from a stray keystroke or an
 * analytics artifact upstream.
 */
function isMeaningfulTerm(term: string): boolean {
  const trimmed = term.trim();
  if (trimmed.length < 2) return false;
  const letters = trimmed.replace(/[^\p{L}\p{N}]/gu, '');
  return letters.length >= 2;
}

function dedupeCaseInsensitive(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const key = term.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/** Small, clearly-fictional preview accounts so the Users tab is demoable
 * under ?bt_preview=buyer with no live backend. Only shown when the real
 * `api.social.search` call fails or returns nothing while in preview mode. */
const PREVIEW_ACCOUNTS: SearchPerson[] = [
  { userId: 'preview-buyer-1', name: 'Casey Rivera', username: 'caseyrivera', handle: '@caseyrivera', initials: 'CR', color: '#5B5CFF', bio: 'Thrifted fits daily', isFollowing: false, accountType: 'buyer', verified: false, roleTag: 'Buyer' },
  { userId: 'preview-buyer-2', name: 'Priya Nandan', username: 'priyan', handle: '@priyan', initials: 'PN', color: '#EC4899', bio: null, isFollowing: false, accountType: 'buyer', verified: true, roleTag: 'Buyer' },
  { userId: 'preview-seller-1', name: 'Atelier Noire', username: 'ateliernoire', handle: '@ateliernoire', initials: 'AN', color: '#232323', bio: 'Midnight tailoring', isFollowing: false, accountType: 'seller', verified: true, roleTag: 'Atelier Noire' },
];

function mapPreviewPostToVideo(post: (typeof FASHION_PREVIEW_POSTS)[number]): VideoResult {
  return {
    id: post.id,
    kind: 'video',
    postId: post.id,
    caption: post.caption,
    thumbnailUrl: post.videoPosterUri ?? null,
    videoUrl: post.mediaUris[0] ?? '',
    authorId: post.sellerId ?? post.id,
    authorName: post.creator,
    authorHandle: post.handle,
    authorAvatarUrl: null,
    color: post.avatarColor,
    initials: post.initials,
    likesCount: post.likes,
  };
}

const PREVIEW_VIDEOS: VideoResult[] = FASHION_PREVIEW_POSTS.map(mapPreviewPostToVideo);

function mapPreviewPostToProduct(post: (typeof FASHION_PREVIEW_POSTS)[number]): ProductResult | null {
  if (!post.productId || !post.productName) return null;
  const priceCents = post.productTags?.[0]?.priceCents
    ?? (Math.round(parseFloat(String(post.productPrice ?? '0').replace(/[^0-9.]/g, '')) * 100) || 0);
  return {
    id: post.productId,
    kind: 'product',
    productId: post.productId,
    brand: post.creator,
    name: post.productName,
    priceCents,
    color: post.avatarColor,
    initials: post.initials,
    imageUri: post.videoPosterUri ?? null,
  } as ProductResult;
}

// Only entries with an actual product attached (not every fashion-preview
// post tags one) back the "Shop" preview fallback below.
const PREVIEW_PRODUCTS: ProductResult[] = FASHION_PREVIEW_POSTS
  .map(mapPreviewPostToProduct)
  .filter((p): p is ProductResult => p !== null);

/** Case-insensitive substring match against any of several fields. */
function matchesAny(fields: Array<string | null | undefined>, query: string): boolean {
  const q = query.toLowerCase();
  return fields.some((f) => (f ?? '').toLowerCase().includes(q));
}

export default function BuyerSearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { push } = useThreadPull();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const bg = theme.background;
  const fg = theme.text;
  const muted = theme.muted;
  const primary = theme.accent;

  const api = useApi();
  const { userId } = useAuth();
  const inputRef = useRef<TextInput>(null);
  const previewMode = isBuyerDevPreview();

  const [query, setQuery] = useState('');
  // TikTok-style two-step flow: typing only ever shows live suggestions.
  // The tabbed results view appears only once the user explicitly submits
  // (Search button, Enter, or tapping a suggestion) — set here, and cleared
  // again the moment the field is edited so a new keystroke drops back to
  // suggestions instead of staying stuck on stale results.
  const [submitted, setSubmitted] = useState(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  const [activeTab, setActiveTab] = useState<SearchTabKey>('top');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [people, setPeople] = useState<SearchPerson[]>([]);
  const [followPending, setFollowPending] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [trending, setTrending] = useState<TrendingTerm[]>([]);
  const recentKey = `bt:buyer-search-recent:${userId ?? 'anon'}`;
  const trimmedQuery = query.trim();

  // Below the safe area — a plain browser preview has no real
  // env(safe-area-inset-top), so web guarantees at least 54pt clear of
  // where a notch/status bar would sit (matching TabPageHeader's own gate).
  const topPad = Platform.OS === 'web' ? Math.max(insets.top, 54) : insets.top;

  // Below the safe area on web preview matches every other buyer tab
  // header's fallback; autofocus a beat after mount so the keyboard doesn't
  // fight the push transition on native.
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), Platform.OS === 'web' ? 0 : 260);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(recentKey)
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const cleaned = dedupeCaseInsensitive(
            parsed.filter((item): item is string => typeof item === 'string' && isMeaningfulTerm(item)),
          ).slice(0, 5);
          setRecentSearches(cleaned);
        }
      })
      .catch(() => { if (!cancelled) setRecentSearches([]); });
    return () => { cancelled = true; };
  }, [recentKey]);

  function rememberSearch(value: string) {
    const term = value.trim();
    if (!isMeaningfulTerm(term)) return;
    setRecentSearches((current) => {
      const next = [term, ...current.filter((item) => item.toLowerCase() !== term.toLowerCase())].slice(0, 5);
      AsyncStorage.setItem(recentKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function clearRecentSearches() {
    hapticSelection();
    setRecentSearches([]);
    AsyncStorage.removeItem(recentKey).catch(() => {});
  }

  function removeRecentSearch(term: string) {
    hapticSelection();
    setRecentSearches((current) => {
      const next = current.filter((item) => item.toLowerCase() !== term.toLowerCase());
      AsyncStorage.setItem(recentKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  // "You may like" — real trending terms once loaded; the owner's fixed
  // fallback list covers preview mode, a cold load and an empty response.
  useEffect(() => {
    let cancelled = false;
    api.public.trending(8)
      .then((res) => { if (!cancelled) setTrending(res?.trending ?? []); })
      .catch(() => { if (!cancelled) setTrending([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Real trending terms, filtered of punctuation-only/too-short junk (an
  // artifact of upstream analytics logging partial/incomplete queries), then
  // padded out to 4 with the fixed fallback terms whenever fewer than 4
  // survive that filter — case-insensitively de-duplicated throughout.
  const youMayLike = useMemo(() => {
    const clean = dedupeCaseInsensitive(trending.map((t) => t.term).filter(isMeaningfulTerm));
    if (clean.length >= 4) return clean;
    const padded = [...clean];
    for (const term of TRENDING_FALLBACK) {
      if (padded.length >= 4) break;
      if (padded.some((t) => t.toLowerCase() === term.toLowerCase())) continue;
      padded.push(term);
    }
    return padded;
  }, [trending]);

  const performSearch = useCallback(async (term: string) => {
    const [productRes, peopleRes] = await Promise.allSettled([
      api.public.search({ q: term, limit: 30 }),
      api.social.search(term, 20),
    ]);
    setResults(productRes.status === 'fulfilled' ? productRes.value.results ?? [] : []);
    let peopleResult = peopleRes.status === 'fulfilled' ? (peopleRes.value as unknown as SearchPerson[]) : [];
    if (peopleResult.length === 0 && previewMode) {
      const q = term.toLowerCase();
      peopleResult = PREVIEW_ACCOUNTS.filter((p) => p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q));
    }
    setPeople(peopleResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setPeople([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      await performSearch(q);
      if (!cancelled) setSearching(false);
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, performSearch]);

  const productResultsRaw = useMemo(() => results.filter((r): r is ProductResult => r.kind === 'product'), [results]);
  const brandResults = useMemo(() => results.filter((r): r is BrandResult => r.kind === 'brand'), [results]);
  const videoResultsRaw = useMemo(() => results.filter((r): r is VideoResult => r.kind === 'video'), [results]);
  // Blend in bundled preview posts/products when the live API has nothing
  // for this query — matched against name/author/brand, not just caption,
  // so e.g. "ate" surfaces Atelier Noire's video and product alongside her
  // account instead of leaving Top with just the one user row.
  const videoResults = videoResultsRaw.length > 0 ? videoResultsRaw
    : (trimmedQuery.length > 0 ? PREVIEW_VIDEOS.filter((v) => matchesAny([v.caption, v.authorName, v.authorHandle], trimmedQuery)) : []);
  const productResults = productResultsRaw.length > 0 ? productResultsRaw
    : (trimmedQuery.length > 0 ? PREVIEW_PRODUCTS.filter((p) => matchesAny([p.name, p.brand], trimmedQuery)) : []);

  const gridColumns = useGridColumns({ phone: 2, tablet: 3, tabletLandscape: 4 });
  const { width: winWidth } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  const fallbackGridWidth = Math.min(winWidth, GRID_MAX_WIDTH) - GUTTER * 2;
  const effectiveGridWidth = gridWidth > 0 ? gridWidth : fallbackGridWidth;
  const gridCardWidth = Math.max(1, (effectiveGridWidth - GUTTER * (gridColumns - 1)) / gridColumns);
  // Video tiles sit closer together (8pt) than product cards (16pt) — a
  // dedicated card width keeps that gap accurate instead of leaving slack
  // computed for the wider product-grid gap.
  const videoGridCardWidth = Math.max(1, (effectiveGridWidth - VIDEO_GRID_GAP * (gridColumns - 1)) / gridColumns);
  const onGridLayout = useCallback(({ nativeEvent }: { nativeEvent: { layout: { width: number } } }) => {
    const nextWidth = Math.round(nativeEvent.layout.width);
    if (nextWidth > 0 && nextWidth !== gridWidth) setGridWidth(nextWidth);
  }, [gridWidth]);

  function goToBrand(sellerId?: string) {
    hapticPrimaryAction();
    if (sellerId) router.push({ pathname: '/seller-profile' as any, params: { sellerId } });
  }

  function goToProduct(productId: string) {
    push({ pathname: '/thread-product-detail' as any, params: { productId } } as never);
  }

  function goToVideo(video: VideoResult) {
    hapticPrimaryAction();
    rememberSearch(query || video.caption || video.authorName);
    router.push({ pathname: '/buyer-other-profile' as any, params: { userId: video.authorId, postId: video.postId } });
  }

  function handleResultPress(r: ProductResult | BrandResult) {
    hapticPrimaryAction();
    rememberSearch(query || r.name);
    if (r.kind === 'brand' && (r as any).sellerId) {
      goToBrand((r as any).sellerId);
    } else if (r.kind === 'product' && (r as any).productId) {
      goToProduct((r as any).productId);
    }
  }

  function handlePersonPress(p: SearchPerson) {
    rememberSearch(query || p.name);
    hapticPrimaryAction();
    if (p.accountType === 'seller') {
      router.push({ pathname: '/seller-profile' as any, params: { sellerId: p.userId } });
    } else {
      router.push({
        pathname: '/buyer-other-profile' as any,
        params: { userId: p.userId, name: p.name, handle: p.handle, initials: p.initials, color: p.color },
      });
    }
  }

  async function handleToggleFollow(person: SearchPerson) {
    if (followPending[person.userId] || person.userId.startsWith('preview-')) return;
    const wasFollowing = person.isFollowing;
    setFollowPending((prev) => ({ ...prev, [person.userId]: true }));
    try {
      if (wasFollowing) await api.social.unfollow(person.userId);
      else await api.social.follow(person.userId);
      setPeople((prev) => prev.map((p) => (p.userId === person.userId ? { ...p, isFollowing: !wasFollowing } : p)));
      hapticPrimaryAction();
    } catch {
      // Keep previous state on failure.
    } finally {
      setFollowPending((prev) => {
        const next = { ...prev };
        delete next[person.userId];
        return next;
      });
    }
  }

  function submitTerm(term: string) {
    rememberSearch(term);
    setQuery(term);
    setActiveTab('top');
    setSubmitted(true);
  }

  function submit() {
    if (!trimmedQuery) return;
    rememberSearch(trimmedQuery);
    setActiveTab('top');
    setSubmitted(true);
  }

  function handleChangeText(value: string) {
    setQuery(value);
    setSubmitted(false);
  }

  const productGrid = (items: ProductResult[]) => (
    <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
      <View style={styles.grid} onLayout={onGridLayout}>
        {items.map((item, index) => (
          <AnimatedEntrance key={item.id} delay={Math.min(index, 6) * 30}>
            <ProductTile item={item} accent={primary} width={gridCardWidth} onPress={() => handleResultPress(item)} />
          </AnimatedEntrance>
        ))}
      </View>
    </ResponsiveContainer>
  );

  const videoGrid = (items: VideoResult[]) => (
    <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
      <View style={styles.videoGrid} onLayout={onGridLayout}>
        {items.map((item, index) => (
          <AnimatedEntrance key={item.id} delay={Math.min(index, 6) * 30}>
            <VideoTile item={item} width={videoGridCardWidth} onPress={() => goToVideo(item)} />
          </AnimatedEntrance>
        ))}
      </View>
    </ResponsiveContainer>
  );

  const personRows = (items: SearchPerson[]) => items.map((p) => (
    <PersonRow key={p.userId} person={p} loading={!!followPending[p.userId]} onPress={() => handlePersonPress(p)} onToggleFollow={() => handleToggleFollow(p)} />
  ));

  // ── Live suggestions while typing ──────────────────────────────────────
  type SuggestionRow = {
    key: string;
    icon: keyof typeof Feather.glyphMap;
    /** Person suggestions show a real 28pt avatar circle instead of the icon. */
    avatar?: { uri: string | null; color: string; initials: string };
    title: React.ReactNode;
    subtitle?: string;
    onFill: () => void;
    onSubmit: () => void;
  };
  const suggestionRows = useMemo<SuggestionRow[]>(() => {
    if (!trimmedQuery) return [];
    const bold = (text: string) => {
      const idx = text.toLowerCase().indexOf(trimmedQuery.toLowerCase());
      if (idx === -1) return text;
      return (
        <>
          {text.slice(0, idx)}
          <Text style={{ fontFamily: FONT.bold }}>{text.slice(idx, idx + trimmedQuery.length)}</Text>
          {text.slice(idx + trimmedQuery.length)}
        </>
      );
    };
    const rows: SuggestionRow[] = [
      { key: 'q', icon: 'search', title: bold(trimmedQuery), onFill: () => setQuery(trimmedQuery), onSubmit: () => submitTerm(trimmedQuery) },
    ];
    for (const p of people.slice(0, 3)) {
      rows.push({
        key: `u-${p.userId}`, icon: 'user',
        avatar: { uri: p.avatarUrl ?? null, color: p.color, initials: p.initials },
        title: bold(p.name), subtitle: p.handle,
        onFill: () => setQuery(p.name), onSubmit: () => handlePersonPress(p),
      });
    }
    for (const b of brandResults.slice(0, 2)) {
      rows.push({ key: `b-${b.id}`, icon: 'tag', title: bold(b.name), subtitle: 'Brand', onFill: () => setQuery(b.name), onSubmit: () => handleResultPress(b) });
    }
    for (const p of productResults.slice(0, 3)) {
      rows.push({ key: `p-${p.id}`, icon: 'shopping-bag', title: bold(p.name), subtitle: p.brand, onFill: () => setQuery(p.name), onSubmit: () => handleResultPress(p) });
    }
    return rows.slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery, people, brandResults, productResults]);

  function renderSuggestions() {
    return (
      <View testID="buyer-search-suggestions">
        {suggestionRows.map((row) => (
          // Two sibling touch targets, never nested: the row's own button
          // submits the suggestion; a separate absolutely-positioned button
          // on top of its trailing edge fills the field without submitting.
          // A Touchable inside another Touchable is invalid on web (nested
          // <button> elements) — see tests/buyer-shopping-no-nested-pressables.
          <View key={row.key} style={styles.suggestionRowWrap}>
            <TouchableOpacity
              style={styles.suggestionRow}
              onPress={() => { hapticSelection(); row.onSubmit(); }}
              accessibilityRole="button"
            >
              {row.avatar ? (
                row.avatar.uri ? (
                  <CachedImage source={{ uri: row.avatar.uri }} style={styles.suggestionAvatar} />
                ) : (
                  <View style={[styles.suggestionAvatar, { backgroundColor: row.avatar.color, alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={styles.suggestionAvatarText}>{row.avatar.initials}</Text>
                  </View>
                )
              ) : (
                <Feather name={row.icon} size={16} color={muted} />
              )}
              <View style={{ flex: 1, paddingRight: 32 }}>
                <Text style={[TYPE_SCALE.body, { color: fg }]} numberOfLines={1}>{row.title}</Text>
                {row.subtitle ? <Text style={[TYPE_SCALE.caption, { color: muted }]} numberOfLines={1}>{row.subtitle}</Text> : null}
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.suggestionFillButton}
              hitSlop={8}
              onPress={() => { hapticSelection(); row.onFill(); }}
              accessibilityRole="button"
              accessibilityLabel={`Fill search with ${typeof row.title === 'string' ? row.title : 'suggestion'}`}
            >
              <Feather name="arrow-up-left" size={16} color={muted} />
            </TouchableOpacity>
          </View>
        ))}
        {searching && suggestionRows.length <= 1 && <ActivityIndicator style={{ marginTop: SPACING.md }} color={muted} />}
      </View>
    );
  }

  function renderNoResults() {
    // "Try one of these instead" — the same curated/trending terms as the
    // empty state's "You may like", so a dead-end query always has a next
    // step rather than just a clear-and-retry.
    const suggestedTerms = youMayLike.filter((t) => t.toLowerCase() !== trimmedQuery.toLowerCase()).slice(0, 4);
    return (
      <View testID="buyer-search-no-results">
        <EmptyState
          icon="search"
          illustration="search"
          title={`No results for "${trimmedQuery}"`}
          description="Try a different spelling or a broader term."
          action={{ label: 'Clear search', icon: 'x-circle', onPress: () => { setQuery(''); setSubmitted(false); } }}
        />
        {suggestedTerms.length > 0 && (
          <View style={styles.chipRow}>
            {suggestedTerms.map((term) => (
              <Chip key={term} label={term} selected={false} icon="trending-up" iconColor={primary} onPress={() => submitTerm(term)} />
            ))}
          </View>
        )}
      </View>
    );
  }

  function renderTabContent() {
    if (activeTab === 'users') {
      if (people.length === 0) return renderNoResults();
      return <View>{personRows(people)}</View>;
    }
    if (activeTab === 'shop') {
      if (productResults.length === 0) return renderNoResults();
      return productGrid(productResults);
    }
    if (activeTab === 'videos') {
      if (videoResults.length === 0) return renderNoResults();
      return videoGrid(videoResults);
    }
    if (activeTab === 'live') {
      return (
        <View testID="buyer-search-live-empty">
          <EmptyState
            icon="tv"
            title="Live search is coming soon"
            description="Search for live sessions from Brandthread sellers right here."
            action={{ label: 'Browse live now', onPress: () => router.push('/live-feed' as never) }}
          />
        </View>
      );
    }

    // Top — a smart-mixed short list of a few of each kind. Counts the
    // blended (live + preview-fallback) product/video lists, not just the
    // raw API results, so a query matched only by a fallback post/product
    // still renders instead of hitting the no-results state.
    const totalCount = productResults.length + people.length + videoResults.length;
    if (totalCount === 0) return renderNoResults();
    const topPeople = people.slice(0, 3);
    const topProducts = productResults.slice(0, 6);
    const topVideos = videoResults.slice(0, 4);
    return (
      <View>
        {topPeople.length > 0 && (
          <AnimatedEntrance>
            <Text style={styles.sectionLabel}>USERS</Text>
            {personRows(topPeople)}
          </AnimatedEntrance>
        )}
        {topProducts.length > 0 && (
          <AnimatedEntrance delay={40}>
            <Text style={styles.sectionLabel}>SHOP</Text>
            {productGrid(topProducts)}
          </AnimatedEntrance>
        )}
        {topVideos.length > 0 && (
          <AnimatedEntrance delay={80}>
            <Text style={styles.sectionLabel}>VIDEOS</Text>
            {videoGrid(topVideos)}
          </AnimatedEntrance>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="buyer-search-back"
        >
          <Feather name="chevron-left" size={26} color={fg} />
        </TouchableOpacity>
        {/* theme-exempt: fixed dark action per spec — see profile.tsx's
            #1f1f1f store-details fill for the same intentional pattern. */}
        <View style={[styles.field, fieldFocused && styles.fieldFocused]}>
          <Feather name="search" size={16} color="#9A9AA0" />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={handleChangeText}
            placeholder="Search"
            placeholderTextColor="#9A9AA0"
            style={[styles.fieldInput, { color: '#FFFFFF' }, Platform.OS === 'web' && styles.fieldInputWebNoOutline]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={submit}
            onFocus={() => setFieldFocused(true)}
            onBlur={() => setFieldFocused(false)}
            testID="buyer-search-field"
            maxFontSizeMultiplier={1.3}
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => { hapticSelection(); setQuery(''); setSubmitted(false); inputRef.current?.focus(); }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              // Asymmetric — the field itself already sits inside a padded
              // row with the "Search" button right after it, so a generous
              // hitSlop on every side (RN Web turns this into an enlarged
              // hit target, not just a bigger tap radius) was overlapping
              // that neighboring button even though nothing visually
              // touched. Keep the hit area entirely inside the field.
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 2 }}
              testID="buyer-search-clear"
            >
              <Feather name="x-circle" size={16} color="#9A9AA0" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={submit} accessibilityRole="button" testID="buyer-search-submit" style={styles.searchButton}>
          <Text style={[styles.searchButtonText, { color: fg }]}>Search</Text>
        </TouchableOpacity>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {trimmedQuery.length === 0 ? (
          <View testID="buyer-search-empty-state" accessibilityLabel="Search is empty">
            {recentSearches.length > 0 && (
              <AnimatedEntrance>
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionLabel, { paddingHorizontal: 0 }]}>RECENT SEARCHES</Text>
                  <TouchableOpacity onPress={clearRecentSearches} accessibilityRole="button" accessibilityLabel="Clear recent searches" hitSlop={12}>
                    <Text style={[styles.sectionAction, { color: fg }]}>Clear all</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.chipRow}>
                  {recentSearches.map((term) => (
                    <Chip key={term} label={term} selected={false} icon="clock" onPress={() => submitTerm(term)} onRemove={() => removeRecentSearch(term)} removeAccessibilityLabel={`Remove ${term} from recent searches`} />
                  ))}
                </View>
              </AnimatedEntrance>
            )}

            <AnimatedEntrance delay={30}>
              <Text style={styles.sectionLabel}>YOU MAY LIKE</Text>
              <View style={styles.chipRow}>
                {youMayLike.map((term, index) => (
                  <Chip key={`${term}-${index}`} label={term} selected={false} icon="trending-up" iconColor={primary} onPress={() => submitTerm(term)} />
                ))}
              </View>
            </AnimatedEntrance>

            <AnimatedEntrance delay={60}>
              <Text style={styles.sectionLabel}>WATCH SOMETHING NEW</Text>
              <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
                <View style={styles.videoGrid} onLayout={onGridLayout}>
                  {PREVIEW_VIDEOS.map((item, index) => (
                    <AnimatedEntrance key={item.id} delay={Math.min(index, 8) * 20}>
                      <VideoTile item={item} width={videoGridCardWidth} onPress={() => goToVideo(item)} />
                    </AnimatedEntrance>
                  ))}
                </View>
              </ResponsiveContainer>
            </AnimatedEntrance>
          </View>
        ) : !submitted ? (
          renderSuggestions()
        ) : (
          <>
            <View style={styles.tabsRow}>
              <SegmentedTabs active={activeTab} onChange={setActiveTab} />
            </View>
            <View testID="buyer-search-results-state" accessibilityLabel={`Search results for ${query}`}>
              {renderTabContent()}
            </View>
          </>
        )}
        <View style={{ height: insets.bottom + SPACING.xl }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SCREEN_GUTTER, paddingBottom: SPACING.sm,
  },
  field: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    height: 36, borderRadius: RADIUS.sm,
    // 10pt right padding keeps the clear (x) icon inside the field itself,
    // clear of the "Search" button's own 8pt gap below.
    paddingLeft: SPACING.sm, paddingRight: 10,
    marginLeft: SPACING.sm,
    // theme-exempt: fixed dark fill per spec, same pattern as profile.tsx's
    // store-details section — regardless of light/dark theme.
    backgroundColor: '#1f1f1f',
    borderWidth: 1, borderColor: 'transparent',
  },
  // A subtle 1px light border on focus instead of the browser's default
  // thick yellow/orange outline (removed via fieldInputWebNoOutline below).
  fieldFocused: { borderColor: 'rgba(255,255,255,0.2)' },
  fieldInput: { flex: 1, ...TYPE_SCALE.body, padding: 0 },
  // react-native-web renders a default focus ring on <input>; the field's
  // own border above is the only focus affordance we want.
  fieldInputWebNoOutline: { outlineStyle: 'none', outlineWidth: 0 } as any,
  // Explicit 8pt gap to the field, on top of the header row's own `gap` —
  // guarantees a fixed gap even if a web flexbox `gap` renders inconsistently,
  // so the "Search" button never crowds the field's trailing clear button.
  searchButton: { marginLeft: 8 },
  searchButtonText: { ...TYPE_SCALE.body, fontFamily: FONT.semibold },
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SCREEN_GUTTER,
  },
  sectionAction: { ...TYPE_SCALE.footnote, fontFamily: FONT.semibold, paddingTop: SPACING.md, paddingBottom: SPACING.xs - 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.xxs, paddingBottom: SPACING.xs },
  // theme-exempt: fixed 70%-white on this page's fixed-dark chrome, same
  // intentional pattern as the field's #1f1f1f fill and the Follow pill.
  sectionLabel: {
    ...TYPE_SCALE.caption, fontSize: 11, letterSpacing: 1.2, fontFamily: FONT.semibold,
    color: 'rgba(255,255,255,0.7)',
    paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.lg, paddingBottom: 12,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GUTTER },
  videoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: VIDEO_GRID_GAP },
  tabsRow: { paddingTop: SPACING.xs },
  suggestionRowWrap: { position: 'relative', justifyContent: 'center' },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.xs + 3,
  },
  suggestionFillButton: {
    position: 'absolute', right: SCREEN_GUTTER, top: 0, bottom: 0,
    width: 32, alignItems: 'center', justifyContent: 'center',
  },
  suggestionAvatar: { width: 28, height: 28, borderRadius: RADII.avatar },
  suggestionAvatarText: { fontSize: 11, fontFamily: FONT.bold, color: '#FFFFFF' },
});
