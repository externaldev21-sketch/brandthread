import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { HapticSwitch, PressableScale } from '@/components/BrandthreadUI';
import { hapticPrimaryAction, hapticSelection } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { swatchFor } from '@/lib/colorSwatches';
import {
  countActiveFilters, hasValue, priceBucketsFor, toggleValue,
  type SearchFacets, type SearchFilters, type SearchSort,
} from '@/lib/searchFilters';
import { radius } from '@/constants/radii';

export type { SearchFilters, SearchSort } from '@/lib/searchFilters';
export { countActiveFilters } from '@/lib/searchFilters';

const SORT_OPTIONS: Array<{ key: SearchSort; label: string }> = [
  { key: 'relevance', label: 'Best match' },
  { key: 'newest', label: 'Newest' },
  { key: 'price_asc', label: 'Price: low to high' },
  { key: 'price_desc', label: 'Price: high to low' },
];

type Option = { value: string; label: string; count?: number };

/** Facet options plus any already-selected value that the current results no longer offer. */
function withSelected(options: Option[], selected: string[] | undefined): Option[] {
  const extra = (selected ?? []).filter((s) => !options.some((o) => o.value.toLowerCase() === s.toLowerCase()));
  return [...options, ...extra.map((value) => ({ value, label: value }))];
}

/**
 * Filter bottom sheet for buyer search (SSENSE / GOAT pattern: sort list,
 * in-stock switch, equal-width size and price grids, colour swatches, check
 * rows for category and brand). Options and counts come from the search
 * endpoint's `facets` (`?facets=1`) for the current query, so only choices
 * that exist are offered. Multi-select within a group; Clear all resets the
 * draft; Show results applies it.
 */
