/**
 * Grid — the one responsive column grid every product/video/photo grid in the
 * app should render through: 2 columns on phones, 3 on large phones and
 * unfolded foldables, 4-6 on tablets, so a tile row never clips its last
 * item and never leaves an awkward gap on a wide screen.
 *
 * This is a plain flex-wrap layout (not a FlatList) for grids embedded in a
 * larger ScrollView; for a standalone virtualized grid, read `columns` off
 * `useResponsive()`/`useGridColumns()` directly and pass it to your own
 * FlatList's `numColumns`.
 */
import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useResponsive } from '@/hooks/useResponsive';

interface GridProps<T> {
  data: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string;
  /** Override the responsive column count (e.g. force 2 even on tablet for a dense list). */
  columns?: number;
  gap?: number;
  style?: ViewStyle;
}

export function Grid<T>({ data, renderItem, keyExtractor, columns, gap = 12, style }: GridProps<T>) {
  const { gridColumns } = useResponsive();
  const cols = columns ?? gridColumns;

  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }, style]}>
      {data.map((item, index) => (
        <View
          key={keyExtractor(item, index)}
          style={{
            width: `${100 / cols}%`,
            paddingHorizontal: gap / 2,
            marginBottom: gap,
          }}
        >
          {renderItem(item, index)}
        </View>
      ))}
    </View>
  );
}
