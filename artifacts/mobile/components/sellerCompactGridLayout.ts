import { StyleSheet } from 'react-native';

export const SELLER_COMPACT_GRID_GAP = 10;
export const SELLER_COMPACT_GRID_COLUMN_WIDTH = '48%';
export const SELLER_COMPACT_GRID_COLUMN_FRACTION = 0.48;

export const sellerCompactGridStyles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SELLER_COMPACT_GRID_GAP,
  },
  column: {
    width: SELLER_COMPACT_GRID_COLUMN_WIDTH,
    minWidth: 0,
  },
});