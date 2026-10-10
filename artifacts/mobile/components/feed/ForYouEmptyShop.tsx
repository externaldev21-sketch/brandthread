/**
 * Empty Home For You (no seller posts yet): one action, "Shop products", and
 * a compact rail of trending products from the public trending endpoint so a
 * new buyer is never left on a dead end. The rail renders only when there is
 * real data; it never shows placeholders.
 *
 * Reference: Depop's empty "Following" feed, which sends the buyer to shop
 * with a single button and a row of popular items.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Button } from '@/components/ui';
import { ProductTile } from '@/components/search/ProductTile';
import { toProductTileItem } from '@/lib/discoveryShelves';

const RAIL_LIMIT = 8;
const TILE_WIDTH = 116;

export function ForYouEmptyShop({ width }: { width: number }) {
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    api.publicDiscovery.trendingProducts(RAIL_LIMIT)
      .then((res) => { if (alive) setProducts(Array.isArray(res?.products) ? res.products : []); })
      .catch(() => { /* rail is optional */ });
    return () => { alive = false; };
  }, [api]);

  return (
    <View style={{ width, alignItems: 'center', gap: 20, marginTop: 6 }}>
      <Button
        label="Shop products"
        size="small"
        onPress={() => router.push('/(buyer)/discover' as never)}
        testID="for-you-empty-shop"
      />
      {products.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ width }}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          accessibilityLabel="Trending products"
        >
          {products.map((p) => (
            <ProductTile
              key={p.id}
              item={toProductTileItem(p, theme.muted)}
              accent={theme.muted}
              width={TILE_WIDTH}
              onPress={() => router.push({ pathname: '/buyer-product-detail', params: { productId: p.id } } as never)}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
