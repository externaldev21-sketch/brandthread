/**
 * Short inline note next to the bag stepper after + is pressed at the
 * line's real stock limit (polish 112): "Only N left". Monochrome muted
 * text, announced to screen readers when it appears.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS } from '@/lib/theme';
import { stockLimitNote } from '@/lib/cart/quantityLimit';

export function StockLimitNote({ max, testID }: { max: number; testID?: string }) {
  const { theme } = useAppTheme();
  return (
    <Text
      style={[styles.text, { color: theme.muted }]}
      numberOfLines={1}
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      {stockLimitNote(max)}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: FS.meta, fontFamily: FONT.medium },
});
