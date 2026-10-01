import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { FormInput, PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
import {
  DELIVERY_CONFIRMED_BY_NOTE, formatLocalDate, sellerCountdown, sellerShipByLine, type DeadlineCountdown,
} from '@/lib/deliveryGuarantee';

/**
 * Seller-side delivery guarantee UI: the deadline chip on list rows, the quiet
 * "ship by" banner / read-only auto-refund card on the order detail, and the
 * "Ship some items" sheet (PATCH /api/orders/:id/items-tracking).
 */

export function DeadlineChip({ countdown }: { countdown: DeadlineCountdown }) {
  const { theme } = useAppTheme();
  const color = countdown.urgent ? theme.error : theme.muted;
  return (
    <View
      style={[chipStyles.chip, { borderColor: theme.border }]}
      accessibilityLabel={countdown.kind === 'left' ? `${countdown.label} to ship` : countdown.label}
      testID="deadline-chip"
    >
      <Feather name={countdown.kind === 'refunded' ? 'rotate-ccw' : 'clock'} size={10} color={color} />
      <Text style={[chipStyles.text, { color }]} numberOfLines={1}>{countdown.label}</Text>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end',
    borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 2,
  },
  text: { fontFamily: FONT.semibold, fontSize: FS.xs },
});

type DeliveryOrderFields = {
  deliverBy?: string | null;
  promisedShipDate?: string | null;
  isPreOrder?: boolean;
  autoRefundedAt?: string | null;
  disputePausedAt?: string | null;
  deliveredAt?: string | null;
};

/** Banner above the actions: ship-by deadline, pre-order promise, dispute pause, or the read-only refunded state. */
export function SellerDeliveryBanner({ order, shipped }: { order: DeliveryOrderFields; shipped: boolean }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => bannerStyles(theme), [theme]);

  if (order.autoRefundedAt) {
    return (
      <View style={s.box} testID="seller-auto-refunded">
        <View style={s.head}>
          <Feather name="rotate-ccw" size={ICON.sm} color={theme.text} />
          <Text style={s.title}>Auto-refunded, not delivered in time</Text>
        </View>
        <Text style={s.body}>
          The buyer was refunded on {formatLocalDate(order.autoRefundedAt)} because this order wasn't delivered by its deadline. It is read-only, so you can't ship it or add tracking.
        </Text>
      </View>
    );
  }

  const countdown = sellerCountdown(order, shipped);
  const line = shipped || order.deliveredAt ? null : sellerShipByLine(order.deliverBy);
  if (!line && !order.promisedShipDate && !order.disputePausedAt && !shipped) return null;

  return (
    <View style={s.box} testID="seller-ship-by-banner">
      {line ? (
        <View style={s.head}>
          <Feather name="clock" size={ICON.sm} color={countdown?.urgent ? theme.error : theme.muted} />
          <Text style={s.body}>{line}</Text>
        </View>
      ) : null}
      {countdown && !order.disputePausedAt ? (
        <Text style={[s.sub, countdown.urgent && { color: theme.error }]}>{countdown.label}</Text>
      ) : null}
      {order.isPreOrder && order.promisedShipDate ? (
        <Text style={s.sub}>Pre-order: you promised to ship by {formatLocalDate(order.promisedShipDate)}.</Text>
      ) : null}
      {order.disputePausedAt ? (
        <Text style={s.sub}>A dispute is open, so the auto-refund is paused until it is resolved.</Text>
      ) : null}
      {shipped && !order.deliveredAt ? <Text style={s.sub}>{DELIVERY_CONFIRMED_BY_NOTE}</Text> : null}
    </View>
  );
}

function bannerStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    box: {
      borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.md,
      padding: SP.md, gap: 4,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
    title: { flex: 1, fontFamily: FONT.bold, fontSize: FS.base, color: theme.text },
    body: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text, lineHeight: 20 },
    sub: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, lineHeight: 18 },
  });
}

export interface ShippableItem {
  id: string;
  productName: string;
  variant: string;
  quantity: number;
}

/** "Ship some items": pick the items in this parcel, then carrier + tracking. */
export function ShipItemsSheet({
  visible, items, busy, onClose, onSubmit,
}: {
  visible: boolean;
  items: ShippableItem[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (itemIds: string[], trackingNumber: string, carrier: string) => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => sheetStyles(theme), [theme]);
  const [picked, setPicked] = useState<string[]>([]);
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');

  useEffect(() => {
    if (visible) { setPicked([]); setCarrier(''); setTracking(''); }
  }, [visible]);

  const canSubmit = picked.length > 0 && tracking.trim().length > 0 && !busy;
  const toggle = (id: string) => setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ModalSafeArea>
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <Text style={s.title}>Ship some items</Text>
            <Text style={s.hint}>Choose what's in this parcel. The rest stays open until you add its tracking.</Text>
            <ScrollView style={{ maxHeight: 220 }}>
              {items.map(item => {
                const on = picked.includes(item.id);
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={s.itemRow}
                    onPress={() => toggle(item.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${item.productName}${item.variant ? `, ${item.variant}` : ''}`}
                  >
                    <Feather name={on ? 'check-square' : 'square'} size={ICON.md} color={on ? theme.text : theme.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName} numberOfLines={1}>{item.productName}</Text>
                      <Text style={s.itemMeta} numberOfLines={1}>{[item.variant, `×${item.quantity}`].filter(Boolean).join(' · ')}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={{ gap: SP.sm, marginTop: SP.sm }}>
              <FormInput label="Carrier" value={carrier} onChange={setCarrier} placeholder="USPS, UPS, FedEx…" />
              <FormInput label="Tracking number" value={tracking} onChange={setTracking} placeholder="Tracking number" />
            </View>
            <View style={s.actions}>
              <SecondaryButton label="Cancel" onPress={onClose} />
              <PrimaryButton
                label={busy ? 'Saving…' : 'Save tracking'}
                onPress={() => onSubmit(picked, tracking.trim(), carrier.trim())}
                disabled={!canSubmit}
              />
            </View>
          </View>
        </View>
      </ModalSafeArea>
    </Modal>
  );
}

function sheetStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: theme.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: SP.lg, paddingBottom: SP.xl + 20,
    },
    title: { fontFamily: FONT.bold, fontSize: FS.lg, color: theme.text },
    hint: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, marginTop: 4, marginBottom: SP.sm, lineHeight: 20 },
    itemRow: {
      flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 48,
      borderBottomWidth: 1, borderBottomColor: theme.border,
    },
    itemName: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
    itemMeta: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: 2 },
    actions: { gap: SP.sm, marginTop: SP.lg },
  });
}
