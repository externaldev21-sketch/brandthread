/**
 * The bag, copied 1:1 from SSENSE's Shopping bag flow
 * (https://mobbin.com/flows/b906e342-83ab-4424-bf3b-59514df7dc6d) and
 * reskinned: "Close" top-left over a big "Bag" title; an Items / Description /
 * Price column row; each line is the photo on the left, brand + name in the
 * middle, price on the right, with "Move to saves" and "Remove" text actions
 * under it; then Subtotal, Shipping total and Order total; a sticky bar with
 * "Total estimate" on the left and "Go to checkout" on the right. Empty bag:
 * one line, "Shop now", and a New arrivals row of real products.
 *
 * Brandthread additions the brief asks for: the size and quantity change in
 * place on each line (size opens the shared picker sheet), and the shipping
 * row shows the sellers' real rates once known. Sentence case throughout
 * (SSENSE sets these in caps).
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { Button, QuantityStepper } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import type { CartItem } from '@/services/cartTypes';

const fmt = formatCents;
const IMAGE_W = 96;
const IMAGE_H = 128;

// ─── Header ───────────────────────────────────────────────────────────────────

export function BagHeader({ topInset, onClose }: { topInset: number; onClose: () => void }) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  return (
    <View style={[s.header, { paddingTop: topInset }]}>
      <Pressable
        onPress={onClose}
        style={s.closeBtn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Close bag"
        testID="bag-close"
      >
        <Text style={s.closeText}>Close</Text>
      </Pressable>
      <Text style={s.title} accessibilityRole="header">Bag</Text>
    </View>
  );
}

// ─── Column labels ────────────────────────────────────────────────────────────

export function BagColumns({ count }: { count: number }) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  return (
    <View style={s.columns} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text style={[s.columnLabel, { width: IMAGE_W }]}>Items {count}</Text>
      <Text style={[s.columnLabel, { flex: 1, marginLeft: SP.md }]}>Description</Text>
      <Text style={s.columnLabel}>Price</Text>
    </View>
  );
}

// ─── Line ─────────────────────────────────────────────────────────────────────

export type BagLineBusy = 'qty_dec' | 'qty_inc' | 'remove' | 'save' | undefined;

export function BagItemRow({
  item, busy, onOpen, onChangeSize, onQtyDec, onQtyInc, onMoveToSaves, onRemove,
}: {
  item: CartItem;
  busy: BagLineBusy;
  onOpen: () => void;
  onChangeSize: () => void;
  onQtyDec: () => void;
  onQtyInc: () => void;
  onMoveToSaves: () => void;
  onRemove: () => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const rowBusy = busy === 'remove' || busy === 'save';
  const qtyBusy = busy === 'qty_dec' || busy === 'qty_inc';
  const lineTotal = item.priceCents * item.quantity;
  const compare = item.compareAtPriceCents && item.compareAtPriceCents > item.priceCents
    ? item.compareAtPriceCents * item.quantity
    : null;
  const lowStock = item.isAvailable && item.maxQuantity > 0 && item.maxQuantity <= 3;

  return (
    <View style={[s.line, rowBusy && { opacity: 0.5 }]} testID={`cart-row-${item.id}`}>
      <View style={s.lineTop}>
        <Pressable onPress={onOpen} style={s.image} accessibilityRole="button" accessibilityLabel={`Open ${item.productName}`}>
          {item.imageUri
            ? <CachedImage source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} contentFit="contain" recyclingKey={item.imageUri} />
            : <Icon name="image" size={20} color={theme.muted} />}
        </Pressable>
        <View style={s.desc}>
          <Text style={s.brand} numberOfLines={1}>{item.sellerName}</Text>
          <Text style={s.name} numberOfLines={3}>{item.productName}</Text>
          {!!item.variantTitle && item.variantTitle !== 'Default' && (
            <Pressable
              onPress={onChangeSize}
              disabled={rowBusy}
              hitSlop={8}
              style={s.sizeBtn}
              accessibilityRole="button"
              accessibilityLabel={`Change size. Current: ${item.variantTitle}`}
              testID={`cart-size-${item.id}`}
            >
              <Text style={s.meta}>{item.variantTitle}</Text>
              <Icon name="chevron-down" size={17} color={theme.muted} />
            </Pressable>
          )}
          {item.isPreOrder && <Text style={s.meta}>Pre-order</Text>}
          {!item.isAvailable && (
            <Text style={[s.meta, { color: theme.text }]} accessibilityRole="alert">
              {item.unavailableReason ?? 'No longer available'}
            </Text>
          )}
          {lowStock && <Text style={[s.meta, { color: theme.text }]}>Only {item.maxQuantity} left</Text>}
          <View style={s.qtyRow}>
            <QuantityStepper
              value={item.quantity}
              min={1}
              max={Math.max(item.maxQuantity, 1)}
              disabled={qtyBusy || rowBusy}
              onChange={(next) => (next > item.quantity ? onQtyInc() : onQtyDec())}
              onRemoveAtMin={onRemove}
              itemLabel={item.productName}
              testID={`cart-qty-${item.id}`}
            />
            {qtyBusy && <ActivityIndicator size="small" color={theme.text} />}
          </View>
        </View>
        <View style={s.priceCol}>
          <Text style={s.price}>{fmt(lineTotal)}</Text>
          {compare !== null && <Text style={s.compare}>{fmt(compare)}</Text>}
        </View>
      </View>
      <View style={s.actions}>
        <Pressable
          onPress={onMoveToSaves}
          disabled={rowBusy}
          style={s.action}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.productName} to saves`}
          testID={`cart-save-${item.id}`}
        >
          <Text style={s.actionText}>Move to saves</Text>
        </Pressable>
        <Pressable
          onPress={onRemove}
          disabled={rowBusy}
          style={[s.action, s.actionRight]}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.productName} from bag`}
          testID={`cart-remove-${item.id}`}
        >
          <Text style={s.actionText}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Totals ───────────────────────────────────────────────────────────────────

export function BagTotals({
  itemCount, subtotalCents, discountCents, shippingCents, totalCents, hasPreOrder,
}: {
  itemCount: number;
  subtotalCents: number;
  discountCents: number;
  /** null until every seller's rate is known — then "Calculated at checkout". */
  shippingCents: number | null;
  totalCents: number;
  hasPreOrder: boolean;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const row = (label: string, value: string, testID?: string) => (
    <View style={s.totalRow} testID={testID}>
      <Text style={s.totalLabel}>{label}</Text>
      <Text style={s.totalValue}>{value}</Text>
    </View>
  );
  return (
    <View style={s.totals} testID="cart-order-summary">
      {row(`Subtotal (${itemCount})`, fmt(subtotalCents))}
      {discountCents > 0 && row('Discounts', `–${fmt(discountCents)}`)}
      {row('Shipping total', shippingCents === null ? 'Calculated at checkout' : shippingCents === 0 ? 'Free' : fmt(shippingCents), 'cart-shipping-total')}
      {row('Order total (USD)', fmt(totalCents))}
      {hasPreOrder && <Text style={[s.meta, { marginTop: SP.sm }]}>Pre-order items ship after production.</Text>}
    </View>
  );
}

