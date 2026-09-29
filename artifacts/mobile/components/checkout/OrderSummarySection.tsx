/**
 * ORDER SUMMARY: items grouped by seller (3:4 thumbnails), each seller's
 * shipping and delivery window, then the one price breakdown (subtotal,
 * shipping, tax, discounts, total). Flat on black, hairlines between groups.
 */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { formatCents } from '@/lib/money';
import { deliveryWindowLabel } from '@/lib/checkoutPayment';
import type { CheckoutDisplayTotals } from '@/lib/checkoutReadiness';
import type { CheckoutSession } from '@/services/cartTypes';
import { FONT, FS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { CK, CheckoutSection } from './CheckoutPrimitives';

type Group = CheckoutSession['deliveryGroups'][number];
type LineItem = Group['items'][number];

const THUMB = { width: 60, height: 80 }; // 3:4

function Thumb({ uri }: { uri?: string }) {
  if (uri) return <Image source={{ uri }} style={[styles.thumb, THUMB]} resizeMode="cover" />;
  return (
    <View style={[styles.thumb, THUMB, styles.thumbFallback]}>
      <Feather name="image" size={16} color={CK.subtle} />
    </View>
  );
}

function ItemRow({ item }: { item: LineItem }) {
  const meta = [item.variantTitle, `Qty ${item.quantity}`].filter(Boolean).join(' · ');
  return (
    <View style={styles.itemRow} accessible accessibilityLabel={`${item.productName}, ${meta}, ${formatCents(item.priceCents * item.quantity)}`}>
      <Thumb uri={item.imageUri} />
      <View style={styles.itemCopy}>
        <Text style={styles.itemName} numberOfLines={2}>{item.productName}</Text>
        <Text style={styles.itemMeta} numberOfLines={1}>{meta}</Text>
        {item.isPreOrder ? (
          <Text style={styles.itemMeta} numberOfLines={1}>
            Pre-order{item.preOrderEstShipDate ? ` · ships ${item.preOrderEstShipDate}` : ''}
          </Text>
        ) : null}
      </View>
      <Text style={styles.itemPrice}>{formatCents(item.priceCents * item.quantity)}</Text>
    </View>
  );
}

/** The seller's delivery window: from the server's quote when known, else the session's method. */
export function groupDeliveryWindow(group: Group, processingDays?: number | null): string {
  const method = group.availableMethods.find(m => m.id === group.selectedMethodId);
  return deliveryWindowLabel({
    isPreOrder: group.hasPreOrder || !!method?.isPreOrderEstimate,
    processingDays: processingDays ?? (method && method.estimatedDays > 0 ? method.estimatedDays : null),
  });
}

function SellerGroup({ group, shippingCents, processingDays, first }: {
  group: Group; shippingCents: number | null; processingDays: number | null; first: boolean;
}) {
  const method = group.availableMethods.find(m => m.id === group.selectedMethodId);
  const shipping = shippingCents ?? method?.priceCents ?? null;
  return (
    <View style={first ? undefined : styles.groupDivider} testID={`checkout-seller-group-${group.sellerId}`}>
      <Text style={styles.seller} numberOfLines={1}>From {group.sellerName}</Text>
      <View style={styles.items}>
        {group.items.map(item => <ItemRow key={item.id} item={item} />)}
      </View>
      <View style={styles.deliveryRow} testID="checkout-delivery-window">
        <Feather name="truck" size={14} color={CK.muted} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.deliveryTitle}>
            {method ? method.service : 'No delivery option available'}
            {shipping !== null ? ` · ${shipping === 0 ? 'Free' : formatCents(shipping)}` : ''}
          </Text>
          <Text style={styles.deliverySub}>
            {method ? groupDeliveryWindow(group, processingDays) : `We couldn’t get a shipping rate from ${group.sellerName}. Try again in a moment.`}
          </Text>
        </View>
      </View>
    </View>
  );
}

