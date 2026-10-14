/**
 * Submitted-search results inside the Discover search overlay — TikTok's
 * results step (Mobbin flow "Searching TikTok", screens 3–5,
 * https://mobbin.com/flows/97a8565f-1675-4edb-b8e0-a2668bf009d7): the query
 * stays in the bar, a row of text tabs with an underline under the active
 * one sits directly beneath it, and Top is a photo-first two-column grid.
 * Tabs are Brandthread's: Top, Brands, People, Products, Fits (buyer posts).
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { EmptyState } from '@/components/BrandthreadUI';
import { ProductTile, GRID_CARD_ASPECT } from '@/components/search/ProductTile';
import { VideoTile, VIDEO_TILE_ASPECT } from '@/components/search/VideoTile';
import { PersonRow, type SearchPerson } from '@/components/search/PersonRow';
import { BrandRow } from '@/components/search/BrandRow';
import { FilterSheet } from '@/components/search/FilterSheet';
import { hapticSelection, hapticToggle } from '@/lib/haptics';
import { FONT, GRID_MAX_WIDTH } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { SEARCH_RESULT_TABS, interleave, isFitAuthor, type SearchResultTab } from '@/lib/discoverSearch';
import { countActiveFilters, type SearchFacets, type SearchFilters } from '@/lib/searchFilters';
import type { BrandResult, ProductResult, VideoResult } from './useLiveSearch';

const GAP = 8;
// ProductTile draws name + brand under its 4:5 photo; budget for it when balancing columns.
const PRODUCT_TEXT_H = 44;

type GridItem = { kind: 'product'; item: ProductResult } | { kind: 'video'; item: VideoResult };

/** Two balanced columns (shortest column takes the next tile) — photo-first, no ragged gaps. */
function splitColumns(items: GridItem[], width: number): [GridItem[], GridItem[]] {
  const cols: [GridItem[], GridItem[]] = [[], []];
  const heights = [0, 0];
  for (const it of items) {
    const h = it.kind === 'video' ? width / VIDEO_TILE_ASPECT : width / GRID_CARD_ASPECT + PRODUCT_TEXT_H;
    const c = heights[0] <= heights[1] ? 0 : 1;
    cols[c].push(it);
    heights[c] += h + GAP;
  }
  return cols;
}

