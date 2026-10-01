/**
 * Two-column product grid (image, price chip, name, brand) shared by the
 * category page and the trending see-all screen. Reuses the search
 * ProductTile so product cards look the same everywhere. Mobbin reference:
 * GOAT / SSENSE collection grids.
 */
import React from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { ProductTile } from '@/components/search/ProductTile';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { toProductTileItem } from '@/lib/discoveryShelves';

const GAP = SPACING.sm + 4;

export function DiscoveryProductGrid({ products, header, footer, empty, contentBottom, onEndReached, refreshControl }: {
  products: any[];
  header?: React.ReactElement | null;
  footer?: React.ReactElement | null;
  empty?: React.ReactElement | null;
  contentBottom: number;
  onEndReached?: () => void;
  refreshControl?: React.ReactElement<any>;
}) {
  const { theme } = useAppTheme();
  const { push } = useThreadPull();
  const { width } = useWindowDimensions();
  const cardWidth = Math.floor((Math.min(width, 640) - SCREEN_GUTTER * 2 - GAP) / 2);

  return (
    <FlatList
      data={products}
      keyExtractor={(p) => p.id}
      numColumns={2}
      columnWrapperStyle={styles.column}
      contentContainerStyle={{ paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.md, paddingBottom: contentBottom, gap: GAP }}
      showsVerticalScrollIndicator={false}
      onEndReachedThreshold={0.6}
      onEndReached={onEndReached}
      refreshControl={refreshControl}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={empty}
      renderItem={({ item }) => (
        <ProductTile
          item={toProductTileItem(item, theme.muted)}
          accent={theme.text}
          width={cardWidth}
          onPress={() => push({ pathname: '/thread-product-detail' as any, params: { productId: item.id, src: 'search' } } as never)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  column: { gap: GAP },
});

export const GridSpacer = ({ height }: { height: number }) => <View style={{ height }} />;
