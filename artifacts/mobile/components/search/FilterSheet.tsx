import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Chip } from '@/components/ui';
import { hapticPrimaryAction, hapticSelection } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import type { SearchCategory, SuggestedBrand } from '@/lib/searchData';

export type SearchSort = 'relevance' | 'price_asc' | 'price_desc' | 'newest';

export type SearchFilters = {
  category?: string;
  size?: string;
  brand?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  sort?: SearchSort;
};

export function countActiveFilters(f: SearchFilters): number {
  let n = 0;
  if (f.category) n++;
  if (f.size) n++;
  if (f.brand) n++;
  if (f.minPriceCents !== undefined || f.maxPriceCents !== undefined) n++;
  if (f.sort && f.sort !== 'relevance') n++;
  return n;
}

const SORT_OPTIONS: Array<{ key: SearchSort; label: string }> = [
  { key: 'relevance', label: 'Best match' },
  { key: 'newest', label: 'Newest' },
  { key: 'price_asc', label: 'Price: low to high' },
  { key: 'price_desc', label: 'Price: high to low' },
];

const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const PRICE_BUCKETS: Array<{ key: string; label: string; min?: number; max?: number }> = [
  { key: 'u50', label: 'Under $50', max: 5000 },
  { key: '50-100', label: '$50 – $100', min: 5000, max: 10000 },
  { key: '100-200', label: '$100 – $200', min: 10000, max: 20000 },
  { key: 'o200', label: '$200+', min: 20000 },
];

/**
 * Filter bottom sheet — size / price / category / brand / sort, wired to the
 * `/api/public/search` query params that already work server-side. Built on
 * the shared `components/ui/BottomSheet` primitive (grabber, spring, dimmed
 * backdrop) matching this codebase's other sheets.
 */
export function FilterSheet({
  visible, onClose, value, onApply, categories, brands,
}: {
  visible: boolean;
  onClose: () => void;
  value: SearchFilters;
  onApply: (next: SearchFilters) => void;
  categories: SearchCategory[];
  brands: SuggestedBrand[];
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const [draft, setDraft] = useState<SearchFilters>(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const activePriceBucket = PRICE_BUCKETS.find(
    (b) => b.min === draft.minPriceCents && b.max === draft.maxPriceCents,
  )?.key;

  function toggle<K extends keyof SearchFilters>(key: K, next: SearchFilters[K]) {
    hapticSelection();
    setDraft((prev) => ({ ...prev, [key]: prev[key] === next ? undefined : next }));
  }

  function togglePriceBucket(bucket: typeof PRICE_BUCKETS[number]) {
    hapticSelection();
    setDraft((prev) => {
      const isActive = prev.minPriceCents === bucket.min && prev.maxPriceCents === bucket.max;
      return isActive
        ? { ...prev, minPriceCents: undefined, maxPriceCents: undefined }
        : { ...prev, minPriceCents: bucket.min, maxPriceCents: bucket.max };
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

  return (
    <BottomSheet visible={visible} onClose={onClose} testID="search-filter-sheet">
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Filters</Text>
        <TouchableOpacity
          onPress={handleClearAll}
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={[styles.clearAll, { color: theme.muted }]}>Clear all</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionLabel, { color: theme.muted }]}>SORT BY</Text>
      <View style={styles.chipRow}>
        {SORT_OPTIONS.map((opt) => (
          <Chip
            key={opt.key}
            label={opt.label}
            selected={(draft.sort ?? 'relevance') === opt.key}
            onPress={() => setDraft((prev) => ({ ...prev, sort: opt.key }))}
          />
        ))}
      </View>

      <Text style={[styles.sectionLabel, { color: theme.muted }]}>PRICE</Text>
      <View style={styles.chipRow}>
        {PRICE_BUCKETS.map((bucket) => (
          <Chip
            key={bucket.key}
            label={bucket.label}
            selected={activePriceBucket === bucket.key}
            onPress={() => togglePriceBucket(bucket)}
          />
        ))}
      </View>

      {categories.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: theme.muted }]}>CATEGORY</Text>
          <View style={styles.chipRow}>
            {categories.map((c) => (
              <Chip
                key={c.category}
                label={c.category}
                selected={draft.category === c.category}
                onPress={() => toggle('category', c.category)}
              />
            ))}
          </View>
        </>
      )}

      <Text style={[styles.sectionLabel, { color: theme.muted }]}>SIZE</Text>
      <View style={styles.chipRow}>
        {SIZE_OPTIONS.map((s) => (
          <Chip key={s} label={s} selected={draft.size === s} onPress={() => toggle('size', s)} />
        ))}
      </View>

      {brands.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: theme.muted }]}>BRAND</Text>
          <View style={styles.chipRow}>
            {brands.map((b) => (
              <Chip
                key={b.id}
                label={b.name}
                selected={draft.brand === b.sellerId}
                onPress={() => toggle('brand', b.sellerId)}
              />
            ))}
          </View>
        </>
      )}

      <TouchableOpacity
        onPress={handleApply}
        style={[styles.applyBtn, { backgroundColor: theme.accent }]}
        accessibilityRole="button"
        accessibilityLabel={draftCount > 0 ? `Show results, ${draftCount} filters active` : 'Show results'}
      >
        <Text style={[styles.applyText, { color: theme.onAccent }]}>
          {draftCount > 0 ? `Show results · ${draftCount}` : 'Show results'}
        </Text>
      </TouchableOpacity>
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
    ...TYPE_SCALE.caption, letterSpacing: 0.4,
    paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.sm, paddingBottom: SPACING.xs,
  },
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs,
    paddingHorizontal: SCREEN_GUTTER,
  },
  applyBtn: {
    marginTop: SPACING.lg, marginHorizontal: SCREEN_GUTTER,
    height: 50, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
  },
  applyText: { ...TYPE_SCALE.body, fontFamily: FONT.bold },
});
