/**
 * Manufacturers in one "Find a manufacturer" category (or all of them, or a
 * search across all of them), opened from app/manufacturer-find.tsx.
 *
 * `?category=<key>&q=<text>&productId=<id>` — the category key is the shared
 * one from lib/manufacturer-flow and goes to the API as `category`. Results
 * use the directory card the hub's old Discover tab used
 * (components/manufacturer/ManufacturerDirectoryCard.tsx), with the same
 * favorite / message / quote actions; tapping through opens the unchanged
 * manufacturer profile. "Compare" in the header opens the existing
 * compare-suppliers screen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { getManufacturerCategory } from '@workspace/manufacturer-flow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState, SearchBar } from '@/components/BrandthreadUI';
import { HeaderPillButton } from '@/components/analytics/AnalyticsKit';
import { ManufacturerCard } from '@/components/manufacturer/ManufacturerDirectoryCard';
import { Icon } from '@/components/ui/Icon';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { haptic } from '@/lib/haptics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isSellerDevPreview } from '@/lib/devPreview';
import { getEntitlementRejection } from '@/lib/entitlementError';
import { completeSetupTaskAfter } from '@/lib/setupCompletion';
import { COMP, FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import {
  favoriteManufacturer,
  getFavoriteManufacturerIds,
  getOrCreateConversation,
  saveManufacturer,
  searchManufacturers,
  unfavoriteManufacturer,
} from '@/services/manufacturerService';
import type { Manufacturer } from '@/services/manufacturerTypes';

function upgradeMessage(error: unknown): string | null {
  const rejection = getEntitlementRejection(error);
  return rejection ? `${rejection.message} Upgrade to ${rejection.requiredPlan === 'growth' ? 'Growth' : 'Pro'} in Plans.` : null;
}

export default function ManufacturerCategoryScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string; q?: string; productId?: string }>();
  const category = getManufacturerCategory(params.category);
  const title = category?.label ?? (params.q ? 'Search results' : 'All manufacturers');

  const [query, setQuery] = useState(params.q ?? '');
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async (text: string) => {
    const request = ++requestRef.current;
    try {
      // Favorites only decorate the cards; their failure never hides results.
      const [results, favorites] = await Promise.allSettled([
        searchManufacturers({ categoryKey: category?.key, query: text.trim() || undefined }),
        getFavoriteManufacturerIds(),
      ]);
      if (request !== requestRef.current) return;
      if (results.status === 'rejected') throw results.reason;
      setManufacturers(Array.isArray(results.value) ? results.value : []);
      setSavedIds(favorites.status === 'fulfilled' ? new Set(favorites.value) : new Set());
      setLoadError('');
    } catch (e) {
      if (request !== requestRef.current) return;
      setManufacturers([]);
      setLoadError(upgradeMessage(e) ?? "Couldn't load manufacturers. Try again in a moment.");
      console.error(e);
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [category?.key]);

  const queryRef = useRef(query);
  queryRef.current = query;
  useFocusEffect(useCallback(() => { load(queryRef.current); }, [load]));
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const onSearch = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setLoading(true); load(text); }, 300);
  };

  const quoteHref = (manufacturerId: string) => {
    const search = new URLSearchParams({ manufacturerId });
    if (params.productId) search.set('productId', params.productId);
    return (`/quote-request?${search.toString()}`) as never;
  };

  const toggleSave = async (mfg: Manufacturer) => {
    if (savingIds.has(mfg.id)) return;
    if (!savedIds.has(mfg.id)) haptic('save');
    setMutationError('');
    const flip = () => setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(mfg.id)) next.delete(mfg.id); else next.add(mfg.id);
      return next;
    });
    // Preview mode has no signed-in seller to persist a favorite for — the
    // heart still works, as local UI state.
    if (isSellerDevPreview()) {
      if (savedIds.has(mfg.id)) await unfavoriteManufacturer(mfg.id);
      else await favoriteManufacturer(mfg.id);
      flip();
      return;
    }
    setSavingIds((prev) => new Set(prev).add(mfg.id));
    try {
      if (savedIds.has(mfg.id)) {
        await unfavoriteManufacturer(mfg.id);
      } else {
        await completeSetupTaskAfter(
          'connect_manufacturer',
          () => saveManufacturer(mfg.id),
        );
      }
      flip();
    } catch (e) {
      setMutationError(upgradeMessage(e) ?? 'Could not update this favorite. Try again.');
      console.error(e);
    } finally {
      setSavingIds((prev) => { const next = new Set(prev); next.delete(mfg.id); return next; });
    }
  };

  const onMessage = async (mfg: Manufacturer) => {
    try {
      const conv = await getOrCreateConversation(mfg.id);
      router.push((`/manufacturer-messages?threadId=${conv.id}`) as never);
    } catch (e) {
      setMutationError(isSellerDevPreview()
        ? 'Messaging is unavailable in the signed-out preview.'
        : upgradeMessage(e) ?? "Couldn't open a conversation. Try again.");
      console.error(e);
    }
  };

  const searching = query.trim().length > 0;
  // An odd count leaves the last card alone in its row; a blank cell keeps
  // it at half width instead of stretching across the screen.
  const gridData: Array<Manufacturer | null> = manufacturers.length % 2 ? [...manufacturers, null] : manufacturers;

  return (
    <View style={s.root}>
      <ScreenHeader
        title={title}
        onBack={() => goBackOr(router, '/manufacturer-find')}
        rightElement={<HeaderPillButton label="Compare" onPress={() => router.push('/manufacturer-compare' as never)} />}
      />

      <View style={s.searchWrap}>
        <SearchBar value={query} onChange={onSearch} placeholder={category ? `Search ${category.label.toLowerCase()}` : 'Search manufacturers'} />
      </View>

      {!!mutationError && (
        <TouchableOpacity style={s.inlineError} onPress={() => setMutationError('')} accessibilityRole="alert">
          <Icon name="alert-circle" size={ICON.sm} color={theme.warning} />
          <Text style={s.inlineErrorText}>{mutationError}</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={loading || loadError ? [] : gridData}
        keyExtractor={(item) => item?.id ?? 'grid-spacer'}
        numColumns={2}
        columnWrapperStyle={s.gridRow}
        contentContainerStyle={s.listContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(query); }} tintColor={theme.accent} />}
        ListHeaderComponent={!loading && !loadError && manufacturers.length > 0 ? (
          <Text style={s.resultCount} testID="category-result-count">
            {manufacturers.length} {manufacturers.length === 1 ? 'manufacturer' : 'manufacturers'}
          </Text>
        ) : null}
        renderItem={({ item }) => (!item ? <View style={s.gridSpacer} /> : (
          <ManufacturerCard
            mfg={item}
            saved={savedIds.has(item.id)}
            saving={savingIds.has(item.id)}
            onSave={() => toggleSave(item)}
            onMessage={() => onMessage(item)}
            onProfile={() => router.push((`/manufacturer-profile?id=${item.id}`) as never)}
            onQuote={() => router.push(quoteHref(item.id))}
          />
        ))}
        ListEmptyComponent={loading ? (
          <View style={s.skeletonGrid} testID="category-loading">
            {[0, 1, 2, 3].map((item) => <View key={item} style={s.skeletonTile} />)}
          </View>
        ) : loadError ? (
          <EmptyState
            icon="alert-circle"
            title="Couldn't load manufacturers"
            description={loadError}
            action={{ label: 'Try again', onPress: () => { setLoading(true); load(query); } }}
          />
        ) : searching ? (
          <EmptyState
            icon="search"
            title="No matches"
            description={`No ${category ? category.label.toLowerCase() + ' ' : ''}manufacturers match “${query.trim()}”.`}
            action={{ label: 'Clear search', onPress: () => onSearch('') }}
          />
        ) : (
          <EmptyState
            icon="user-plus"
            title={category ? `No ${category.label.toLowerCase()} manufacturers yet` : 'No manufacturers listed yet'}
            description="Already work with one? Invite them to manage orders here."
            action={{ label: 'Invite your factory', onPress: () => router.push('/invite-manufacturer' as never) }}
            testID="category-empty-invite"
          />
        )}
      />
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root:         { flex: 1, backgroundColor: 'transparent' },
  searchWrap:   { paddingHorizontal: SP.md, paddingTop: SP.xs, paddingBottom: SP.sm },
  listContent:  { paddingHorizontal: SP.md, paddingTop: SP.xs, paddingBottom: SP.xxl + COMP.tabBarH },
  gridRow:      { gap: SP.sm, alignItems: 'stretch' },
  gridSpacer:   { flex: 1 },
  resultCount:  { fontVariant: ['tabular-nums'], fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted, marginBottom: SP.sm },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  skeletonTile: { width: '48%', height: 260, borderRadius: RADIUS.lg, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
  inlineError:  { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginHorizontal: SP.md, marginBottom: SP.sm, padding: SP.sm, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.warning, backgroundColor: theme.card },
  inlineErrorText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: theme.warning },
});
