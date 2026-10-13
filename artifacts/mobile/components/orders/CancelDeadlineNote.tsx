/**
 * Item 129: "You can cancel until 3:40 PM" under the buyer's Cancel order
 * button (Nike's order screen puts Cancel Order right in the order, no
 * support contact). The deadline is the server's `buyerCancelDeadline`:
 * the seller-set window, or the 21-day default.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { cancelDeadlineText } from '@/lib/cancelWindow';
import { FONT, FS, SP } from '@/lib/theme';

export function CancelDeadlineNote({ deadline }: { deadline?: string | null }) {
  const { theme } = useAppTheme();
  const text = cancelDeadlineText(deadline);
  if (!text) return null;
  return <Text style={[s.text, { color: theme.muted }]} testID="order-cancel-deadline">{text}</Text>;
}

const s = StyleSheet.create({
  // Sits 4pt under the button it explains (the action column's gap is 8).
  text: { fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', marginTop: -SP.xs },
});
