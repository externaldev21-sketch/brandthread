/**
 * Product grid (2 columns on phones, `useResponsive().gridColumns` on iPad —
 * GOAT's iPad browse grid) (image, price chip, name, brand) shared by the
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
import { useResponsive } from '@/hooks/useResponsive';
import { useIsWebShell } from '@/components/web/WebAppShell';

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
  const { isTablet, gridColumns } = useResponsive();
  // The web preview shows the app in a 640pt column, so it keeps the phone grid.
  const isWebShell = useIsWebShell();
  const wide = isTablet && !isWebShell;
  const columns = wide ? gridColumns : 2;
  const cardWidth = Math.floor(((wide ? width : Math.min(width, 640)) - SCREEN_GUTTER * 2 - GAP * (columns - 1)) / columns);

  return (
    <FlatList
      // FlatList can't change numColumns in place; rotation remounts it.
      key={`grid-${columns}`}
      data={products}
      keyExtractor={(p) => p.id}
      numColumns={columns}
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
