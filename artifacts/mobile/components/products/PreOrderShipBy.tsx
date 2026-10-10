/**
 * Ship-by block for a pre-order product page. Self-contained: fetches the
 * public terms for the product and renders nothing when there are none, so
 * it is safe to mount next to the existing pre-order badge/card.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';

interface Terms {
  shipBy: string;
  daysLeft: number;
  refundCopy: string;
  note: string | null;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function PreOrderShipBy({ productId, isPreOrder }: { productId?: string; isPreOrder?: boolean }) {
  const api = useApi();
  const colors = useColors();
  const [terms, setTerms] = useState<Terms | null>(null);

  useEffect(() => {
    let active = true;
    setTerms(null);
    if (!productId || !isPreOrder) return;
    api.preorderTerms.get(productId)
      .then((t) => { if (active) setTerms(t); })
      .catch(() => { if (active) setTerms(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, isPreOrder]);

  if (!terms) return null;
  const daysText = terms.daysLeft === 0 ? 'Ships by today' : terms.daysLeft === 1 ? '1 day left to ship' : `${terms.daysLeft} days left to ship`;

  return (
    <View
      style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      accessibilityLabel={`Ships by ${fmt(terms.shipBy)}. ${terms.refundCopy}`}
      testID="preorder-ship-by"
    >
      <View style={s.row}>
        <Icon name="calendar" size={ICON.sm} color={colors.foreground} />
        <Text style={[s.title, { color: colors.foreground }]}>Ships by {fmt(terms.shipBy)}</Text>
      </View>
      <Text style={[s.days, { color: colors.mutedForeground }]}>{daysText}</Text>
      <Text style={[s.copy, { color: colors.foreground }]}>{terms.refundCopy}</Text>
      {!!terms.note && <Text style={[s.note, { color: colors.mutedForeground }]}>{terms.note}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md, gap: 6, marginBottom: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  title: { fontFamily: FONT.bold, fontSize: FS.md },
  days: { fontFamily: FONT.medium, fontSize: FS.sm },
  copy: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  note: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 18 },
});
