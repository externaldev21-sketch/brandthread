/**
 * "See all" for Discover > Brands "Rising this week": the full top 10, same
 * rows as the Discover section (components/discover/RisingBrands.tsx).
 */
import React from 'react';
import { FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListSkeleton } from '@/components/layout';
import { RisingBrandRow, useRisingBrands } from '@/components/discover/RisingBrands';
import { SPACING } from '@/constants/spacing';

export default function BuyerRisingBrandsScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { brands, loaded } = useRisingBrands();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="Rising this week" />
      {!loaded ? (
        <View style={{ paddingHorizontal: SPACING.md }}><ListSkeleton rows={5} /></View>
      ) : (
        <FlatList
          data={brands}
          keyExtractor={(b) => b.sellerId}
          contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: insets.bottom + SPACING.xl }}
          renderItem={({ item }) => <RisingBrandRow brand={item} />}
          ListEmptyComponent={<Text style={{ color: theme.muted, fontSize: 15, paddingVertical: SPACING.lg, textAlign: 'center' }}>Nothing rising yet</Text>}
        />
      )}
    </View>
  );
}