// ─── Sticky bar ───────────────────────────────────────────────────────────────

export function BagCheckoutBar({
  totalCents, bottomInset, busy, disabled, onCheckout,
}: {
  totalCents: number;
  bottomInset: number;
  busy: boolean;
  disabled: boolean;
  onCheckout: () => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  return (
    <View style={[s.bar, { paddingBottom: bottomInset + SP.sm }]} testID="cart-checkout-bar">
      <View style={s.barTotal}>
        <Text style={s.barLabel}>Total estimate</Text>
        <Text style={s.barAmount} numberOfLines={1} adjustsFontSizeToFit>{fmt(totalCents)} USD</Text>
      </View>
      <View style={s.barButton}>
        <Button
          label="Go to checkout"
          onPress={onCheckout}
          loading={busy}
          disabled={disabled}
          fullWidth
          accessibilityHint="Reviews shipping and payment"
          testID="cart-go-to-checkout"
        />
      </View>
    </View>
  );
}

/** Height of the sticky bar above the safe area, for the list's bottom padding. */
export const BAG_BAR_HEIGHT = SP.sm * 2 + 52;

// ─── Empty bag ────────────────────────────────────────────────────────────────

export interface NewArrival {
  id: string;
  name: string;
  brand: string;
  priceCents: number;
  imageUri: string | null;
}

/** GET /api/public/products rows (newest first) → New arrivals cards. */
export function toNewArrivals(rows: unknown): NewArrival[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: any): NewArrival[] => {
    if (!row?.id || !row?.name) return [];
    const prices = (Array.isArray(row.variants) ? row.variants : [])
      .map((v: any) => Number(v?.priceCents))
      .filter((n: number) => Number.isFinite(n) && n >= 0);
    if (prices.length === 0) return [];
    return [{
      id: String(row.id),
      name: String(row.name),
      brand: String(row.sellerDisplayName ?? row.brandName ?? ''),
      priceCents: Math.min(...prices),
      imageUri: Array.isArray(row.images) && typeof row.images[0] === 'string' ? row.images[0] : null,
    }];
  });
}

