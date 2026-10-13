/**
 * Intl #107: "≈ €42.10" under a USD price, in the buyer's display currency.
 * Renders nothing when the currency is USD, the server flag is off or no
 * rate is available, so screens look exactly as before in those cases.
 * Buyer-facing only; never used on seller money screens.
 */
import React from 'react';
import { StyleProp, Text, TextStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { useDisplayCurrency } from '@/lib/displayCurrency';
import { FONT, FS } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';

export function ApproxPrice({ cents, suffix, style, testID = 'approx-price' }: {
  cents: number;
  /** Appended after the amount, e.g. " · You'll be charged in USD". */
  suffix?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const colors = useColors();
  const { approx } = useDisplayCurrency(useApi());
  const text = approx(cents);
  if (!text) return null;
  return (
    <Text
      style={[{ fontFamily: FONT.regular, fontSize: FS.sm, color: colors.mutedForeground, ...TABULAR_NUMS }, style]}
      numberOfLines={1}
      testID={testID}
    >
      {text}{suffix ?? ''}
    </Text>
  );
}