function Line({ label, value, strong, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  return (
    <View style={styles.line} testID={testID}>
      <Text style={strong ? styles.totalLabel : styles.label}>{label}</Text>
      <Text style={strong ? styles.totalValue : styles.value}>{value}</Text>
    </View>
  );
}

export function OrderSummarySection({
  session, totals, itemCount, taxNote, quotedGroups,
}: {
  session: CheckoutSession;
  totals: CheckoutDisplayTotals;
  itemCount: number;
  /** Shown instead of a tax amount until tax is known (e.g. "Added with your address"). */
  taxNote?: string;
  /** Per-seller numbers from the server's quote, when available. */
  quotedGroups?: Array<{ sellerId: string; shippingCents: number; processingDays: number | null }>;
}) {
  return (
    <CheckoutSection title="Order summary" testID="checkout-order-summary">
      {session.deliveryGroups.map((group, index) => {
        const quoted = quotedGroups?.find(q => q.sellerId === group.sellerId);
        return (
          <SellerGroup
            key={group.sellerId}
            group={group}
            first={index === 0}
            shippingCents={quoted?.shippingCents ?? null}
            processingDays={quoted?.processingDays ?? null}
          />
        );
      })}
      <View style={styles.totals} testID="checkout-price-breakdown">
        <Line label={`Subtotal (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`} value={formatCents(totals.subtotalCents)} />
        <Line label="Shipping" value={totals.shippingCents === 0 ? 'Free' : formatCents(totals.shippingCents)} />
        <Line
          label="Tax"
          value={taxNote ?? formatCents(totals.taxCents)}
          testID="checkout-tax-line"
        />
        {totals.promoCents > 0 ? (
          <Line label="Discount" value={`−${formatCents(totals.promoCents)}`} testID="checkout-discount-line" />
        ) : null}
        {totals.rewardsCents > 0 ? <Line label="Rewards" value={`−${formatCents(totals.rewardsCents)}`} /> : null}
        {totals.threadCashCents > 0 ? (
          <>
            <Line label="Order total" value={formatCents(totals.orderTotalCents)} testID="checkout-order-total-line" />
            <Line label="Thread Cash" value={`−${formatCents(totals.threadCashCents)}`} testID="checkout-thread-cash-line" />
          </>
        ) : null}
        <View style={styles.totalDivider} />
        <Line
          label={totals.threadCashCents > 0 ? 'Charged to card' : 'Total'}
          value={formatCents(totals.totalCents)}
          strong
          testID="checkout-total-line"
        />
      </View>
    </CheckoutSection>
  );
}

const styles = StyleSheet.create({
  groupDivider: { borderTopWidth: 1, borderTopColor: CK.divider, marginTop: SP.md, paddingTop: SP.md },
  seller: { fontFamily: FONT.semibold, fontSize: FS.sm, color: CK.text, marginBottom: SP.sm + 2 },
  items: { gap: SP.sm + 4 },
  thumb: { borderRadius: 6, overflow: 'hidden', backgroundColor: '#111111' },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm + 4 },
  itemCopy: { flex: 1, minWidth: 0, paddingTop: 2 },
  itemName: { fontFamily: FONT.medium, fontSize: FS.base, lineHeight: 20, color: CK.text },
  itemMeta: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, marginTop: 3, color: CK.muted },
  itemPrice: { fontFamily: FONT.medium, fontSize: FS.base, paddingTop: 2, color: CK.text, ...TABULAR_NUMS },
  deliveryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginTop: SP.sm + 4 },
  deliveryTitle: { fontFamily: FONT.medium, fontSize: FS.sm, color: CK.text },
  deliverySub: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2, color: CK.muted },
  totals: { borderTopWidth: 1, borderTopColor: CK.divider, marginTop: SP.md + 2, paddingTop: SP.sm + 4 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: SP.sm, paddingVertical: 5 },
  label: { fontFamily: FONT.regular, fontSize: FS.base, flexShrink: 1, color: CK.muted },
  value: { fontFamily: FONT.medium, fontSize: FS.base, color: CK.text, ...TABULAR_NUMS },
  totalDivider: { height: 1, backgroundColor: CK.divider, marginVertical: SP.sm },
  totalLabel: { fontFamily: FONT.semibold, fontSize: FS.md, color: CK.text },
  totalValue: { fontFamily: FONT.bold, fontSize: FS.lg, color: CK.text, ...TABULAR_NUMS },
});
