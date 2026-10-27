/**
 * Find a manufacturer — the category picker opened from the Manufacturer Hub
 * landing. One clean list (Faire's "Browse all" pattern): a search field,
 * then full-width category rows with a count each. A category opens its
 * results in app/manufacturer-category.tsx.
 *
 * Categories come from lib/manufacturer-flow (shared with the API's
 * `category` filter); counts from the directory facets endpoint, or the demo
 * directory in the signed-out preview.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { MANUFACTURER_CATEGORIES } from '@workspace/manufacturer-flow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SearchBar, SectionHeader } from '@/components/BrandthreadUI';
import { ListRow } from '@/components/ui/ListRow';
import type { IconName } from '@/components/ui/Icon';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { getPreviewManufacturers } from '@/lib/previewManufacturers';
import { manufacturerCategoryKeys } from '@/lib/manufacturerCategories';
import { getDirectoryFacets } from '@/services/manufacturerOrderFlow';
import { COMP, FONT, FS, SP } from '@/lib/theme';

const CATEGORY_ICONS: Record<string, IconName> = {
  'cut-and-sew': 'scissors',
  knitwear: 'grid',
  denim: 'layers',
  'screen-printing': 'printer',
  embroidery: 'pen-tool',
  'dye-and-wash': 'droplet',
  'leather-and-footwear': 'briefcase',
  accessories: 'shopping-bag',
  'labels-and-packaging': 'tag',
};

interface Counts { total: number; byKey: Record<string, number> }

function previewCounts(): Counts {
  const directory = isPreviewDemoMode() ? getPreviewManufacturers() : [];
  const byKey: Record<string, number> = {};
  for (const mfg of directory) for (const key of manufacturerCategoryKeys(mfg)) byKey[key] = (byKey[key] ?? 0) + 1;
  return { total: directory.length, byKey };
}

function countLabel(count: number): string {
  return count === 0 ? 'None yet' : String(count);
}

export default function ManufacturerFindScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const [query, setQuery] = useState('');
  // Counts are a nice-to-have: the list works without them.
  const [counts, setCounts] = useState<Counts | null>(null);

  useFocusEffect(useCallback(() => {
    if (isSellerDevPreview()) { setCounts(previewCounts()); return; }
    let live = true;
    getDirectoryFacets()
      .then((facets) => {
        if (!live || !facets.categories) return;
        setCounts({ total: facets.total, byKey: Object.fromEntries(facets.categories.map((row) => [row.key, row.count])) });
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []));

  const openResults = (params: { category?: string; q?: string }) => {
    const search = new URLSearchParams();
    if (params.category) search.set('category', params.category);
    if (params.q) search.set('q', params.q);
    if (productId) search.set('productId', productId);
    router.push((`/manufacturer-category?${search.toString()}`) as never);
  };

  const term = query.trim().toLowerCase();
  const categories = term
    ? MANUFACTURER_CATEGORIES.filter((category) => `${category.label} ${category.description} ${category.keywords.join(' ')}`.toLowerCase().includes(term))
    : MANUFACTURER_CATEGORIES;

  return (
    <View style={s.root}>
      <ScreenHeader title="Find a manufacturer" onBack={() => goBackOr(router, '/manufacturer-hub')} />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search manufacturers or categories" style={s.search} />

        {term.length > 0 && (
          <ListRow
            icon="search"
            title={`Search all manufacturers for “${query.trim()}”`}
            titleNumberOfLines={2}
            chevron
            divider
            onPress={() => openResults({ q: query.trim() })}
            testID="find-search-all"
          />
        )}

        {!term && (
          <ListRow
            icon="globe"
            title="All manufacturers"
            value={counts ? String(counts.total) : undefined}
            chevron
            divider
            onPress={() => openResults({})}
            testID="find-category-all"
          />
        )}

        <View testID="find-category-list">
          {categories.map((category, index) => (
            <ListRow
              key={category.key}
              icon={CATEGORY_ICONS[category.key] ?? 'grid'}
              title={category.label}
              titleNumberOfLines={1}
              subtitle={category.description}
              subtitleNumberOfLines={1}
              value={counts ? countLabel(counts.byKey[category.key] ?? 0) : undefined}
              chevron
              divider={index < categories.length - 1}
              onPress={() => openResults({ category: category.key })}
              testID={`find-category-${category.key}`}
            />
          ))}
        </View>
        {term.length > 0 && categories.length === 0 && (
          <Text style={s.noMatch}>No category matches “{query.trim()}”.</Text>
        )}

        {/* Requests for quotation used to sit on the old Discover tab. */}
        <SectionHeader title="Not sure who makes it?" style={s.footerHeader} />
        <ListRow
          icon="send"
          title="Post a request for quotes"
          subtitle="Send one brief to up to 10 manufacturers"
          chevron
          divider
          onPress={() => router.push('/rfq-post' as never)}
          testID="button-post-rfq"
        />
        <ListRow
          icon="file-text"
          title="Your requests"
          chevron
          onPress={() => router.push('/rfq-list' as never)}
          testID="button-my-rfqs"
        />
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root:         { flex: 1, backgroundColor: 'transparent' },
  content:      { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.xxl + COMP.tabBarH },
  search:       { marginBottom: SP.sm },
  noMatch:      { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, paddingVertical: SP.md },
  // SectionHeader brings its own 16pt gutter; this list already has one.
  footerHeader: { marginTop: SP.xl, marginBottom: SP.xs, paddingHorizontal: 0 },
});
