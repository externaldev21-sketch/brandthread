/**
 * Category picker — Depop's drill-down (Men → Tops → T-shirts), each level a
 * pushed screen of plain rows with chevrons so swipe-back goes up one level.
 * Picking a subcategory pops all the way back to the form.
 * Ref: mobbin.com/flows/ce31635b-8895-43ab-afaf-bc16113974f5
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListChoiceRow } from '@/components/listing/ListingRows';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { updateListing, useListing } from '@/lib/listing/listingStore';
import { CATEGORY_TREE, DEPARTMENTS, findCategory, sizeOptionsFor, type Department } from '@/lib/listing/taxonomy';

export default function ListingCategoryScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const router = useRouter();
  const form = useListing();
  const { dept, cat } = useLocalSearchParams<{ dept?: string; cat?: string }>();
  const department = DEPARTMENTS.includes(dept as Department) ? dept as Department : undefined;
  const category = findCategory(department, cat);

  function choose(subcategory: string) {
    if (!department || !category) return;
    const sizes = sizeOptionsFor(department, category.name);
    updateListing(prev => ({
      department, category: category.name, subcategory,
      // Sizes from another size system (e.g. W32 after switching to footwear) no longer apply.
      sizes: prev.sizes.filter(sz => sizes.includes(sz.size)),
    }));
    router.dismiss(3);
  }

  const title = category?.name ?? department ?? 'Category';

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="listing-category-screen">
      <ScreenHeader title={title} />
      <ScrollView contentContainerStyle={styles.content}>
        {!department && DEPARTMENTS.map(d => (
          <ListChoiceRow
            key={d}
            label={d}
            chevron
            onPress={() => router.push(`/listing/category?dept=${encodeURIComponent(d)}` as never)}
            testID={`listing-dept-${d}`}
          />
        ))}
        {department && !category && CATEGORY_TREE[department].map(c => (
          <ListChoiceRow
            key={c.name}
            label={c.name}
            chevron
            onPress={() => router.push(`/listing/category?dept=${encodeURIComponent(department)}&cat=${encodeURIComponent(c.name)}` as never)}
            testID={`listing-cat-${c.name}`}
          />
        ))}
        {department && category && category.subcategories.map(sub => (
          <ListChoiceRow
            key={sub}
            label={sub}
            selected={form.department === department && form.category === category.name && form.subcategory === sub}
            onPress={() => choose(sub)}
            testID={`listing-sub-${sub}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 48 },
});