export function BagEmpty({
  loadArrivals, onShopNow, onViewAll, onOpenProduct,
}: {
  /** Resolves to real products only; [] hides the row. */
  loadArrivals: () => Promise<NewArrival[]>;
  onShopNow: () => void;
  onViewAll: () => void;
  onOpenProduct: (productId: string) => void;
}) {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const [arrivals, setArrivals] = useState<NewArrival[]>([]);

  useEffect(() => {
    let active = true;
    loadArrivals().then((list) => { if (active) setArrivals(list); }).catch(() => {});
    return () => { active = false; };
  }, [loadArrivals]);

  return (
    <View testID="cart-empty">
      <Text style={s.emptyLine}>Your bag is empty.</Text>
      <Button label="Shop now" onPress={onShopNow} style={s.shopNow} testID="cart-shop-now" />
      {arrivals.length > 0 && (
        <View style={s.arrivals}>
          <View style={s.arrivalsHeader}>
            <Text style={s.columnLabel}>New arrivals</Text>
            <Pressable onPress={onViewAll} hitSlop={8} accessibilityRole="button" accessibilityLabel="View all new arrivals">
              <Text style={s.columnLabel}>View all</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.arrivalsRow}>
            {arrivals.map((p) => (
              <Pressable
                key={p.id}
                style={s.arrival}
                onPress={() => onOpenProduct(p.id)}
                accessibilityRole="button"
                accessibilityLabel={`${p.brand} ${p.name}, ${fmt(p.priceCents)}`}
              >
                <View style={s.arrivalImage}>
                  {p.imageUri ? <CachedImage source={{ uri: p.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                </View>
                {!!p.brand && <Text style={s.brand} numberOfLines={1}>{p.brand}</Text>}
                <Text style={s.arrivalName} numberOfLines={2}>{p.name}</Text>
                <Text style={s.arrivalName}>{fmt(p.priceCents)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  header: { paddingHorizontal: SP.md, paddingBottom: SP.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  closeBtn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  closeText: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text },
  title: { fontFamily: FONT.bold, fontSize: 32, lineHeight: 38, color: theme.text, marginTop: SP.xs },

  columns: { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.sm },
  columnLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted },

  line: { paddingVertical: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start' },
  image: { width: IMAGE_W, height: IMAGE_H, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  desc: { flex: 1, minWidth: 0, marginLeft: SP.md, gap: 2 },
  brand: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
  name: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, color: theme.text },
  meta: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted },
  sizeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 28, marginTop: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginTop: SP.xs },
  priceCol: { alignItems: 'flex-end', marginLeft: SP.sm },
  price: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text, ...TABULAR_NUMS },
  compare: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, textDecorationLine: 'line-through', ...TABULAR_NUMS },
  actions: { flexDirection: 'row', alignItems: 'center', marginLeft: IMAGE_W + SP.md },
  action: { minHeight: 44, justifyContent: 'center' },
  actionRight: { marginLeft: 'auto' },
  actionText: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.text, textDecorationLine: 'underline' },

  totals: { paddingVertical: SP.md, gap: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 22 },
  totalLabel: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text },
  totalValue: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text, ...TABULAR_NUMS },

  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: SP.md,
    paddingHorizontal: SP.md, paddingTop: SP.sm,
    backgroundColor: theme.background,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border,
  },
  barTotal: { flexShrink: 1, minWidth: 0 },
  barLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted },
  barAmount: { fontFamily: FONT.semibold, fontSize: FS.lg, color: theme.text, ...TABULAR_NUMS },
  barButton: { flex: 1, minWidth: 190 },

  emptyLine: { fontFamily: FONT.regular, fontSize: FS.base, color: theme.text, marginTop: SP.md },
  shopNow: { alignSelf: 'flex-start', marginTop: SP.md, minWidth: 180 },
  arrivals: { marginTop: SP.xl },
  arrivalsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.sm },
  arrivalsRow: { gap: SP.sm, paddingRight: SP.md },
  arrival: { width: 140, gap: 2 },
  arrivalImage: { width: 140, height: 187, backgroundColor: '#1C1C1E', overflow: 'hidden', marginBottom: SP.xs },
  arrivalName: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.text },
});
