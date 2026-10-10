/**
 * The gift card itself: a solid black card with the store name and an amount.
 * Shared by the buy flow, the wallet and the store's manage screen.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { FONT, FS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';

const CARD_BG = '#0A0A0A';
const CARD_FG = '#FFFFFF';
const CARD_MUTED = '#A8A8A8';

export function GiftCardFace({
  storeName, amountText, caption, compact,
}: {
  storeName: string;
  amountText: string;
  /** Small line under the amount, e.g. "•••• 4821". */
  caption?: string;
  compact?: boolean;
}) {
  return (
    <View
      style={[styles.card, compact ? styles.cardCompact : styles.cardFull]}
      accessible
      accessibilityLabel={`${storeName} gift card, ${amountText}${caption ? `, ${caption}` : ''}`}
    >
      <View style={styles.top}>
        <Text style={styles.store} numberOfLines={1}>{storeName}</Text>
        <Icon name="gift" size={18} color={CARD_MUTED} />
      </View>
      <View>
        <Text style={[styles.amount, compact && styles.amountCompact]} numberOfLines={1}>{amountText}</Text>
        {caption ? <Text style={styles.caption} numberOfLines={1}>{caption}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG, borderRadius: 20, padding: SP.lg,
    justifyContent: 'space-between', borderWidth: 1, borderColor: '#2A2A2A',
  },
  cardFull: { aspectRatio: 1.6 },
  cardCompact: { minHeight: 112, gap: SP.md, padding: SP.md, borderRadius: 16 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  store: { flex: 1, fontFamily: FONT.semibold, fontSize: FS.md, color: CARD_FG },
  amount: { fontFamily: FONT.bold, fontSize: 44, lineHeight: 50, color: CARD_FG, ...TABULAR_NUMS },
  amountCompact: { fontSize: 28, lineHeight: 34 },
  caption: { fontFamily: FONT.regular, fontSize: FS.sm, color: CARD_MUTED, marginTop: 2, ...TABULAR_NUMS },
});
