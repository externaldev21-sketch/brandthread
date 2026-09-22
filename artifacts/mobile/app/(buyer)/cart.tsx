/**
 * Brandthread Buyer Cart Screen
 * Multi-seller cart with save-for-later, summary, and checkout entry.
 *
 * Improvements:
 * - Per-row pending affordances (spinner overlay) for qty/remove/save actions
 * - Inline unavailable/low-stock warnings backed by actual CartItem data
 * - Consistent monochrome Woven design-system tokens throughout
 */
import React, { useState, useCallback, useMemo } from 'react';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import {
  View, Text, ScrollView, StyleSheet, Image,
  ActivityIndicator, Alert, TextInput, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  getCart, updateCartItemQuantity, removeCartItem, restoreCartSnapshot,
  saveForLater, moveToCart, removeSavedItem,
  groupCartBySeller, calculateCartSummary, createCheckoutSession, getCheckoutSession, validateCart,
} from '@/services/cartService';
import {
  Cart, CartItem, SavedCartItem, CartSellerGroup, CheckoutLoyaltyRedemption,
} from '@/services/cartTypes';
import { useApi } from '@/hooks/useApi';
import { invalidateSellerPaymentStatusCache } from '@/lib/api';
import {
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BrandthreadScreen, BrandthreadHeader, StatusBadge, EmptyState, BrandedLoader, PressableScale, useUndoToast,
} from '@/components/BrandthreadUI';

import { useAuth } from '@clerk/expo';
import { formatCents } from '@/lib/money';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPrice = formatCents;

// ─── Row pending state tracker ────────────────────────────────────────────────
// Tracks which action is in-flight per item ID so the row can show a localized
// spinner without blocking the whole cart.
type RowPendingAction = 'qty_dec' | 'qty_inc' | 'remove' | 'save';

// ─── Quantity Row ─────────────────────────────────────────────────────────────

function QuantityControl({
  value, max, onDec, onInc, pendingDec, pendingInc,
}: {
  value: number;
  max: number;
  onDec: () => void;
  onInc: () => void;
  pendingDec?: boolean;
  pendingInc?: boolean;
}) {
  const { theme } = useAppTheme();
  const qc = useMemo(() => makeQuantityStyles(theme), [theme]);
  return (
    <View style={qc.root}>
      <PressableScale
        style={qc.btn}
        onPress={onDec}
        disabled={pendingDec || pendingInc}
        accessibilityLabel="Decrease quantity"
        accessibilityState={{ disabled: pendingDec || pendingInc, busy: pendingDec }}
      >
        {pendingDec
          ? <ActivityIndicator size="small" color={theme.text} style={{ transform: [{ scale: 0.7 }] }} />
          : <Feather name="minus" size={13} color={theme.text} />}
      </PressableScale>
      <Text style={qc.val}>{value}</Text>
      <PressableScale
        style={[qc.btn, value >= max && qc.btnDisabled]}
        onPress={onInc}
        disabled={value >= max || pendingDec || pendingInc}
        accessibilityLabel="Increase quantity"
        accessibilityState={{ disabled: value >= max || pendingDec || pendingInc, busy: pendingInc }}
      >
        {pendingInc
          ? <ActivityIndicator size="small" color={theme.text} style={{ transform: [{ scale: 0.7 }] }} />
          : <Feather name="plus" size={13} color={value >= max ? theme.subtle : theme.text} />}
      </PressableScale>
    </View>
  );
}
const makeQuantityStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  btn: { width: COMP.minTouchTarget, height: COMP.minTouchTarget, borderRadius: 8, backgroundColor: theme.cardElevatedGlass, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.4 },
  val: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, minWidth: 20, textAlign: 'center' },
});

// ─── Cart Item Row ─────────────────────────────────────────────────────────────

