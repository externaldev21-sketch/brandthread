import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { pickAvatarColor } from '@/lib/avatarColors';
import { mergeTrendingBrands, type TrendingBrandItem } from '@/lib/searchResults';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { BrandRow } from '@/components/search/BrandRow';

/**
 * "Trending brands" for the empty search state — real data only (trending
 * signals, topped up with suggested brands). Renders nothing until at least
 * one brand comes back.
 */
export function TrendingBrands({ onPress, max = 5 }: { onPress: (sellerId: string) => void; max?: number }) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [brands, setBrands] = useState<TrendingBrandItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      Promise.resolve().then(() => api.publicDiscovery.trendingBrands(max)),
      Promise.resolve().then(() => api.public.suggested(max)),
    ]).then(([trending, suggested]) => {
      if (cancelled) return;
      setBrands(mergeTrendingBrands(
        trending.status === 'fulfilled' && Array.isArray(trending.value?.brands) ? trending.value.brands : [],
        suggested.status === 'fulfilled' && Array.isArray(suggested.value?.brands) ? suggested.value.brands : [],
        pickAvatarColor,
        max,
      ));
    });
    return () => { cancelled = true; };
  }, [api, max]);

  if (brands.length === 0) return null;
  return (
    <View testID="search-trending-brands">
      <Text style={[styles.label, { color: theme.muted }]}>Trending brands</Text>
      {brands.map((b) => (
        <BrandRow
          key={b.sellerId}
          brand={{ id: b.sellerId, name: b.name, handle: b.handle, color: b.color, initials: b.initials, verified: b.verified, followersLabel: b.followersLabel }}
          onPress={() => onPress(b.sellerId)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...TYPE_SCALE.caption, fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 1.2, paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.md, paddingBottom: SPACING.xxs },
});
