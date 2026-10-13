/**
 * Packing slip options: print it (AirPrint) or share it as a PDF, optionally
 * as a gift slip with every price left off.
 *
 * Opened from the seller order screen's print action, the fulfillment wizard
 * (only the items in this parcel) and bulk fulfillment (one page per order).
 * Reference: Shopify iOS admin — printer action in the order header and
 * "Print packing slip" while fulfilling.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { HapticSwitch, PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { Order } from '@/services/orderTypes';
import { packingSlipItems, printPackingSlips, sharePackingSlips } from '@/lib/packingSlip';

export function PackingSlipSheet({
  visible, orders, itemIds, onClose,
}: {
  visible: boolean;
  orders: Order[];
  /** Only these items (a partial shipment); single order only. */
  itemIds?: string[];
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [hidePrices, setHidePrices] = useState(false);
  const [busy, setBusy] = useState<'print' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) { setError(null); setBusy(null); }
  }, [visible]);

  const itemCount = useMemo(
    () => !visible ? 0 : orders.reduce((sum, order) => sum + packingSlipItems(order, orders.length === 1 ? itemIds : undefined)
      .reduce((n, li) => n + li.quantity, 0), 0),
    [visible, orders, itemIds],
  );
  const options = { itemIds: orders.length === 1 ? itemIds : undefined, hidePrices };

  async function run(kind: 'print' | 'share') {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'print') await printPackingSlips(orders, options);
      else await sharePackingSlips(orders, options);
      onClose();
    } catch {
      setError(kind === 'print'
        ? 'Couldn’t open the print dialog. Try Share PDF instead.'
        : 'Couldn’t create the PDF. Try again.');
    } finally {
      setBusy(null);
    }
  }

  const title = orders.length > 1 ? `${orders.length} packing slips` : 'Packing slip';
  const summary = orders.length > 1
    ? `${itemCount} item${itemCount === 1 ? '' : 's'} across ${orders.length} orders, one page each`
    : `${itemCount} item${itemCount === 1 ? '' : 's'} · Order #${orders[0]?.orderNumber ?? ''}`;

  return (
    <BottomSheet visible={visible} onClose={onClose} testID="packing-slip-sheet">
      <View style={s.body}>
        <Text style={s.title} accessibilityRole="header">{title}</Text>
        <Text style={s.summary}>{summary}</Text>

        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Gift — hide prices</Text>
          </View>
          <HapticSwitch
            value={hidePrices}
            onValueChange={setHidePrices}
            accessibilityLabel="Gift — hide prices"
            testID="packing-slip-hide-prices"
          />
        </View>

        {error ? (
          <View style={s.error} accessibilityRole="alert">
            <Feather name="alert-circle" size={14} color={theme.text} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={s.actions}>
          <PrimaryButton
            label="Print"
            icon="printer"
            onPress={() => { void run('print'); }}
            loading={busy === 'print'}
            disabled={busy !== null || itemCount === 0}
          />
          <SecondaryButton
            label="Share PDF"
            icon="share"
            onPress={() => { void run('share'); }}
            disabled={busy !== null || itemCount === 0}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  body: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.sm, gap: SP.sm },
  title: { fontFamily: FONT.semibold, fontSize: FS.lg, color: theme.text },
  summary: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 52, marginTop: SP.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  rowLabel: { fontFamily: FONT.medium, fontSize: FS.base, color: theme.text },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.xs },
  errorText: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text },
  actions: { gap: SP.sm, marginTop: SP.xs },
});