function CartItemRow({
  item, pendingAction, onQtyDec, onQtyInc, onRemove, onSaveForLater, onEditVariant,
}: {
  item: CartItem;
  pendingAction?: RowPendingAction;
  onQtyDec: () => void;
  onQtyInc: () => void;
  onRemove: () => void;
  onSaveForLater: () => void;
  onEditVariant: () => void;
}) {
  const { theme } = useAppTheme();
  const ir = useMemo(() => makeItemRowStyles(theme), [theme]);
  const lineTotal = item.priceCents * item.quantity;
  const hasDiscount = item.compareAtPriceCents && item.compareAtPriceCents > item.priceCents;
  const isRowBusy = pendingAction === 'remove' || pendingAction === 'save';

  // Low stock: warn at ≤ 3 units
  const isLowStock = item.isAvailable && item.maxQuantity > 0 && item.maxQuantity <= 3;
  // Very low: highlight differently at 1
  const isCriticalStock = item.isAvailable && item.maxQuantity === 1;

  return (
    <View style={[ir.root, isRowBusy && ir.rowBusy]}>
      {/* Pending overlay for remove/save */}
      {isRowBusy && (
        <View style={ir.busyOverlay} pointerEvents="none">
          <ActivityIndicator size="small" color={theme.muted} />
        </View>
      )}

      <View style={ir.img}>
        {item.imageUri
          ? <Image source={{ uri: item.imageUri }} style={ir.productImage} resizeMode="cover" />
           : <Feather name="image" size={ICON.lg} color={theme.muted} />}
      </View>

      {/* Details */}
      <View style={{ flex: 1 }}>
        <Text style={ir.name} numberOfLines={2}>{item.productName}</Text>
        <PressableScale
          style={ir.variantRow}
          onPress={onEditVariant}
          disabled={isRowBusy}
          accessibilityLabel={`Change options for ${item.productName}. Current: ${item.variantTitle}`}
        >
          <Text style={ir.variant}>{item.variantTitle}</Text>
          <Feather name="edit-2" size={11} color={theme.accentLight} />
        </PressableScale>

        {item.isPreOrder && (
          <View style={ir.preOrderBadge}>
            <Feather name="clock" size={10} color={theme.secondary} />
            <Text style={[ir.preOrderText, { color: theme.secondary }]}>
              Pre-order{item.preOrderEstShipDate ? ` · est. ${new Date(item.preOrderEstShipDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}
            </Text>
          </View>
        )}

        {/* Unavailable warning — prominent, backed by CartItem.isAvailable */}
        {!item.isAvailable && (
          <View style={ir.unavailBadge} accessibilityRole="alert">
             <Feather name="alert-circle" size={11} color={theme.error} />
            <Text style={ir.unavailText}>{item.unavailableReason ?? 'Unavailable — remove or save for later'}</Text>
          </View>
        )}

        {/* Low stock warning — inline, only when actually available */}
        {isLowStock && (
          <View style={[ir.stockWarnRow, isCriticalStock && ir.stockWarnCritical]}>
             <Feather name="alert-triangle" size={10} color={theme.warning} />
            <Text style={[ir.stockWarn, isCriticalStock && ir.stockWarnCriticalText]}>
              {isCriticalStock ? 'Last one left!' : `Only ${item.maxQuantity} left`}
            </Text>
          </View>
        )}

        {/* Price + qty */}
        <View style={ir.bottomRow}>
          <QuantityControl
            value={item.quantity}
            max={item.maxQuantity}
            onDec={onQtyDec}
            onInc={onQtyInc}
            pendingDec={pendingAction === 'qty_dec'}
            pendingInc={pendingAction === 'qty_inc'}
          />
          <View style={ir.priceBlock}>
            {hasDiscount && (
              <Text style={ir.comparePrice}>{fmtPrice(item.compareAtPriceCents! * item.quantity)}</Text>
            )}
            <Text style={[ir.price, hasDiscount ? ir.priceDiscounted : undefined]}>{fmtPrice(lineTotal)}</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={ir.actions}>
          <PressableScale
            style={ir.actionBtn}
            onPress={onSaveForLater}
            disabled={isRowBusy}
            accessibilityLabel={`Save ${item.productName} for later`}
            accessibilityState={{ disabled: isRowBusy, busy: pendingAction === 'save' }}
          >
             {pendingAction === 'save'
               ? <ActivityIndicator size="small" color={theme.muted} style={{ width: 12, height: 12 }} />
               : <Feather name="bookmark" size={12} color={theme.muted} />}
            <Text style={ir.actionText}>Save</Text>
          </PressableScale>
          <View style={ir.actionDivider} />
          <PressableScale
            style={ir.actionBtn}
            onPress={onRemove}
            disabled={isRowBusy}
            accessibilityLabel={`Remove ${item.productName} from cart`}
            accessibilityState={{ disabled: isRowBusy, busy: pendingAction === 'remove' }}
          >
             {pendingAction === 'remove'
               ? <ActivityIndicator size="small" color={theme.error} style={{ width: 12, height: 12 }} />
               : <Feather name="trash-2" size={12} color={theme.error} />}
             <Text style={[ir.actionText, { color: theme.error }]}>Remove</Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

const makeItemRowStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flexDirection: 'row', gap: SP.sm, paddingVertical: SP.sm },
  rowBusy: { opacity: 0.7 },
  busyOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 10, alignItems: 'center', justifyContent: 'center',
  },
  img: {
    width: 80, height: 100, borderRadius: RADIUS.md,
    backgroundColor: theme.cardElevatedGlass, borderWidth: 1, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  productImage: { width: '100%', height: '100%' },
  name: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, marginBottom: 4, lineHeight: 18 },
  variantRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  variant: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  preOrderBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  preOrderText: { fontSize: FS.xs, fontFamily: FONT.medium },
  unavailBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: `${theme.error}26`, borderRadius: RADIUS.xs,
    paddingHorizontal: 6, paddingVertical: 3,
    alignSelf: 'flex-start', marginBottom: 4,
  },
  unavailText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.error, flex: 1, flexShrink: 1 },
  stockWarnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4,
    backgroundColor: `${theme.warning}26`, borderRadius: RADIUS.xs,
    paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start',
  },
  stockWarnCritical: { backgroundColor: `${theme.error}26` },
  stockWarn: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.warning },
  stockWarnCriticalText: { color: theme.error },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  priceBlock: { alignItems: 'flex-end' },
  comparePrice: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, textDecorationLine: 'line-through' },
  price: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.text },
  priceDiscounted: { color: theme.success },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: SP.xs },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: COMP.minTouchTarget, paddingVertical: 4, paddingHorizontal: 8 },
  actionText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },
  actionDivider: { width: 1, height: 14, backgroundColor: theme.border },
});

// ─── Seller Group ─────────────────────────────────────────────────────────────

function SellerGroup({
  group, pendingByItemId, onQtyDec, onQtyInc, onRemove, onSaveForLater, onEditVariant,
}: {
  group: CartSellerGroup;
  pendingByItemId: Record<string, RowPendingAction>;
  onQtyDec: (itemId: string) => void;
  onQtyInc: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onSaveForLater: (itemId: string) => void;
  onEditVariant: (item: CartItem) => void;
}) {
  const { theme } = useAppTheme();
  const sg = useMemo(() => makeSellerGroupStyles(theme), [theme]);
  const router = useRouter();
  return (
    <View style={sg.root}>
      {/* Seller header */}
      <View style={sg.sellerRow}>
        <View style={[sg.avatar, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
          <Text style={[sg.avatarText, { color: theme.accentLight }]}>{group.sellerInitial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sg.sellerName}>{group.sellerName}</Text>
          <Text style={sg.sellerHandle}>{group.sellerHandle}</Text>
        </View>
        <PressableScale
          onPress={() => router.push(('/seller-profile?id=' + group.sellerId) as never)}
          style={[sg.visitBtn, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}
          accessibilityLabel={`Visit ${group.sellerName} store`}
        >
          <Text style={[sg.visitBtnText, { color: theme.accentLight }]}>Visit store</Text>
        </PressableScale>
      </View>

      {/* Items */}
      {group.items.map((item, idx) => (
        <View key={item.id}>
          {idx > 0 && <View style={sg.divider} />}
          <CartItemRow
            item={item}
            pendingAction={pendingByItemId[item.id]}
            onQtyDec={() => onQtyDec(item.id)}
            onQtyInc={() => onQtyInc(item.id)}
            onRemove={() => onRemove(item.id)}
            onSaveForLater={() => onSaveForLater(item.id)}
            onEditVariant={() => onEditVariant(item)}
          />
        </View>
      ))}

      {/* Group footer */}
      <View style={sg.footer}>
        <View style={sg.footerRow}>
        <Feather name="truck" size={12} color={theme.muted} />
          <Text style={sg.footerText}>{group.fulfillmentEstimate}</Text>
        </View>
        {group.hasPreOrder && (
          <View style={sg.footerRow}>
            <Feather name="clock" size={12} color={theme.secondary} />
            <Text style={[sg.footerText, { color: theme.secondary }]}>Contains pre-order items</Text>
          </View>
        )}
        <Text style={sg.groupSubtotal}>Group subtotal: {fmtPrice(group.subtotalCents)}</Text>
      </View>
    </View>
  );
}

const makeSellerGroupStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { backgroundColor: theme.cardGlass, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, padding: SP.md, marginBottom: SP.md },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  avatar: { width: 36, height: 36, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FS.sm, fontFamily: FONT.bold },
  sellerName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  sellerHandle: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  visitBtn: { minHeight: COMP.minTouchTarget, paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  visitBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: SP.xs },
  footer: { borderTopWidth: 1, borderTopColor: theme.border, marginTop: SP.sm, paddingTop: SP.sm, gap: 4 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerText: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  groupSubtotal: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, marginTop: 4 },
});

// ─── Saved for Later ──────────────────────────────────────────────────────────

function SavedItemRow({ item, onMove, onRemove }: {
  item: SavedCartItem;
  onMove: () => void;
  onRemove: () => void;
}) {
  const { theme } = useAppTheme();
  const si = useMemo(() => makeSavedItemStyles(theme), [theme]);
  return (
    <View style={si.root}>
      <View style={si.img}>
        <Feather name="bookmark" size={ICON.md} color={theme.muted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={si.name} numberOfLines={1}>{item.productName}</Text>
        <Text style={si.variant}>{item.variantTitle}</Text>
        <Text style={si.price}>{fmtPrice(item.priceCents)}</Text>
        {!item.isAvailable && (
          <Text style={si.unavail}>No longer available</Text>
        )}
        <View style={si.actions}>
          <PressableScale
            style={[si.btn, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}
            onPress={onMove}
            accessibilityLabel={`Move ${item.productName} to cart`}
            disabled={!item.isAvailable}
          >
               <Text style={[si.btnText, { color: theme.accentLight }, !item.isAvailable && { color: theme.subtle }]}>
              Move to cart
            </Text>
          </PressableScale>
          <PressableScale
            style={si.btnGhost}
            onPress={onRemove}
            accessibilityLabel={`Remove ${item.productName} from saved items`}
          >
            <Text style={si.btnGhostText}>Remove</Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

const makeSavedItemStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flexDirection: 'row', gap: SP.sm, paddingVertical: SP.sm },
  img: { width: 56, height: 70, borderRadius: RADIUS.sm, backgroundColor: theme.cardElevatedGlass, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  variant: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginBottom: 2 },
  price: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, marginBottom: 4 },
  unavail: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.error, marginBottom: 4 },
  actions: { flexDirection: 'row', gap: SP.sm },
  btn: { minHeight: COMP.minTouchTarget, paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  btnGhost: { minHeight: COMP.minTouchTarget, paddingHorizontal: 10, paddingVertical: 5, justifyContent: 'center' },
  btnGhostText: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
});

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ subtotal, discountTotal, shipping, tax, total, hasPreOrder }: {
  subtotal: number; discountTotal: number; shipping: number; tax: number; total: number; hasPreOrder: boolean;
}) {
  const { theme } = useAppTheme();
  const sum = useMemo(() => makeSummaryStyles(theme), [theme]);
  function Row({ label, value, accent, small }: { label: string; value: string; accent?: string; small?: boolean }) {
    return (
      <View style={sum.row}>
        <Text style={[sum.label, small && sum.labelSm]}>{label}</Text>
        <Text style={[sum.value, small && sum.valueSm, !!accent && { color: accent }]}>{value}</Text>
      </View>
    );
  }
  return (
    <View style={sum.root}>
      <Text style={sum.title}>Order summary</Text>
      <Row label="Subtotal" value={fmtPrice(subtotal)} />
      <Row label="Discounts" value={discountTotal > 0 ? `–${fmtPrice(discountTotal)}` : fmtPrice(0)} accent={discountTotal > 0 ? theme.success : undefined} />
      <Row label="Shipping & fees" value={fmtPrice(shipping)} small />
      <Row label="Est. tax" value={fmtPrice(tax)} small />
      <View style={sum.divider} />
      <View style={sum.totalRow}>
        <Text style={sum.totalLabel}>Total</Text>
        <Text style={sum.totalValue}>{fmtPrice(total)}</Text>
      </View>
      <Text style={sum.note}>Shipping and tax are estimated. Final amount calculated at checkout.</Text>
      {hasPreOrder && (
        <View style={sum.preOrderNote}>
          <Feather name="clock" size={12} color={theme.secondary} />
          <Text style={[sum.preOrderNoteText, { color: theme.secondary }]}>Pre-order items will ship after production. Items may ship separately.</Text>
        </View>
      )}
    </View>
  );
}

const makeSummaryStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { backgroundColor: theme.cardGlass, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, padding: SP.md, marginBottom: SP.md },
  title: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  label: { fontSize: FS.base, fontFamily: FONT.regular, color: theme.muted },
  labelSm: { fontSize: FS.sm },
  value: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  valueSm: { fontSize: FS.sm },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: SP.sm },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: SP.xs },
  totalLabel: { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text },
  totalValue: { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text },
  note: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginTop: SP.sm },
  preOrderNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: SP.sm },
  preOrderNoteText: { fontSize: FS.xs, fontFamily: FONT.regular, flex: 1 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CartScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeScreenStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { push } = useThreadPull();
  const api = useApi();
  const { isSignedIn } = useAuth();
  const { showUndo } = useUndoToast();

  const [cart, setCart] = useState<Cart>({ id: '', items: [], savedItems: [], updatedAt: '' });
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [pointsInput, setPointsInput] = useState('');
  const [redeemingPoints, setRedeemingPoints] = useState(false);
  const [loyaltyRedemption, setLoyaltyRedemption] = useState<CheckoutLoyaltyRedemption | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Per-row pending actions: itemId → action
  const [pendingByItemId, setPendingByItemId] = useState<Record<string, RowPendingAction>>({});

  const setPending = (itemId: string, action: RowPendingAction) =>
    setPendingByItemId(prev => ({ ...prev, [itemId]: action }));
  const clearPending = (itemId: string) =>
    setPendingByItemId(prev => { const next = { ...prev }; delete next[itemId]; return next; });

  const load = useCallback(async () => {
    try {
      const nextCart = await getCart();
      setCart(nextCart);
      const pendingCheckout = await getCheckoutSession();
      if (
        pendingCheckout?.loyaltyRedemption &&
        pendingCheckout.cartId === nextCart.id &&
        pendingCheckout.deliveryGroups.length === 1 &&
        pendingCheckout.deliveryGroups[0]?.items.every(
          item => nextCart.items.some(cartItem => cartItem.id === item.id),
        )
      ) {
        setLoyaltyRedemption(pendingCheckout.loyaltyRedemption);
      }
    } catch {}
    setLoading(false);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    invalidateSellerPaymentStatusCache();
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    void load();
    if (isSignedIn) {
      void api.loyalty.get()
        .then(result => { if (active) setLoyaltyBalance(Math.max(0, Number(result.balance ?? 0))); })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [api, load, isSignedIn]));

  const groups = groupCartBySeller(cart.items);
  const hasPreOrder = cart.items.some(i => i.isPreOrder);
  const summary = calculateCartSummary(cart.items);
  const requestedPoints = Math.floor(Number(pointsInput));
  const maxRedeemablePoints = Math.min(
    loyaltyBalance,
    Math.max(0, summary.subtotalCents - 1),
  );
  const loyaltyPreviewCents = Number.isFinite(requestedPoints) && requestedPoints >= 100
    ? Math.min(requestedPoints, maxRedeemablePoints)
    : 0;
  const displayedDiscount = summary.discountTotalCents + (loyaltyRedemption?.discountCents ?? 0);
  const displayedTotal = Math.max(0, summary.totalCents - (loyaltyRedemption?.discountCents ?? 0));

  async function handleQtyDec(itemId: string) {
    if (pendingByItemId[itemId]) return;
    Haptics.selectionAsync();
    const item = cart.items.find(i => i.id === itemId);
    if (!item) return;
    const snapshot = cart;
    setPending(itemId, 'qty_dec');
    try {
      const newCart = await updateCartItemQuantity(itemId, item.quantity - 1);
      setCart(newCart);
      if (item.quantity === 1) {
        showUndo({
          message: `"${item.productName}" removed`,
          undo: async () => setCart(await restoreCartSnapshot(snapshot)),
        });
      }
    } finally {
      clearPending(itemId);
    }
  }

  async function handleQtyInc(itemId: string) {
    if (pendingByItemId[itemId]) return;
    Haptics.selectionAsync();
    const item = cart.items.find(i => i.id === itemId);
    if (!item) return;
    setPending(itemId, 'qty_inc');
    try {
      const newCart = await updateCartItemQuantity(itemId, item.quantity + 1);
      setCart(newCart);
    } finally {
      clearPending(itemId);
    }
  }

  async function handleRemove(itemId: string) {
    if (pendingByItemId[itemId]) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const removed = cart.items.find(item => item.id === itemId);
    const snapshot = cart;
    setPending(itemId, 'remove');
    try {
      const newCart = await removeCartItem(itemId);
      setCart(newCart);
      if (removed) {
        showUndo({
          message: `"${removed.productName}" removed`,
          undo: async () => setCart(await restoreCartSnapshot(snapshot)),
        });
      }
    } finally {
      clearPending(itemId);
    }
  }

  async function handleSaveForLater(itemId: string) {
    if (pendingByItemId[itemId]) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPending(itemId, 'save');
    try {
      const newCart = await saveForLater(itemId);
      setCart(newCart);
    } finally {
      clearPending(itemId);
    }
  }

  async function handleMoveToCart(savedId: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newCart = await moveToCart(savedId);
    setCart(newCart);
  }

  async function handleRemoveSaved(savedId: string) {
    const newCart = await removeSavedItem(savedId);
    setCart(newCart);
  }

  function handleEditVariant(item: CartItem) {
    push(('/thread-product-detail?productId=' + item.productId + '&editVariantId=' + item.variantId + '&editCartItemId=' + item.id) as never);
  }

  async function handleApplyPoints() {
    if (groups.length !== 1) {
      Alert.alert(
        'One store at a time',
        'Rewards can be used when your cart has items from one seller. Check out each seller separately to use points.',
      );
      return;
    }
    if (!Number.isInteger(requestedPoints) || requestedPoints < 100) {
      Alert.alert('Minimum 100 points', 'Use at least 100 points for $1.00 off.');
      return;
    }
    if (requestedPoints > loyaltyBalance) {
      Alert.alert('Not enough points', `You have ${loyaltyBalance.toLocaleString()} points available.`);
      return;
    }
    if (requestedPoints > maxRedeemablePoints) {
      Alert.alert(
        'Choose fewer points',
        `You can use up to ${maxRedeemablePoints.toLocaleString()} points on this order.`,
      );
      return;
    }

    setRedeemingPoints(true);
    try {
      const result = await api.loyalty.redeem({ points: requestedPoints });
      setLoyaltyRedemption({
        token: result.token,
        pointsUsed: result.pointsUsed,
        discountCents: result.discountCents,
      });
      await createCheckoutSession(cart, false, undefined, {
        token: result.token,
        pointsUsed: result.pointsUsed,
        discountCents: result.discountCents,
      });
      setLoyaltyBalance(current => Math.max(0, current - result.pointsUsed));
      setPointsInput('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      Alert.alert('Could not apply points', error?.message ?? 'Please try again.');
    } finally {
      setRedeemingPoints(false);
    }
  }

  async function handleCheckout() {
    if (cart.items.length === 0) return;
    setValidating(true);
    try {
      if (isSignedIn) {
        const validation = await validateCart(cart.items);
        if (!validation.isValid) {
          const issues = validation.issues.map(i => `• ${i.message}`).join('\n');
          Alert.alert('Review your cart', `Some items need your attention:\n\n${issues}`, [{ text: 'OK' }]);
          setValidating(false);
          return;
        }
      }

      // Check each seller's payment account before entering checkout
      const currentGroups = groupCartBySeller(cart.items);
      if (loyaltyRedemption && currentGroups.length !== 1) {
        Alert.alert('Rewards need one store', 'Remove items from other sellers before continuing with this rewards discount.');
        setValidating(false);
        return;
      }

      if (isSignedIn) {
        for (const group of currentGroups) {
          try {
            const status = await api.buyer.sellerPaymentStatus(group.sellerId);
            if (!status.ready) {
              const sellerLabel = group.sellerName || 'One of the sellers';
              Alert.alert(
                'Payments unavailable',
                `${sellerLabel} can't accept payments right now.\n\n${status.reason ?? 'Please try again later or remove their items from your cart.'}`,
                [{ text: 'OK' }],
              );
              setValidating(false);
              return;
            }
          } catch {
            Alert.alert('Unable to verify payments', `We could not confirm ${group.sellerName} can accept payments. Check your connection and try again.`);
            setValidating(false);
            return;
          }
        }
      }

      await createCheckoutSession(
        cart,
        false,
        undefined,
        loyaltyRedemption ?? undefined,
      );
      push(('/thread-checkout?source=cart') as never);
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
    setValidating(false);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <BrandedLoader label="Gathering your picks…" />
      </View>
    );
  }

  const hasItems = cart.items.length > 0;
  const hasSaved = cart.savedItems.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <Text style={s.headerTitle}>Cart</Text>
        {hasItems && (
          <View style={[s.headerBadge, { backgroundColor: theme.accent }]}>
            <Text style={[s.headerBadgeText, { color: theme.onAccent }]}>{cart.items.reduce((s, i) => s + i.quantity, 0)}</Text>
          </View>
        )}
      </View>

      {!hasItems && !hasSaved ? (
        <EmptyState
          icon="shopping-bag"
          title="Your cart is ready for something great."
          description="Browse Thread and tap SHOP on products you love."
          action={{
            label: 'Discover Products',
            icon: 'compass',
            onPress: () => router.push('/(buyer)/discover' as never),
          }}
          style={{ flex: 1 }}
        />
      ) : (
        <>
          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={theme.accent}
              />
            }
            contentContainerStyle={{
              paddingHorizontal: SP.md,
              paddingTop: SP.sm,
              paddingBottom: insets.bottom + 140,
            }}
          >
            {/* Seller groups */}
            {groups.map(group => (
              <SellerGroup
                key={group.sellerId}
                group={group}
                pendingByItemId={pendingByItemId}
                onQtyDec={handleQtyDec}
                onQtyInc={handleQtyInc}
                onRemove={handleRemove}
                onSaveForLater={handleSaveForLater}
                onEditVariant={handleEditVariant}
              />
            ))}

            {/* Summary */}
            {hasItems && (
              <>
              {groups.length > 1 && (
                <View style={[s.multiSellerNotice, { backgroundColor: theme.secondaryDim }]}>
                  <Feather name="layers" size={16} color={theme.secondary} />
                  <Text style={[s.multiSellerText, { color: theme.secondary }]}>Items from {groups.length} sellers require a separate secure Stripe payment for each seller.</Text>
                </View>
              )}
              {isSignedIn && (
              <View style={[s.loyaltyCard, { borderColor: theme.accent }]}>
                <View style={s.loyaltyHeading}>
                  <View style={[s.loyaltyIcon, { backgroundColor: theme.accentDim }]}>
                    <Feather name="gift" size={15} color={theme.accentLight} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.loyaltyTitle}>Use points</Text>
                    <Text style={s.loyaltySub}>
                      {loyaltyBalance.toLocaleString()} points available · 100 points = $1.00
                    </Text>
                  </View>
                </View>
                {loyaltyRedemption ? (
                  <View style={s.appliedPoints}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.appliedPointsTitle}>
                        {loyaltyRedemption.pointsUsed.toLocaleString()} points applied
                      </Text>
                      <Text style={s.appliedPointsSub}>
                         −{fmtPrice(loyaltyRedemption.discountCents)} at secure checkout
                      </Text>
                    </View>
                    <Feather name="check-circle" size={19} color={theme.success} />
                  </View>
                ) : (
                  <>
                    <View style={s.pointsRow}>
                      <TextInput
                        value={pointsInput}
                        onChangeText={setPointsInput}
                        keyboardType="number-pad"
                        placeholder="Points to use"
                        placeholderTextColor={theme.subtle}
                        style={s.pointsInput}
                        accessibilityLabel="Loyalty points to use"
                      />
                      <PressableScale
                        style={[s.pointsApply, { backgroundColor: theme.accentDim, borderColor: theme.accent }, (redeemingPoints || groups.length !== 1) && s.pointsApplyDisabled]}
                        onPress={handleApplyPoints}
                        disabled={redeemingPoints || groups.length !== 1}
                        accessibilityLabel="Apply loyalty points"
                        accessibilityState={{ disabled: redeemingPoints || groups.length !== 1, busy: redeemingPoints }}
                      >
                        {redeemingPoints
                          ? <ActivityIndicator color={theme.accentLight} size="small" />
                          : <Text style={[s.pointsApplyText, { color: theme.accentLight }]}>Apply</Text>}
                      </PressableScale>
                    </View>
                    <Text style={s.pointsPreview}>
                      {groups.length !== 1
                        ? 'Rewards apply to one seller checkout at a time.'
                        : loyaltyPreviewCents > 0
                          ? `You'll save ${fmtPrice(loyaltyPreviewCents)} at checkout.`
                          : `Use up to ${maxRedeemablePoints.toLocaleString()} points on this order.`}
                    </Text>
                  </>
                )}
              </View>
              )}
              <SummaryCard
                subtotal={summary.subtotalCents}
                discountTotal={displayedDiscount}
                shipping={summary.shippingTotalCents}
                tax={summary.taxTotalCents}
                total={displayedTotal}
                hasPreOrder={hasPreOrder}
              />
              </>
            )}

            {/* Saved for later */}
            {hasSaved && (
              <View style={s.savedSection}>
                <Text style={s.savedTitle}>Saved for later ({cart.savedItems.length})</Text>
                <View style={s.savedCard}>
                  {cart.savedItems.map((item, idx) => (
                    <View key={item.id}>
                      {idx > 0 && <View style={s.divider} />}
                      <SavedItemRow
                        item={item}
                        onMove={() => handleMoveToCart(item.id)}
                        onRemove={() => handleRemoveSaved(item.id)}
                      />
                    </View>
                  ))}
                </View>
              </View>
            )}

            {!hasSaved && (
              <Text style={s.savedHint}>Products you save for later will appear here.</Text>
            )}
          </ScrollView>

          {/* Checkout button */}
          {hasItems && (
          <View style={[s.checkoutBar, { paddingBottom: insets.bottom + SP.md }]}>
              <PressableScale
                style={[s.checkoutBtn, { shadowColor: theme.shadowColor }]}
                onPress={handleCheckout}
                disabled={validating}
                accessibilityLabel={`Check out, ${fmtPrice(displayedTotal)}`}
                accessibilityHint="Reviews shipping and opens secure payment"
                accessibilityState={{ disabled: validating, busy: validating }}
              >
                <LinearGradient
                  colors={[...theme.primaryGradient]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.checkoutGrad}
                >
                  {validating ? (
                    <ActivityIndicator color={theme.onAccent} size="small" />
                  ) : (
                    <>
                      <Feather name="lock" size={16} color={theme.onAccent} />
                      <Text style={[s.checkoutText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Check out</Text>
                      <View style={s.checkoutSpacer} />
                      <Text style={[s.checkoutAmount, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>{fmtPrice(displayedTotal)}</Text>
                    </>
                  )}
                </LinearGradient>
              </PressableScale>
              <Text style={s.secureNote}>
                <Feather name="shield" size={11} color={theme.subtle} /> Secured by Brandthread
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeScreenStyles = (theme: AppThemePreset) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    gap: SP.sm,
  },
  headerTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: theme.text },
  headerBadge: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  headerBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold },
  savedSection: { marginBottom: SP.md },
  savedTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  savedCard: { backgroundColor: theme.cardGlass, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, padding: SP.md },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: SP.xs },
  multiSellerNotice: { flexDirection: 'row', gap: SP.sm, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md },
  multiSellerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  loyaltyCard: { backgroundColor: theme.cardGlass, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.md, marginBottom: SP.md },
  loyaltyHeading: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  loyaltyIcon: { width: 30, height: 30, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  loyaltyTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  loyaltySub: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  pointsRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'center' },
  pointsInput: { flex: 1, height: COMP.inputH, borderRadius: RADIUS.md, backgroundColor: theme.cardElevatedGlass, borderWidth: 1, borderColor: theme.border, color: theme.text, fontFamily: FONT.regular, paddingHorizontal: SP.md },
  pointsApply: { minWidth: 76, height: COMP.inputH, borderRadius: RADIUS.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pointsApplyDisabled: { opacity: 0.5 },
  pointsApplyText: { fontSize: FS.sm, fontFamily: FONT.bold },
  pointsPreview: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: SP.xs, lineHeight: 17 },
  appliedPoints: { flexDirection: 'row', alignItems: 'center', backgroundColor: `${theme.success}26`, borderRadius: RADIUS.md, padding: SP.sm, gap: SP.sm },
  appliedPointsTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.success },
  appliedPointsSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  savedHint: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, textAlign: 'center', marginBottom: SP.lg },
  checkoutBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    backgroundColor: theme.background,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  checkoutBtn: { borderRadius: RADIUS.lg, overflow: 'hidden', shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  checkoutGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: SP.sm,
    height: COMP.buttonH,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SP.md,
  },
  checkoutText: { fontSize: FS.base, fontFamily: FONT.bold },
  checkoutSpacer: { flex: 1 },
  checkoutAmount: { fontSize: FS.base, fontFamily: FONT.bold },
  secureNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, textAlign: 'center', marginTop: SP.xs },
});
