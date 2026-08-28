import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert, Switch, TouchableOpacity,
} from 'react-native';
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
  BrandthreadCard, BrandthreadHeader, GradientCard, PrimaryButton,
  SecondaryButton, StatusBadge, FormInput,
} from '@/components/BrandthreadUI';
import { getOrder, createRefund } from '@/services/orderService';
import { Order, RefundType, Refund, RefundLineItem } from '@/services/orderTypes';
import { formatCents } from '@/lib/money';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REFUND_TYPES: { key: RefundType; label: string }[] = [
  { key: 'full',         label: 'Full' },
  { key: 'partial',      label: 'Partial' },
  { key: 'shipping',     label: 'Shipping Only' },
  { key: 'item',         label: 'Item-Level' },
  { key: 'store_credit', label: 'Store Credit' },
];

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

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({});
  const [refundType, setRefundType] = useState<RefundType>('full');
  const [shippingAmount, setShippingAmount] = useState(0);
  const [includeShipping, setIncludeShipping] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [restockInventory, setRestockInventory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Refund | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const o = await getOrder(orderId);
    if (o) {
      setOrder(o);
      // Initialize selected items to max qty
      const init: Record<string, number> = {};
      o.lineItems.forEach(li => { init[li.id] = li.quantity; });
      setSelectedItems(init);
      setShippingAmount(o.payment.shippingTotalCents);
    }
    setLoading(false);
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  if (loading || !order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>{loading ? 'Loading…' : 'Order not found.'}</Text>
      </View>
    );
  }

  const maxRefundable = order.payment.amountPaidCents - order.payment.amountRefundedCents;
  const alreadyRefunded = order.payment.amountRefundedCents;

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

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const lineItems: RefundLineItem[] = refundType === 'shipping'
        ? []
        : order.lineItems
            .filter(li => (selectedItems[li.id] ?? 0) > 0 || refundType === 'full')
            .map(li => ({
              lineItemId: li.id,
              productName: li.productName,
              variant: li.variant,
              quantity: refundType === 'full' ? li.quantity : (selectedItems[li.id] ?? 0),
              amountCents: li.unitPriceCents * (refundType === 'full' ? li.quantity : (selectedItems[li.id] ?? 0)),
            }));

      const refund = await createRefund(order.id, {
        type: refundType,
        lineItems,
        shippingAmountCents: refundType === 'full' || refundType === 'shipping'
          ? order.payment.shippingTotalCents
          : includeShipping ? order.payment.shippingTotalCents : 0,
        taxAmountCents: 0,
        reason: refundReason || undefined,
        restockInventory,
        returnId: returnId || undefined,
      });
      if (refund) {
        setResult(refund);
      } else {
        Alert.alert('Error', 'Could not create refund. Please try again.');
      }
    } catch (e) {
      Alert.alert('Error', 'An unexpected error occurred.');
    }
    setSubmitting(false);
  };

  // ── Success state ──
  if (result) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, paddingTop: insets.top }}>
        <BrandthreadHeader title="Refund Issued" onBack={() => router.back()} />
        <View style={styles.successWrap}>
          <GradientCard colors={['rgba(16,185,129,0.18)', 'rgba(16,185,129,0.06)']} glow style={styles.successCard}>
            <View style={styles.successIcon}>
              <Feather name="check-circle" size={ICON.xxl} color={SUCCESS} />
            </View>
            <Text style={styles.successTitle}>Refund Initiated</Text>
            <Text style={styles.successSub}>
              Refund of {formatCents(result.totalAmountCents)} submitted.{'\n'}
              Processing time: 3–5 business days.
            </Text>
            <PrimaryButton
              label="Done"
              onPress={() => router.back()}
              colors={[SUCCESS, '#34D399']}
              style={{ marginTop: SP.md }}
            />
          </GradientCard>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG, paddingTop: insets.top }}>
      <BrandthreadHeader title="Issue Refund" onBack={() => router.back()} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl, gap: SP.md }}
      >
        {/* 2. REFUND NOTICE */}
        <View style={styles.demoNotice}>
          <Feather name="alert-triangle" size={ICON.sm} color={ORANGE} />
          <Text style={styles.demoText}>
            Refunds are processed via Stripe. Funds are returned to the original payment method.
          </Text>
        </View>

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
              <Switch
                value={includeShipping}
                onValueChange={setIncludeShipping}
                trackColor={{ false: BORDER, true: PURPLE }}
                thumbColor={FG}
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
            <Switch
              value={restockInventory}
              onValueChange={setRestockInventory}
              trackColor={{ false: BORDER, true: PURPLE }}
              thumbColor={FG}
            />
          </View>
        </BrandthreadCard>

        {/* 9. NOTIFY CUSTOMER (always on, greyed) */}
        <BrandthreadCard style={styles.section}>
          <View style={styles.switchRow}>
            <Text style={[styles.switchLabel, { color: SUBTLE }]}>Notify customer (always on)</Text>
            <Switch value={true} disabled trackColor={{ false: BORDER, true: PURPLE }} thumbColor={FG} />
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
        <PrimaryButton
          label="Issue Refund"
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitting || computedTotal <= 0 || overMax}
          icon="dollar-sign"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  centered:       { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
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
    borderRadius: RADIUS.pill, backgroundColor: CARD,
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
});