export function FilterSheet({
  visible, onClose, value, onApply, facets,
}: {
  visible: boolean;
  onClose: () => void;
  value: SearchFilters;
  onApply: (next: SearchFilters) => void;
  facets: SearchFacets | null;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const [draft, setDraft] = useState<SearchFilters>(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const buckets = priceBucketsFor(facets?.price ?? null);
  const activeBucket = buckets.find((b) => b.min === draft.minPriceCents && b.max === draft.maxPriceCents)?.key;

  function toggleList(key: 'sizes' | 'colors' | 'categories' | 'brands', v: string) {
    hapticSelection();
    setDraft((prev) => ({ ...prev, [key]: toggleValue(prev[key], v) }));
  }

  function togglePriceBucket(bucket: { min?: number; max?: number }) {
    hapticSelection();
    setDraft((prev) => {
      const isActive = prev.minPriceCents === bucket.min && prev.maxPriceCents === bucket.max;
      return { ...prev, minPriceCents: isActive ? undefined : bucket.min, maxPriceCents: isActive ? undefined : bucket.max };
    });
  }

  function handleClearAll() {
    hapticSelection();
    setDraft({});
  }

  function handleApply() {
    hapticPrimaryAction();
    onApply(draft);
    onClose();
  }

  const draftCount = countActiveFilters(draft);

  const sizes = withSelected((facets?.sizes ?? []).map((s) => ({ value: s.value, label: s.value, count: s.count })), draft.sizes);
  const colors = withSelected((facets?.colors ?? []).map((c) => ({ value: c.value, label: c.value, count: c.count })), draft.colors);
  const categories = withSelected((facets?.categories ?? []).map((c) => ({ value: c.value, label: c.value, count: c.count })), draft.categories);
  const brands = withSelected((facets?.brands ?? []).map((b) => ({ value: b.id, label: b.name, count: b.count })), draft.brands);

  /** Equal-width selectable cell, used in grids (4 per row for sizes, 2 for price). */
  const cell = (key: string, label: string, selected: boolean, onPress: () => void, columns: number, testID?: string) => (
    <View key={key} style={{ width: `${100 / columns}%`, paddingHorizontal: SPACING.xxs, paddingBottom: SPACING.xs }}>
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
        testID={testID}
        style={[
          styles.cell,
          { borderColor: selected ? theme.text : theme.border, backgroundColor: selected ? theme.text : theme.surface },
        ]}
      >
        <Text style={[TYPE_SCALE.footnote, { color: selected ? theme.background : theme.text, fontFamily: FONT.medium, textAlign: 'center' }]}>
          {label}
        </Text>
      </PressableScale>
    </View>
  );

  /** Full-width list row with a trailing check (radio for sort, checkbox for category and brand). */
  const row = (key: string, label: string, selected: boolean, onPress: () => void, count?: number, testID?: string) => (
    <PressableScale
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      testID={testID}
      style={styles.listRow}
    >
      <Text style={[TYPE_SCALE.body, { flex: 1, color: theme.text, fontFamily: selected ? FONT.semibold : FONT.regular }]}>{label}</Text>
      {count !== undefined ? <Text style={[TYPE_SCALE.footnote, { color: theme.muted, marginRight: SPACING.sm, minWidth: 28, textAlign: 'right' }]}>{count}</Text> : null}
      <View style={styles.checkSlot}>
        {selected ? <Icon name="check" size={18} color={theme.text} /> : null}
      </View>
    </PressableScale>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} testID="search-filter-sheet">
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Filters</Text>
        <PressableScale
          onPress={handleClearAll}
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          noMinHeight
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          testID="search-filter-clear-all"
        >
          <Text style={[styles.clearAll, { color: draftCount > 0 ? theme.text : theme.muted }]}>Clear all</Text>
        </PressableScale>
      </View>

      <Text style={[styles.sectionLabel, { color: theme.muted }]}>Sort by</Text>
      <View style={styles.listWrap}>
        {SORT_OPTIONS.map((opt) =>
          row(opt.key, opt.label, (draft.sort ?? 'relevance') === opt.key, () => { hapticSelection(); setDraft((prev) => ({ ...prev, sort: opt.key })); }, undefined, `search-filter-sort-${opt.key}`),
        )}
      </View>

      <View style={[styles.switchRow, { borderColor: theme.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[TYPE_SCALE.body, { color: theme.text, fontFamily: FONT.semibold }]}>In stock only</Text>
          {facets ? (
            <Text style={[TYPE_SCALE.caption, { color: theme.muted }]}>{facets.inStockCount} available now</Text>
          ) : null}
        </View>
        <HapticSwitch
          value={!!draft.inStock}
          onValueChange={(v: boolean) => setDraft((prev) => ({ ...prev, inStock: v || undefined }))}
          accessibilityLabel="In stock only"
          testID="search-filter-in-stock"
        />
      </View>

      {buckets.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: theme.muted }]}>Price</Text>
          <View style={styles.grid}>
            {buckets.map((b) => cell(b.key, b.label, activeBucket === b.key, () => togglePriceBucket(b), 2, `search-filter-price-${b.key}`))}
          </View>
        </>
      )}

      {sizes.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: theme.muted }]}>Size</Text>
          <View style={styles.grid}>
            {sizes.map((s) => cell(s.value, s.label, hasValue(draft.sizes, s.value), () => toggleList('sizes', s.value), 4, `search-filter-size-${s.value}`))}
          </View>
        </>
      )}

      {colors.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: theme.muted }]}>Colour</Text>
          <View style={styles.grid}>
            {colors.map((c) => {
              const fill = swatchFor(c.value);
              const selected = hasValue(draft.colors, c.value);
              if (!fill) return cell(c.value, c.label, selected, () => toggleList('colors', c.value), 4, `search-filter-color-${c.value}`);
              return (
                <View key={c.value} style={{ width: '25%', paddingBottom: SPACING.xs }}>
                  <PressableScale
                    onPress={() => toggleList('colors', c.value)}
                    style={styles.swatchItem}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Colour ${c.label}`}
                    testID={`search-filter-color-${c.value}`}
                  >
                    <View style={[styles.swatchRing, { borderColor: selected ? theme.text : 'transparent' }]}>
                      <View style={[styles.swatch, { backgroundColor: fill, borderColor: theme.border }]} />
                    </View>
                    <Text style={[TYPE_SCALE.caption, { color: selected ? theme.text : theme.muted, textAlign: 'center' }]}>{c.label}</Text>
                  </PressableScale>
                </View>
              );
            })}
          </View>
        </>
      )}

      {categories.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: theme.muted }]}>Category</Text>
          <View style={styles.listWrap}>
            {categories.map((c) => row(c.value, c.label, hasValue(draft.categories, c.value), () => toggleList('categories', c.value), c.count))}
          </View>
        </>
      )}

      {brands.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: theme.muted }]}>Brand</Text>
          <View style={styles.listWrap}>
            {brands.map((b) => row(b.value, b.label, hasValue(draft.brands, b.value), () => toggleList('brands', b.value), b.count))}
          </View>
        </>
      )}

      <PressableScale
        onPress={handleApply}
        style={[styles.applyBtn, { backgroundColor: theme.accent }]}
        accessibilityRole="button"
        accessibilityLabel={draftCount > 0 ? `Show results, ${draftCount} filters active` : 'Show results'}
        testID="search-filter-apply"
      >
        <Text style={[styles.applyText, { color: theme.onAccent }]}>
          {draftCount > 0 ? `Show results · ${draftCount}` : 'Show results'}
        </Text>
      </PressableScale>
    </BottomSheet>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SCREEN_GUTTER, paddingBottom: SPACING.sm,
  },
  title: { ...TYPE_SCALE.title2, fontFamily: FONT.bold },
  clearAll: { ...TYPE_SCALE.footnote, fontFamily: FONT.semibold },
  sectionLabel: {
    ...TYPE_SCALE.footnote, fontFamily: FONT.semibold,
    paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.md, paddingBottom: SPACING.xs,
  },
  listWrap: { paddingHorizontal: SCREEN_GUTTER },
  listRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  checkSlot: { width: 20, alignItems: 'center', justifyContent: 'center' },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: SCREEN_GUTTER - SPACING.xxs,
  },
  cell: {
    height: 44, borderRadius: RADII.pill, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.sm,
  },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginHorizontal: SCREEN_GUTTER, marginTop: SPACING.md, paddingVertical: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  swatchItem: { alignItems: 'center', gap: 4 },
  swatchRing: { width: 44, height: 44, borderRadius: RADII.pill, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 34, height: 34, borderRadius: RADII.pill, borderWidth: 1 },
  applyBtn: {
    marginTop: SPACING.lg, marginHorizontal: SCREEN_GUTTER,
    height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
  },
  applyText: { ...TYPE_SCALE.body, fontFamily: FONT.bold },
});
