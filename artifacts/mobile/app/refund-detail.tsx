import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, CYAN, SUCCESS, SUCCESS_DIM,
  BLUE, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import {
  BrandthreadCard, PrimaryButton,
  FormInput, HapticSwitch,} from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Order, RefundType } from '@/services/orderTypes';
import { formatCents } from '@/lib/money';
import { useApi } from '@/lib/api';
import { adaptApiOrder } from '@/app/order-detail';
import { radius } from '@/constants/radii';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REFUND_TYPES: { key: RefundType; label: string }[] = [
  { key: 'full',         label: 'Full' },
  { key: 'partial',      label: 'Partial' },
  { key: 'shipping',     label: 'Shipping Only' },
  { key: 'item',         label: 'Item-Level' },
];

// How the buyer is paid back (items 113/114) — Shopify's refund screen
// "Refund method" (https://mobbin.com/screens/553767d9-701a-4000-a0e6-27804b6ed499).
// Store credit used to be a "Refund Type" chip; it is a method, not an amount.
type SellerRefundMethod = 'original' | 'store_credit';
const REFUND_METHODS: { key: SellerRefundMethod; label: string }[] = [
  { key: 'original',     label: 'Original payment' },
  { key: 'store_credit', label: 'Store credit' },
];

function newRequestId(): string {
  return `rf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Qty Selector ─────────────────────────────────────────────────────────────

function QtySelector({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  return (
    <View style={qtyS.root}>
      <TouchableOpacity
        style={qtyS.btn}
        onPress={() => onChange(Math.max(0, value - 1))}
      >
        <Feather name="minus" size={ICON.xs} color={value === 0 ? SUBTLE : FG} />
      </TouchableOpacity>
      <Text style={qtyS.val}>{value}</Text>
      <TouchableOpacity
        style={qtyS.btn}
        onPress={() => onChange(Math.min(max, value + 1))}
      >
        <Feather name="plus" size={ICON.xs} color={value === max ? SUBTLE : FG} />
      </TouchableOpacity>
    </View>
  );
}

const qtyS = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  btn:  { width: 28, height: 28, borderRadius: RADIUS.sm, backgroundColor: CARD_ELEVATED,
          borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  val:  { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, minWidth: 24, textAlign: 'center' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RefundDetailScreen() {
  const colors = useColors();
  const { orderId, returnId } = useLocalSearchParams<{ orderId: string; returnId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});
  const [refundType, setRefundType] = useState<RefundType>('full');
  const [shippingAmount, setShippingAmount] = useState(0);
  const [includeShipping, setIncludeShipping] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [restockInventory, setRestockInventory] = useState(false);
  const [refundMethod, setRefundMethod] = useState<SellerRefundMethod>('original');
  const [refundedCents, setRefundedCents] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ amountCents: number; method: SellerRefundMethod } | null>(null);
  // One refund per visit: a double tap or retry reuses the same request id.
  const requestId = useMemo(newRequestId, []);

  const load = useCallback(async () => {
    // No order id at all (e.g. a bad/incomplete deep link) — nothing to
    // fetch; show "Order not found" without firing a request that can only
    // ever 404.
    if (!orderId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const raw = await api.orders.get(orderId);
      const o = raw ? adaptApiOrder(raw) : null;
      setRefundedCents(Math.max(0, Number((raw as { refundedCents?: number } | null)?.refundedCents ?? 0) || 0));
      if (o) {
        setOrder(o);
        // Initialize selected items to max qty
        const init: Record<string, number> = {};
        o.lineItems.forEach(li => { init[li.id] = li.quantity; });
        setSelectedItems(init);
        setShippingAmount(o.payment.shippingTotalCents);
      } else {
        setOrder(null);
      }
    } catch (err) {
      if (__DEV__) console.warn('[refund-detail] failed to load order', err);
      setOrder(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api, orderId]);

  useEffect(() => { load(); }, [load]);

  if (loading || !order) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <ScreenHeader title="Issue Refund" onBack={() => goBackOr(router)} />
        <View style={styles.centered}>
          <Text style={styles.loadingText}>
            {loading ? 'Loading…' : loadError ? 'Couldn’t load this order. Check your connection and try again.' : 'Order not found.'}
          </Text>
        </View>
      </View>
    );
  }

  const alreadyRefunded = Math.max(order.payment.amountRefundedCents, refundedCents);
  const maxRefundable = Math.max(0, order.payment.amountPaidCents - alreadyRefunded);

  // Compute item total from selections
  const itemTotal = (() => {
    if (refundType === 'shipping') return 0;
    if (refundType === 'full') {
      return order.lineItems.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
    }
    return order.lineItems.reduce((s, li) => {
      const qty = selectedItems[li.id] ?? 0;
      return s + li.unitPriceCents * qty;
    }, 0);
  })();

  const shippingRefund = includeShipping || refundType === 'shipping' || refundType === 'full'
    ? (refundType === 'shipping' ? order.payment.shippingTotalCents : shippingAmount)
    : 0;

  const refundTotal = itemTotal + (includeShipping ? order.payment.shippingTotalCents : 0) +
    (refundType === 'shipping' ? order.payment.shippingTotalCents : 0) +
    (refundType === 'full' ? order.payment.shippingTotalCents : 0);

  // Avoid double counting — simpler: just compute directly
  const computedTotal = (() => {
    if (refundType === 'full') return order.payment.subtotalCents + order.payment.shippingTotalCents;
    if (refundType === 'shipping') return order.payment.shippingTotalCents;
    const items = order.lineItems.reduce((sum, item) => sum + item.unitPriceCents * (selectedItems[item.id] ?? 0), 0);
    const shipping = includeShipping ? order.payment.shippingTotalCents : 0;
    return items + shipping;
  })();

  const overMax = computedTotal > maxRefundable;

  // POST /api/orders/:id/refund — the same refund service as cancellations
  // and returns. Original payment refunds the card; store credit issues a
  // gift card for this store and the seller keeps the payment.
  const submit = async () => {
    if (computedTotal <= 0 || overMax || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.orders.refund(order.id, {
        amountCents: computedTotal,
        method: refundMethod,
        clientRequestId: requestId,
        ...(refundReason.trim() ? { note: refundReason.trim() } : {}),
        restock: restockInventory,
        items: order.lineItems
          .map(li => ({ lineItemId: li.id, quantity: refundType === 'full' ? li.quantity : (selectedItems[li.id] ?? 0) }))
          .filter(li => li.quantity > 0),
      });
      setDone({ amountCents: result.amountCents, method: result.method });
    } catch (err) {
      const raw = (err as { body?: string } | null)?.body ?? '';
      let message = '';
      try { message = JSON.parse(raw)?.error ?? ''; } catch { message = ''; }
      setSubmitError(message || 'Couldn’t issue this refund. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <ScreenHeader title="Issue Refund" onBack={() => goBackOr(router)} />
        <View style={styles.successWrap}>
          <BrandthreadCard elevated style={styles.successCard}>
            <Feather name="check-circle" size={32} color={colors.foreground} style={styles.successIcon} />
            <Text style={[styles.successTitle, { color: colors.foreground }]}>
              {done.method === 'store_credit' ? `${formatCents(done.amountCents)} store credit issued` : `${formatCents(done.amountCents)} refunded`}
            </Text>
            <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
              {done.method === 'store_credit'
                ? `${order.customer.name} got a gift card for your store by email.`
                : `Back to ${order.customer.name}’s original payment in 5–10 business days.`}
            </Text>
          </BrandthreadCard>
          <PrimaryButton label="Back to order" onPress={() => goBackOr(router)} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <ScreenHeader title="Issue Refund" onBack={() => goBackOr(router)} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl, gap: SP.md }}
      >
        {/* 3. ORIGINAL PAYMENT SUMMARY */}
        <BrandthreadCard elevated style={styles.section}>
          <Text style={styles.sectionTitle}>Original Payment</Text>
          <View style={styles.payRow}>
            <Text style={styles.payLabel}>Paid</Text>
            <Text style={styles.payValue}>{formatCents(order.payment.amountPaidCents)}</Text>
          </View>
          <View style={styles.payRow}>
            <Text style={styles.payLabel}>Already refunded</Text>
            <Text style={[styles.payValue, { color: RED }]}>
              {alreadyRefunded > 0 ? `-${formatCents(alreadyRefunded)}` : formatCents(0)}
            </Text>
          </View>
          <View style={[styles.payRow, styles.payRowTotal]}>
            <Text style={styles.payLabelBold}>Max refundable</Text>
            <Text style={styles.payValueBold}>{formatCents(maxRefundable)}</Text>
          </View>
        </BrandthreadCard>

        {/* 4. REFUND TYPE */}
        <View>
          <Text style={styles.sectionHeader}>Refund Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {REFUND_TYPES.map(rt => (
                <TouchableOpacity
                  key={rt.key}
                  style={[styles.chip, refundType === rt.key && styles.chipActive]}
                  onPress={() => setRefundType(rt.key)}
                >
                  <Text style={[styles.chipText, refundType === rt.key && styles.chipTextActive]}>
                    {rt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* 4b. REFUND METHOD */}
        <View>
          <Text style={styles.sectionHeader}>Refund method</Text>
          <BrandthreadCard style={styles.section}>
            {REFUND_METHODS.map((m, idx) => {
              const selected = refundMethod === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.methodRow, idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
                  onPress={() => setRefundMethod(m.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={m.label}
                  testID={`seller-refund-method-${m.key}`}
                >
                  <View style={[styles.radio, { borderColor: selected ? colors.foreground : colors.border }]}>
                    {selected ? <View style={[styles.radioDot, { backgroundColor: colors.foreground }]} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.switchLabel, { color: colors.foreground }]}>{m.label}</Text>
                    <Text style={[styles.methodDetail, { color: colors.mutedForeground }]}>
                      {m.key === 'original'
                        ? 'Refund the buyer’s card. Your payout is adjusted.'
                        : 'A gift card for your store. You keep the payment.'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </BrandthreadCard>
        </View>

        {/* 5. LINE ITEMS */}
        {refundType !== 'shipping' && (
          <View>
            <Text style={styles.sectionHeader}>Items</Text>
            {order.lineItems.map(li => {
              const qty = refundType === 'full' ? li.quantity : (selectedItems[li.id] ?? 0);
              const subtotalCents = li.unitPriceCents * qty;
              return (
                <BrandthreadCard key={li.id} style={[styles.section, styles.itemCard]}>
                  <View style={styles.itemRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>{li.productName}</Text>
                      <Text style={styles.itemVariant}>{li.variant}</Text>
                      <Text style={styles.itemUnitPrice}>{formatCents(li.unitPriceCents)} each · max {li.quantity}</Text>
                    </View>
                    {refundType !== 'full' && (
                      <QtySelector
                        value={selectedItems[li.id] ?? 0}
                        max={li.quantity}
                        onChange={v => setSelectedItems(prev => ({ ...prev, [li.id]: v }))}
                      />
                    )}
                  </View>
                  {subtotalCents > 0 && (
                    <Text style={styles.itemSubtotal}>Subtotal: {formatCents(subtotalCents)}</Text>
                  )}
                </BrandthreadCard>
              );
            })}
          </View>
        )}

        {/* 6. SHIPPING */}
        {refundType !== 'shipping' && refundType !== 'full' && (
          <BrandthreadCard style={styles.section}>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Include shipping ({formatCents(order.payment.shippingTotalCents)})</Text>
              <HapticSwitch
                value={includeShipping}
                onValueChange={setIncludeShipping}
              />
            </View>
          </BrandthreadCard>
        )}

        {/* 7. REASON */}
        <FormInput
          label="Reason (optional)"
          value={refundReason}
          onChange={setRefundReason}
          placeholder="Describe why this refund is being issued…"
          multiline
        />

        {/* 8. RESTOCK */}
        <BrandthreadCard style={styles.section}>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Return item to inventory</Text>
            <HapticSwitch
              value={restockInventory}
              onValueChange={setRestockInventory}
            />
          </View>
        </BrandthreadCard>

        {/* 9. NOTIFY CUSTOMER (always on, greyed) */}
        <BrandthreadCard style={styles.section}>
          <View style={styles.switchRow}>
            <Text style={[styles.switchLabel, { color: SUBTLE }]}>Notify customer (always on)</Text>
            <HapticSwitch value={true} disabled />
          </View>
        </BrandthreadCard>

        {/* 10. SUMMARY */}
        <BrandthreadCard elevated style={styles.section}>
          <Text style={styles.sectionTitle}>Refund Summary</Text>
          <View style={styles.payRow}>
            <Text style={styles.payLabel}>Item total</Text>
            <Text style={styles.payValue}>{formatCents(itemTotal)}</Text>
          </View>
          <View style={styles.payRow}>
            <Text style={styles.payLabel}>Shipping</Text>
            <Text style={styles.payValue}>
              {formatCents(refundType === 'full' || refundType === 'shipping'
                ? order.payment.shippingTotalCents
                : includeShipping ? order.payment.shippingTotalCents : 0)}
            </Text>
          </View>
          <View style={styles.payRow}>
            <Text style={styles.payLabel}>Tax</Text>
            <Text style={styles.payValue}>$0.00</Text>
          </View>
          <View style={styles.divider} />
          <View style={[styles.payRow, styles.payRowTotal]}>
            <Text style={styles.payLabelBold}>Refund total</Text>
            <Text style={[styles.payValueBold, overMax && { color: RED }]}>
              {formatCents(computedTotal)}
            </Text>
          </View>
          {overMax && (
            <View style={styles.warningRow}>
              <Feather name="alert-triangle" size={ICON.xs} color={RED} />
              <Text style={styles.warningText}>
                Amount exceeds max refundable ({formatCents(maxRefundable)})
              </Text>
            </View>
          )}
        </BrandthreadCard>

        {/* 11. SUBMIT */}
        {submitError ? (
          <View style={styles.warningRow} accessibilityRole="alert">
            <Feather name="alert-circle" size={ICON.xs} color={colors.foreground} />
            <Text style={[styles.warningText, { color: colors.foreground }]}>{submitError}</Text>
          </View>
        ) : null}
        <PrimaryButton
          label={refundMethod === 'store_credit' ? `Issue ${formatCents(computedTotal)} store credit` : `Refund ${formatCents(computedTotal)}`}
          onPress={submit}
          loading={submitting}
          disabled={computedTotal <= 0 || overMax || submitting}
          icon="dollar-sign"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  centered:       { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  loadingText:    { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED },
  successWrap:    { flex: 1, padding: SP.md, justifyContent: 'center' },
  successCard:    { alignItems: 'center', gap: SP.sm, padding: SP.lg },
  successIcon:    { marginBottom: SP.sm },
  successTitle:   { fontSize: FS.xl, fontFamily: FONT.bold, color: SUCCESS, textAlign: 'center' },
  successSub:     { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 20 },
  demoNotice:     {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm,
    backgroundColor: ORANGE_DIM, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: ORANGE + '55', padding: SP.md,
  },
  demoText:       { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: ORANGE, lineHeight: 18 },
  section:        { gap: SP.sm },
  sectionTitle:   { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginBottom: SP.xs },
  sectionHeader:  { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginBottom: SP.sm },
  payRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payLabel:       { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  payValue:       { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  payRowTotal:    { marginTop: SP.xs },
  payLabelBold:   { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  payValueBold:   { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  divider:        { height: 1, backgroundColor: BORDER, marginVertical: SP.sm },
  warningRow:     { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginTop: SP.xs },
  warningText:    { fontSize: FS.xs, fontFamily: FONT.medium, color: RED },
  chipRow:        { flexDirection: 'row', gap: SP.sm, paddingVertical: SP.xs },
  chip:           {
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderRadius: radius.sm, backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER,
  },
  chipActive:     { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  chipText:       { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  chipTextActive: { color: PURPLE, fontFamily: FONT.semibold },
  itemCard:       { marginBottom: SP.sm },
  itemRow:        { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  itemName:       { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  itemVariant:    { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  itemUnitPrice:  { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  itemSubtotal:   { fontSize: FS.sm, fontFamily: FONT.semibold, color: CYAN, marginTop: SP.xs },
  switchRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel:    { fontSize: FS.sm, fontFamily: FONT.medium, color: FG, flex: 1 },
  methodRow:      { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 52, paddingVertical: SP.xs },
  methodDetail:   { fontSize: FS.xs + 1, fontFamily: FONT.regular, marginTop: 2, lineHeight: 18 },
  radio:          { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot:       { width: 9, height: 9, borderRadius: 5 },
});
