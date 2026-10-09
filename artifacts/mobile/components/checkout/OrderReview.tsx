/**
 * GOAT's "Order review", 1:1 and reskinned
 * (https://mobbin.com/flows/c34f9bac-a2d5-4cf8-a371-800e7329649d, step 3):
 * the product summary (name, size, quantity, photo on the right), the
 * shipping options as side-by-side selectable cards (arrival + price, the
 * selected one with a white border), then chevron rows ("Ship to …",
 * "Payment"), the Total with its breakdown, and the small legal line with
 * the Buyer Protection link. The page (app/buyer-checkout.tsx) keeps all
 * the payment logic; these only draw it.
 */
import React, { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { formatCents } from '@/lib/money';
import type { CheckoutDisplayTotals } from '@/lib/checkoutReadiness';
import type { CheckoutAddress, CheckoutSession } from '@/services/cartTypes';
import { FONT, FS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { GUARANTEE_DAYS } from '@/lib/deliveryGuarantee';
import { LEGAL_DOCUMENTS } from '@/content/legal';
import { groupDeliveryWindow } from './OrderSummarySection';
import { useCheckoutColors, type CheckoutColors } from './CheckoutPrimitives';

type Group = CheckoutSession['deliveryGroups'][number];

const THUMB = { width: 72, height: 96 }; // 3:4

// ─── Product summary ──────────────────────────────────────────────────────────

export function ReviewItems({ session }: { session: CheckoutSession }) {
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const items = session.deliveryGroups.flatMap(group => group.items.map(item => ({ item, group })));
  return (
    <View testID="order-review-items">
      {items.map(({ item, group }, index) => (
        <View
          key={item.id}
          style={[s.item, index > 0 && s.rule]}
          accessible
          accessibilityLabel={`${item.productName}, ${item.variantTitle || 'one size'}, quantity ${item.quantity}, from ${group.sellerName}`}
        >
          <View style={s.itemCopy}>
            <Text style={s.itemName} numberOfLines={3}>{item.productName}</Text>
            {!!item.variantTitle && item.variantTitle !== 'Default' && <Text style={s.itemMeta}>Size: {item.variantTitle}</Text>}
            <Text style={s.itemMeta}>Quantity: {item.quantity}</Text>
            <Text style={s.itemMeta}>From: {group.sellerName}</Text>
            {item.isPreOrder ? <Text style={s.itemMeta}>Pre-order</Text> : null}
          </View>
          {item.imageUri
            ? <Image source={{ uri: item.imageUri }} style={THUMB} resizeMode="contain" />
            : <View style={[THUMB, s.thumbFallback]}><Icon name="image" size={17} color={ck.subtle} /></View>}
        </View>
      ))}
    </View>
  );
}

// ─── Shipping option cards ────────────────────────────────────────────────────

export function ShippingOptions({
  session, quotedGroups,
}: {
  session: CheckoutSession;
  quotedGroups?: Array<{ sellerId: string; shippingCents: number; processingDays: number | null }>;
}) {
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  return (
    <View style={s.section} testID="order-review-shipping">
      {session.deliveryGroups.map((group: Group) => {
        const quoted = quotedGroups?.find(q => q.sellerId === group.sellerId);
        return (
          <View key={group.sellerId} style={s.shipGroup}>
            {session.deliveryGroups.length > 1 && <Text style={s.shipFrom}>{group.sellerName}</Text>}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cards}>
              {group.availableMethods.length === 0 ? (
                <View style={[s.card, s.cardIdle]}>
                  <Text style={s.cardMeta}>No delivery option from {group.sellerName} yet. Try again in a moment.</Text>
                </View>
              ) : group.availableMethods.map(method => {
                const selected = method.id === group.selectedMethodId;
                const price = selected && quoted ? quoted.shippingCents : method.priceCents;
                return (
                  <View
                    key={method.id}
                    style={[s.card, selected ? s.cardSelected : s.cardIdle]}
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${method.service}, ${groupDeliveryWindow(group, quoted?.processingDays ?? null)}, ${price === 0 ? 'free shipping' : `${formatCents(price)} shipping`}`}
                    testID={`order-review-ship-${method.id}`}
                  >
                    <Text style={s.cardTitle}>{method.service || 'Standard'}</Text>
                    <Text style={s.cardMeta}>{groupDeliveryWindow(group, quoted?.processingDays ?? null)}</Text>
                    <Text style={s.cardPrice}>{price === 0 ? 'Free shipping' : `+${formatCents(price)} shipping`}</Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        );
      })}
    </View>
  );
}

// ─── Chevron row ──────────────────────────────────────────────────────────────

export function ReviewRow({
  label, value, onPress, expanded, children, testID,
}: {
  label: string;
  /** Right-hand value: text or a mark (e.g. the Apple Pay badge). */
  value: React.ReactNode;
  onPress: () => void;
  expanded?: boolean;
  /** Shown under the row while expanded (the address form, the card field, …). */
  children?: React.ReactNode;
  testID?: string;
}) {
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  return (
    <View style={s.rowWrap}>
      <Pressable
        onPress={onPress}
        style={s.row}
        accessibilityRole="button"
        accessibilityState={{ expanded: !!expanded }}
        accessibilityLabel={`${label}${typeof value === 'string' ? `, ${value}` : ''}`}
        testID={testID}
      >
        <Text style={s.rowLabel}>{label}</Text>
        <View style={s.rowValue}>
          {typeof value === 'string' ? <Text style={s.rowValueText} numberOfLines={1}>{value}</Text> : value}
        </View>
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={17} color={ck.text} />
      </Pressable>
      {expanded && children ? <View style={s.rowBody}>{children}</View> : null}
    </View>
  );
}

/** "1226 University Dr, Menlo Park, CA" — or null while the address is incomplete. */
export function addressSummary(address: Partial<CheckoutAddress>): string | null {
  if (!address.line1 || !address.city) return null;
  return [address.line1, address.city, address.state].filter(Boolean).join(', ');
}

/** The Apple Pay / Google Pay mark GOAT puts on its Payment row. */
export function WalletMark({ kind }: { kind: 'apple' | 'google' }) {
  return (
    <View style={walletStyles.mark} accessibilityLabel={kind === 'apple' ? 'Apple Pay' : 'Google Pay'}>
      {kind === 'apple'
        ? <FontAwesome name="apple" size={13} color="#000000" />
        : <Text style={walletStyles.g}>G</Text>}
      <Text style={walletStyles.pay}>Pay</Text>
    </View>
  );
}

const walletStyles = StyleSheet.create({
  mark: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#FFFFFF', borderRadius: 4, paddingHorizontal: 6, height: 22 },
  g: { fontFamily: FONT.bold, fontSize: 12, color: '#000000' },
  pay: { fontFamily: FONT.semibold, fontSize: 12, color: '#000000' },
});

// ─── Totals ───────────────────────────────────────────────────────────────────

export function ReviewTotals({
  totals, itemCount, taxNote, giftCardCents = 0,
}: {
  totals: CheckoutDisplayTotals;
  itemCount: number;
  taxNote?: string;
  giftCardCents?: number;
}) {
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const line = (label: string, value: string, testID?: string) => (
    <View style={s.line} testID={testID}>
      <Text style={s.lineLabel}>{label}</Text>
      <Text style={s.lineValue}>{value}</Text>
    </View>
  );
  return (
    <View style={s.totals} testID="checkout-price-breakdown">
      <View style={s.totalRow}>
        <Text style={s.totalLabel}>Total</Text>
        <Text style={s.totalValue} testID="checkout-total">{formatCents(totals.totalCents)}</Text>
      </View>
      {line(`Item subtotal (${itemCount})`, formatCents(totals.subtotalCents))}
      {line('Shipping', totals.shippingCents === 0 ? 'Free' : formatCents(totals.shippingCents))}
      {line('Estimated tax', taxNote ?? formatCents(totals.taxCents), 'checkout-tax-line')}
      {totals.promoCents > 0 ? line('Discount', `−${formatCents(totals.promoCents)}`, 'checkout-discount-line') : null}
      {totals.rewardsCents > 0 ? line('Points', `−${formatCents(totals.rewardsCents)}`) : null}
      {totals.threadCashCents > 0 ? line('Thread Cash', `−${formatCents(totals.threadCashCents)}`, 'checkout-thread-cash-line') : null}
      {giftCardCents > 0 ? line('Gift card', `−${formatCents(giftCardCents)}`) : null}
    </View>
  );
}

// ─── Legal line ───────────────────────────────────────────────────────────────

export function ReviewLegal({ preorder }: { preorder: boolean }) {
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const router = useRouter();
  const days = preorder ? GUARANTEE_DAYS.preorder : GUARANTEE_DAYS.regular;
  return (
    <Text style={s.legal} testID="order-review-legal">
      By proceeding, you agree to the{' '}
      <Text style={s.link} onPress={() => router.push(LEGAL_DOCUMENTS.terms.route as never)} accessibilityRole="link">Buyer Protection Policy</Text>
      {' '}and the{' '}
      <Text style={s.link} onPress={() => router.push(LEGAL_DOCUMENTS['refund-policy'].route as never)} accessibilityRole="link">Returns Policy</Text>
      . Not delivered within {days} days? You’re refunded automatically.
    </Text>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (ck: CheckoutColors) => StyleSheet.create({
  item: { flexDirection: 'row', gap: SP.md, paddingVertical: SP.md },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ck.divider },
  itemCopy: { flex: 1, minWidth: 0, gap: 4 },
  itemName: { fontFamily: FONT.semibold, fontSize: FS.base, lineHeight: 21, color: ck.text, marginBottom: SP.xs },
  itemMeta: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.text },
  thumbFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1E' },

  section: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ck.divider, paddingVertical: SP.md },
  shipGroup: { gap: SP.xs },
  shipFrom: { fontFamily: FONT.medium, fontSize: FS.sm, color: ck.muted },
  cards: { gap: SP.sm },
  card: { width: 200, minHeight: 112, borderRadius: 12, padding: SP.md, gap: 4, justifyContent: 'space-between' },
  cardSelected: { borderWidth: 1.5, borderColor: '#FFFFFF' },
  cardIdle: { borderWidth: StyleSheet.hairlineWidth, borderColor: ck.fieldBorder },
  cardTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, color: ck.text },
  cardMeta: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.muted },
  cardPrice: { fontFamily: FONT.medium, fontSize: FS.sm, color: ck.text, ...TABULAR_NUMS },

  rowWrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ck.divider },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 56 },
  rowLabel: { fontFamily: FONT.medium, fontSize: FS.base, color: ck.text },
  rowValue: { flex: 1, alignItems: 'flex-end', minWidth: 0 },
  rowValueText: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.text },
  rowBody: { paddingBottom: SP.md },

  totals: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ck.divider, paddingVertical: SP.md, gap: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  totalLabel: { fontFamily: FONT.semibold, fontSize: FS.md, color: ck.text },
  totalValue: { fontFamily: FONT.semibold, fontSize: FS.md, color: ck.text, ...TABULAR_NUMS },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineLabel: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.muted },
  lineValue: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.muted, ...TABULAR_NUMS },

  legal: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 17, color: ck.muted, textAlign: 'center' },
  link: { color: ck.text, textDecorationLine: 'underline' },
});
