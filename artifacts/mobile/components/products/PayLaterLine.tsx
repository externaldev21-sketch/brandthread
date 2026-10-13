/**
 * One quiet line under the product price, copied from Klarna / Afterpay
 * on-site messaging (SSENSE / Nordstrom product pages):
 *   "or 4 interest-free payments of $23.75 with Klarna or Afterpay (i)"
 * Tapping it opens a sheet explaining the plan. Monochrome, brand names as
 * plain text.
 *
 * Shows nothing unless the server says this seller may offer it (platform
 * switch STRIPE_BNPL_ENABLED on AND the seller opted in) and the price is at
 * least the minimum (BNPL_MIN_ORDER_CENTS, $75 by default). Web only: Klarna
 * and Afterpay are offered by the web Payment Element; native checkout is
 * card / wallets, so promising them there would be wrong.
 *
 * Dev-web preview: a `preview-seller-*` makes no request; with demo=1 it
 * reads as eligible so the line can be reviewed.
 */
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { isPreviewSellerId } from '@/lib/previewCheckout';
import { isPreviewDemoMode } from '@/lib/devPreview';
import {
  PAY_LATER_DEFAULT_MIN_CENTS, PAY_LATER_SHEET, payLaterLine, payLaterSheetNote, showPayLater,
  type PayLaterStatus,
} from '@/lib/payLater';
import { FONT, FS, SP } from '@/lib/theme';

export function PayLaterLine({ sellerId, priceCents }: { sellerId: string | null | undefined; priceCents: number }) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [status, setStatus] = useState<PayLaterStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setStatus(null);
    if (Platform.OS !== 'web' || !sellerId) return;
    if (isPreviewSellerId(sellerId)) {
      if (isPreviewDemoMode()) setStatus({ eligible: true, minCents: PAY_LATER_DEFAULT_MIN_CENTS });
      return;
    }
    let cancelled = false;
    api.publicSellers.payLater(sellerId)
      .then((res) => { if (!cancelled && res) setStatus(res); })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerId]);

  if (!showPayLater(status, priceCents)) return null;
  const line = payLaterLine(priceCents);

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={styles.row}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${line}. How it works`}
        testID="pay-later-line"
      >
        <Text style={[styles.line, { color: theme.muted }]}>
          {line}
        </Text>
        <Feather name="info" size={13} color={theme.muted} />
      </TouchableOpacity>
      <BottomSheet visible={open} onClose={() => setOpen(false)} testID="pay-later-sheet">
        <View style={styles.sheet}>
          <Text style={[styles.title, { color: theme.text }]}>{PAY_LATER_SHEET.title}</Text>
          {PAY_LATER_SHEET.steps.map((step, i) => (
            <View key={step} style={styles.step}>
              <Text style={[styles.stepNum, { color: theme.text, borderColor: theme.border }]}>{i + 1}</Text>
              <Text style={[styles.stepText, { color: theme.text }]}>{step}</Text>
            </View>
          ))}
          <Text style={[styles.note, { color: theme.muted }]}>{payLaterSheetNote(status!.minCents)}</Text>
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -SP.sm, marginBottom: SP.md, minHeight: 24 },
  line: { flexShrink: 1, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18 },
  sheet: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.lg, gap: SP.md },
  title: { fontFamily: FONT.bold, fontSize: FS.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  stepNum: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1, textAlign: 'center', lineHeight: 22,
    fontFamily: FONT.semibold, fontSize: FS.meta, overflow: 'hidden',
  },
  stepText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22 },
  note: { fontFamily: FONT.regular, fontSize: FS.meta, lineHeight: 17 },
});
