/**
 * Live / Draft / Sold out chip for the seller Products list and grid.
 * Black, white and silver only (theme tokens): Live is solid text-colour,
 * Sold out is solid silver, everything else is an outline.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PRODUCT_LIST_STATUS_LABEL, type ProductListStatus } from '@/lib/productListStatus';

interface Props {
  status: ProductListStatus;
  /** Sitting on top of a photo: outline chips get a solid backing so they stay legible. */
  onMedia?: boolean;
  testID?: string;
}

export const ProductStatusChip = React.memo(function ProductStatusChip({ status, onMedia, testID }: Props) {
  const { theme } = useAppTheme();
  const filled = status === 'live' || status === 'sold-out';
  const backgroundColor = status === 'live'
    ? theme.text
    : status === 'sold-out'
      ? theme.muted
      : onMedia ? theme.background : 'transparent';
  const color = filled ? theme.background : status === 'draft' ? theme.text : theme.muted;
  return (
    <View
      testID={testID}
      accessibilityLabel={`Status: ${PRODUCT_LIST_STATUS_LABEL[status]}`}
      style={[
        styles.chip,
        { backgroundColor, borderColor: filled ? backgroundColor : theme.border },
      ]}
    >
      <Text style={[styles.label, { color }]} numberOfLines={1}>{PRODUCT_LIST_STATUS_LABEL[status]}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
  },
  label: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
    lineHeight: 16,
    letterSpacing: 0.2,
  },
});