export function SearchResults({
  query,
  products,
  brands,
  videos,
  people,
  isSignedIn,
  followPending,
  filters,
  facets,
  onFiltersChange,
  onProductPress,
  onBrandPress,
  onVideoPress,
  onPersonPress,
  onToggleFollow,
  onSignIn,
  onClear,
  bottomInset,
}: {
  query: string;
  products: ProductResult[];
  brands: BrandResult[];
  videos: VideoResult[];
  people: SearchPerson[];
  isSignedIn: boolean;
  followPending: Record<string, boolean>;
  filters: SearchFilters;
  facets: SearchFacets | null;
  onFiltersChange: (next: SearchFilters) => void;
  onProductPress: (p: ProductResult) => void;
  onBrandPress: (b: BrandResult) => void;
  onVideoPress: (v: VideoResult) => void;
  onPersonPress: (p: SearchPerson) => void;
  onToggleFollow: (p: SearchPerson) => void;
  onSignIn: () => void;
  onClear: () => void;
  bottomInset: number;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const { width: winWidth } = useWindowDimensions();
  const [tab, setTab] = useState<SearchResultTab>('top');
  const [filterOpen, setFilterOpen] = useState(false);
  const activeFilters = countActiveFilters(filters);

  const gridWidth = Math.min(winWidth, GRID_MAX_WIDTH) - SCREEN_GUTTER * 2;
  const colWidth = Math.max(1, (gridWidth - GAP) / 2);
  const fits = useMemo(() => videos.filter((v) => isFitAuthor(v.authorAccountType)), [videos]);

  const grid = (items: GridItem[]) => {
    const [left, right] = splitColumns(items, colWidth);
    const renderTile = (g: GridItem) => (g.kind === 'product'
      ? <ProductTile key={`p-${g.item.id}`} item={g.item} accent={theme.accent} width={colWidth} sharedPhoto onPress={() => onProductPress(g.item)} />
      : <VideoTile key={`v-${g.item.id}`} item={g.item} width={colWidth} onPress={() => onVideoPress(g.item)} />);
    return (
      <View style={styles.grid}>
        <View style={styles.col}>{left.map(renderTile)}</View>
        <View style={styles.col}>{right.map(renderTile)}</View>
      </View>
    );
  };

  const noResults = (
    <View testID="buyer-search-no-results">
      <EmptyState
        icon="search"
        illustration="search"
        title={`No results for "${query}"`}
        description="Try a different spelling or a broader term."
        action={{ label: 'Clear search', icon: 'x-circle', onPress: onClear }}
      />
    </View>
  );

  const personRows = (items: SearchPerson[]) => items.map((p) => (
    <PersonRow key={p.userId} person={p} loading={!!followPending[p.userId]} onPress={() => onPersonPress(p)} onToggleFollow={() => onToggleFollow(p)} />
  ));
  const brandRows = (items: BrandResult[]) => items.map((b) => (
    <BrandRow key={b.id} brand={{ id: b.id, name: b.name, handle: b.handle ?? '', color: b.color, initials: b.initials }} onPress={() => onBrandPress(b)} />
  ));

  function renderTab() {
    if (tab === 'brands') return brands.length === 0 ? noResults : <View>{brandRows(brands)}</View>;
    if (tab === 'people') {
      if (!isSignedIn) {
        return (
          <EmptyState
            icon="users"
            title="Sign in to search people"
            description="People search shows buyers and sellers you can follow."
            action={{ label: 'Sign in', icon: 'log-in', onPress: onSignIn }}
          />
        );
      }
      return people.length === 0 ? noResults : <View>{personRows(people)}</View>;
    }
    if (tab === 'products') {
      return (
        <View>
          <View style={styles.filterRow}>
            <Pressable
              style={styles.filterButton}
              onPress={() => { hapticSelection(); setFilterOpen(true); }}
              accessibilityRole="button"
              accessibilityLabel={activeFilters > 0 ? `Filters, ${activeFilters} active` : 'Filters'}
              testID="buyer-search-filter-button"
            >
              <Feather name="sliders" size={14} color={theme.text} />
              <Text style={styles.filterLabel}>Filters</Text>
              {activeFilters > 0 && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{activeFilters}</Text>
                </View>
              )}
            </Pressable>
            {activeFilters > 0 && (
              <Pressable onPress={() => { hapticSelection(); onFiltersChange({}); }} accessibilityRole="button" accessibilityLabel="Clear all filters" hitSlop={12}>
                <Text style={styles.clearFilters}>Clear all</Text>
              </Pressable>
            )}
          </View>
          {products.length === 0 ? noResults : grid(products.map((item) => ({ kind: 'product' as const, item })))}
        </View>
      );
    }
    if (tab === 'fits') {
      if (fits.length === 0) {
        return <EmptyState icon="camera" title={`No fits for "${query}"`} description="Buyer posts that match this search show up here." />;
      }
      return grid(fits.map((item) => ({ kind: 'video' as const, item })));
    }
    // Top: up to three accounts, then the photo grid mixing posts and products.
    if (products.length + brands.length + videos.length + people.length === 0) return noResults;
    const topBrands = brands.slice(0, 2);
    const topPeople = people.slice(0, Math.max(0, 3 - topBrands.length));
    const mixed = interleave(
      videos.map((item) => ({ kind: 'video' as const, item })),
      products.map((item) => ({ kind: 'product' as const, item })),
    ) as GridItem[];
    return (
      <View>
        {brandRows(topBrands)}
        {personRows(topPeople)}
        {mixed.length > 0 && <View style={{ marginTop: topBrands.length + topPeople.length > 0 ? SPACING.sm : 0 }}>{grid(mixed)}</View>}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} testID="buyer-search-results-state" accessibilityLabel={`Search results for ${query}`}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
        accessibilityRole="tablist"
      >
        {SEARCH_RESULT_TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => { if (!active) { hapticToggle(); setTab(t.key); } }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={styles.tab}
              testID={`discover-search-tab-${t.key}`}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              <View style={[styles.tabUnderline, active && styles.tabUnderlineActive]} />
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: SPACING.sm, paddingBottom: bottomInset }}
      >
        {renderTab()}
      </ScrollView>
      <FilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} value={filters} onApply={onFiltersChange} facets={facets} />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  tabsScroll: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  tabs: { paddingHorizontal: SCREEN_GUTTER, gap: SPACING.lg },
  tab: { paddingTop: SPACING.xs, alignItems: 'center' },
  tabText: { ...TYPE_SCALE.body, fontFamily: FONT.medium, color: theme.muted, paddingBottom: SPACING.xs },
  tabTextActive: { color: theme.text, fontFamily: FONT.semibold },
  tabUnderline: { height: 2, alignSelf: 'stretch', backgroundColor: 'transparent' },
  tabUnderlineActive: { backgroundColor: theme.text },
  grid: { flexDirection: 'row', gap: GAP, paddingHorizontal: SCREEN_GUTTER },
  col: { flex: 1, gap: GAP },
  filterRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SCREEN_GUTTER, paddingBottom: SPACING.sm,
  },
  filterButton: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, height: 34,
    paddingHorizontal: SPACING.md, borderRadius: RADII.chip,
    borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface,
  },
  filterLabel: { ...TYPE_SCALE.footnote, fontFamily: FONT.medium, color: theme.text },
  filterBadge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, backgroundColor: theme.text },
  filterBadgeText: { ...TYPE_SCALE.caption, fontFamily: FONT.bold, color: theme.background },
  clearFilters: { ...TYPE_SCALE.footnote, fontFamily: FONT.semibold, color: theme.muted },
});
