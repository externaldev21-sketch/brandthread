/**
 * "Order review", laid out like the Shop app's Review & Pay
 * (Mobbin 469375d4-5ee8-450a-80ca-30582b5e7b38), reskinned black / white /
 * silver: the product summary, Shipping as one full-width row per store
 * ("Free shipping · Arrives Oct 16–20"; a radio list only when a store
 * offers 2+ ways to ship), the Contact / Ship to rows (name above the full
 * one-line address; each opens a sheet), Payment, the price breakdown ending
 * in the Total, and one legal line under Pay: "Protected by Buyer
 * Protection · Returns Policy". The page (app/buyer-checkout.tsx) keeps all
 * the payment logic; these only draw it.
 */
import React, { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { buyerProtectionLines } from '@/content/buyerProtection';
import { addressOneLine } from '@/lib/addressFormat';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { shippingLine } from '@/lib/checkoutDelivery';
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

// ─── Shipping (Shop: one full-width row per store) ─────────────────────────────

/**
 * Each store as a row: its name, then "Free shipping · Arrives Oct 16–20".
 * Rows are informational. Only a store that actually offers 2+ ways to ship
 * gets a radio list to choose from.
 */
export function ShippingOptions({
  session, quotedGroups, onSelectMethod, today,
}: {
  session: CheckoutSession;
  quotedGroups?: Array<{ sellerId: string; shippingCents: number; processingDays: number | null }>;
  /** Called when a store offers several methods and the buyer picks one. */
  onSelectMethod?: (sellerId: string, methodId: string) => void;
  /** For tests and screenshots; defaults to now. */
  today?: Date;
}) {
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  return (
    <View style={s.section} testID="order-review-shipping">
      <Text style={s.sectionLabel}>Shipping</Text>
      {session.deliveryGroups.map((group: Group, index) => {
        const quoted = quotedGroups?.find(q => q.sellerId === group.sellerId);
        const isPreOrder = group.hasPreOrder;
        const methods = group.availableMethods;
        const lineFor = (method: Group['availableMethods'][number], selected: boolean) => shippingLine({
          priceCents: selected && quoted ? quoted.shippingCents : method.priceCents,
          processingDays: selected && quoted ? quoted.processingDays : (method.estimatedDays > 0 ? method.estimatedDays : null),
          isPreOrder: isPreOrder || !!method.isPreOrderEstimate,
        }, today);
        if (methods.length === 0) {
          return (
            <View key={group.sellerId} style={[s.shipRow, index > 0 && s.rule]} testID={`order-review-ship-${group.sellerId}`}>
              <Text style={s.shipStore} numberOfLines={1}>{group.sellerName}</Text>
              <Text style={s.shipLine}>No delivery option from {group.sellerName} yet. Try again in a moment.</Text>
            </View>
          );
        }
        if (methods.length === 1 || !onSelectMethod) {
          const method = methods.find(m => m.id === group.selectedMethodId) ?? methods[0];
          const line = lineFor(method, true);
          return (
            <View
              key={group.sellerId}
              style={[s.shipRow, index > 0 && s.rule]}
              accessible
              accessibilityLabel={`${group.sellerName}: ${line}`}
              testID={`order-review-ship-${group.sellerId}`}
            >
              <Text style={s.shipStore} numberOfLines={1}>{group.sellerName}</Text>
              <Text style={s.shipLine} testID={`order-review-ship-line-${group.sellerId}`}>{line}</Text>
            </View>
          );
        }
        return (
          <View key={group.sellerId} style={[s.shipRow, index > 0 && s.rule]} testID={`order-review-ship-${group.sellerId}`}>
            <Text style={s.shipStore} numberOfLines={1}>{group.sellerName}</Text>
            <View accessibilityRole="radiogroup" style={s.shipChoices}>
              {methods.map(method => {
                const selected = method.id === group.selectedMethodId;
                return (
                  <Pressable
                    key={method.id}
                    onPress={() => { if (!selected) onSelectMethod(group.sellerId, method.id); }}
                    style={s.shipChoice}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${method.service || 'Standard'}, ${lineFor(method, selected)}`}
                    testID={`order-review-ship-${group.sellerId}-${method.id}`}
                  >
                    <View style={[s.radio, { borderColor: selected ? ck.text : ck.subtle }]}>
                      {selected ? <View style={s.radioDot} /> : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.shipMethod} numberOfLines={1}>{method.service || 'Standard'}</Text>
                      <Text style={s.shipLine}>{lineFor(method, selected)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
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

/** "141 Prince St, New York, NY 10012" — or null while the address is incomplete (lib/addressFormat). */
export function addressSummary(address: Partial<CheckoutAddress>): string | null {
  return addressOneLine(address);
}

/**
 * Shop's Review & Pay row, with the label above so the whole address fits
 * on one line: "Ship to", then the name, then "141 Prince St, New York, NY
 * 10012", chevron on the right. Tapping opens the matching sheet.
 */
export function ReviewDetailRow({
  label, title, detail, placeholder, onPress, testID,
}: {
  label: string;
  title?: string | null;
  detail?: string | null;
  /** Shown when there's nothing yet ("Add address"). */
  placeholder: string;
  onPress: () => void;
  testID?: string;
}) {
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const empty = !title && !detail;
  return (
    <Pressable
      onPress={onPress}
      style={s.detailRow}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${empty ? placeholder : [title, detail].filter(Boolean).join(', ')}`}
      testID={testID}
    >
      <View style={s.detailCopy}>
        <Text style={s.detailLabel}>{label}</Text>
        {empty ? <Text style={s.detailTitle}>{placeholder}</Text> : null}
        {title ? <Text style={s.detailTitle} numberOfLines={1}>{title}</Text> : null}
        {detail ? <Text style={s.detailText} numberOfLines={1} testID={testID ? `${testID}-detail` : undefined}>{detail}</Text> : null}
      </View>
      <Icon name="chevron-right" size={17} color={ck.text} />
    </Pressable>
  );
}

/** The Apple Pay / Google Pay mark GOAT puts on its Payment row. */
export function WalletMark({ kind }: { kind: 'apple' | 'google' }) {
  return (
    <View style={walletStyles.mark} accessibilityLabel={kind === 'apple' ? 'Apple Pay' : 'Google Pay'}>
      {kind === 'apple'
        ? <FontAwesome name="apple" size={13} color="#000000" /> // theme-exempt: Apple Pay black-on-white provider mark
        : <Text style={walletStyles.g}>G</Text>}
      <Text style={walletStyles.pay}>Pay</Text>
    </View>
  );
}

const walletStyles = StyleSheet.create({
  mark: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#FFFFFF', borderRadius: 4, paddingHorizontal: 6, height: 22 }, // theme-exempt: payment provider brand badge
  g: { fontFamily: FONT.bold, fontSize: 12, color: '#000000' }, // theme-exempt: provider mark on white
  pay: { fontFamily: FONT.semibold, fontSize: 12, color: '#000000' }, // theme-exempt: provider mark on white
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
      {line(`Subtotal (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`, formatCents(totals.subtotalCents), 'checkout-subtotal-line')}
      {line('Shipping', totals.shippingCents === 0 ? 'Free' : formatCents(totals.shippingCents), 'checkout-shipping-line')}
      {line('Estimated tax', taxNote ?? formatCents(totals.taxCents), 'checkout-tax-line')}
      {totals.promoCents > 0 ? line('Discount', `−${formatCents(totals.promoCents)}`, 'checkout-discount-line') : null}
      {totals.rewardsCents > 0 ? line('Points', `−${formatCents(totals.rewardsCents)}`) : null}
      {totals.threadCashCents > 0 ? line('Thread Cash', `−${formatCents(totals.threadCashCents)}`, 'checkout-thread-cash-line') : null}
      {giftCardCents > 0 ? line('Gift card', `−${formatCents(giftCardCents)}`) : null}
      <View style={s.totalRow}>
        <Text style={s.totalLabel}>Total</Text>
        <Text style={s.totalValue} testID="checkout-total">{formatCents(totals.totalCents)}</Text>
      </View>
    </View>
  );
}

// ─── Legal line ───────────────────────────────────────────────────────────────

/**
 * One line under Pay: "Protected by Buyer Protection · Returns Policy".
 * Buyer Protection opens a short sheet (the Buyer Protection Policy): the
 * Terms' purchase protection, quoted verbatim, and the delivery guarantee
 * (refunded automatically if not delivered within 15 days, 60 for
 * pre-orders).
 */
export function ReviewLegal({ preorder }: { preorder: boolean }) {
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Text style={s.legal} numberOfLines={1} testID="order-review-legal">
        Protected by{' '}
        <Text style={s.link} onPress={() => setOpen(true)} accessibilityRole="link" testID="order-review-buyer-protection">Buyer Protection</Text>
        {' · '}
        <Text style={s.link} onPress={() => router.push(LEGAL_DOCUMENTS['refund-policy'].route as never)} accessibilityRole="link">Returns Policy</Text>
      </Text>
      <BuyerProtectionSheet visible={open} preorder={preorder} onClose={() => setOpen(false)} />
    </>
  );
}

function BuyerProtectionSheet({ visible, preorder, onClose }: { visible: boolean; preorder: boolean; onClose: () => void }) {
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const router = useRouter();
  return (
    <BottomSheet visible={visible} onClose={onClose} testID="buyer-protection-sheet">
      <View style={s.sheetBody}>
        <Text style={s.sheetTitle} accessibilityRole="header">Buyer Protection Policy</Text>
        <Text style={s.sheetText}>
          Not delivered within {GUARANTEE_DAYS.regular} days{preorder ? ` (${GUARANTEE_DAYS.preorder} for pre-orders)` : ''}? You’re refunded automatically.
        </Text>
        {buyerProtectionLines({ preorder }).map(text => <Text key={text} style={s.sheetText}>{text}</Text>)}
        <Text
          style={[s.sheetText, s.link]}
          onPress={() => { onClose(); router.push(LEGAL_DOCUMENTS.terms.route as never); }}
          accessibilityRole="link"
        >
          Read the Terms of Service
        </Text>
      </View>
    </BottomSheet>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (ck: CheckoutColors) => StyleSheet.create({
  item: { flexDirection: 'row', gap: SP.md, paddingVertical: SP.md },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ck.divider },
  itemCopy: { flex: 1, minWidth: 0, gap: 4 },
  itemName: { fontFamily: FONT.semibold, fontSize: FS.base, lineHeight: 20, color: ck.text, marginBottom: SP.xs },
  itemMeta: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.text },
  thumbFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1E' },

  section: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ck.divider, paddingVertical: SP.md },
  sectionLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, color: ck.muted, marginBottom: SP.xs },
  shipRow: { paddingVertical: SP.sm + 2, gap: 3 },
  shipStore: { fontFamily: FONT.semibold, fontSize: FS.base, color: ck.text },
  shipLine: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.muted, ...TABULAR_NUMS },
  shipChoices: { marginTop: SP.xs },
  shipChoice: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4, minHeight: 52, paddingVertical: SP.xs },
  shipMethod: { fontFamily: FONT.medium, fontSize: FS.base, color: ck.text },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ck.text },

  rowWrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ck.divider },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 56 },
  rowLabel: { fontFamily: FONT.medium, fontSize: FS.base, color: ck.text },
  rowValue: { flex: 1, alignItems: 'flex-end', minWidth: 0 },
  rowValueText: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.text },
  rowBody: { paddingBottom: SP.md },

  totals: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ck.divider, paddingVertical: SP.md, gap: 6 },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: SP.xs, paddingTop: SP.sm + 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ck.divider,
  },
  totalLabel: { fontFamily: FONT.semibold, fontSize: FS.md, color: ck.text },
  totalValue: { fontFamily: FONT.semibold, fontSize: FS.md, color: ck.text, ...TABULAR_NUMS },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineLabel: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.muted },
  lineValue: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.muted, ...TABULAR_NUMS },

  legal: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 14, color: ck.muted, textAlign: 'center' },
  detailRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 56, paddingVertical: SP.sm + 4,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ck.divider,
  },
  detailCopy: { flex: 1, minWidth: 0, gap: 2 },
  detailLabel: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.muted, marginBottom: 2 },
  detailTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: ck.text },
  detailText: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.text },
  sheetBody: { paddingHorizontal: SP.md, paddingBottom: SP.lg, gap: SP.sm + 2 },
  sheetTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: ck.text, marginBottom: SP.xs },
  sheetText: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, color: ck.muted },
  link: { color: ck.text, textDecorationLine: 'underline' },
});
