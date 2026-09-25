/**
 * Brandthread Buyer Cart Screen
 * Multi-seller cart with save-for-later, summary, and checkout entry.
 *
 * Improvements:
 * - Per-row pending affordances (spinner overlay) for qty/remove/save actions
 * - Inline unavailable/low-stock warnings backed by actual CartItem data
 * - Consistent monochrome Woven design-system tokens throughout
 */
import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import {
  View, Text, ScrollView, StyleSheet, Image,
  ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { StickyFooter } from '@/components/layout';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  getCartForScreen, updateCartItemQuantity, removeCartItem, restoreCartSnapshot,
  saveForLater, moveToCart, removeSavedItem,
  groupCartBySeller, calculateCartSummary, createCheckoutSession, getCheckoutSession, validateCart,
} from '@/services/cartService';
import {
  Cart, CartItem, SavedCartItem, CartSellerGroup, CheckoutLoyaltyRedemption, CheckoutThreadCashRedemption,
} from '@/services/cartTypes';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { UseThreadCashCard } from '@/components/thread-cash/UseThreadCashCard';
import { useApi } from '@/hooks/useApi';
import { invalidateSellerPaymentStatusCache } from '@/lib/api';
import {
  FONT, FS, SP, RADIUS, COMP, ICON, TYPE,
} from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import {
  BrandthreadHeader, EmptyState, BrandedLoader, PressableScale, useUndoToast,
} from '@/components/BrandthreadUI';
import { InlineError } from '@/components/InlineFeedback';
import {
  Button, Card, QuantityStepper, StickyBottomCTA, ThemedRefreshControl,
} from '@/components/ui';
import { RADII } from '@/constants/radii';
import { TABULAR_NUMS, TYPE_SCALE } from '@/constants/typography';

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
  const busy = pendingDec || pendingInc;
  return (
    <View style={{ opacity: busy ? 0.5 : 1, flexDirection: 'row', alignItems: 'center', gap: SP.xs }}>
      <QuantityStepper
        value={value}
        min={1}
        max={Math.max(max, 1)}
        disabled={busy}
        onChange={next => (next > value ? onInc() : onDec())}
      />
      {busy && <ActivityIndicator size="small" color={theme.text} style={{ marginLeft: 2 }} />}
    </View>
  );
}

// ─── Cart Item Row ─────────────────────────────────────────────────────────────

function CartItemRow({
  item, pendingAction, selected, onToggleSelect, buyingNow, onBuyNow, onQtyDec, onQtyInc, onRemove, onSaveForLater, onEditVariant,
}: {
  item: CartItem;
  pendingAction?: RowPendingAction;
  selected: boolean;
  onToggleSelect: () => void;
  buyingNow: boolean;
  onBuyNow: () => void;
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
  const isRowBusy = pendingAction === 'remove' || pendingAction === 'save' || buyingNow;

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

      <PressableScale
        style={ir.checkbox}
        onPress={onToggleSelect}
        disabled={isRowBusy}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, disabled: isRowBusy }}
        accessibilityLabel={`${selected ? 'Deselect' : 'Select'} ${item.productName} for checkout`}
      >
        <View style={[ir.checkboxBox, selected && { backgroundColor: theme.accent, borderColor: theme.accent }]}>
          {selected && <Feather name="check" size={12} color={theme.onAccent} />}
        </View>
      </PressableScale>

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

        {/* Actions — Remove and Save for later are optional, never required to buy */}
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
          <View style={{ flex: 1 }} />
          {/* Buys just this line — its own variant + qty — through the shared
              Buy Now flow. It never touches, or requires touching, the rest
              of the cart. */}
          <Button
            label="Buy"
            size="small"
            variant="primary"
            onPress={onBuyNow}
            loading={buyingNow}
            disabled={isRowBusy || !item.isAvailable}
            accessibilityHint={`Buy just ${item.productName} now, ${fmtPrice(lineTotal)}`}
            style={ir.buyBtn}
          />
        </View>
      </View>
    </View>
  );
}

const makeItemRowStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flexDirection: 'row', gap: SP.sm, paddingVertical: SP.sm, alignItems: 'flex-start' },
  rowBusy: { opacity: 0.7 },
  checkbox: { width: COMP.minTouchTarget, height: 100, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  checkboxBox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
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
  name: { ...TYPE.bodyMedium, fontFamily: FONT.semibold, color: theme.text, marginBottom: 4 },
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
  comparePrice: { fontSize: FS.xs, ...TABULAR_NUMS, fontFamily: FONT.regular, color: theme.subtle, textDecorationLine: 'line-through' },
  price: { ...TYPE.bodyMedium, ...TABULAR_NUMS, fontFamily: FONT.bold, color: theme.text },
  priceDiscounted: { color: theme.success },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: SP.xs },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: COMP.minTouchTarget, paddingVertical: 4, paddingHorizontal: 8 },
  actionText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },
  actionDivider: { width: 1, height: 14, backgroundColor: theme.border },
  buyBtn: { minWidth: 72 },
});

// ─── Seller Group ─────────────────────────────────────────────────────────────

function SellerGroup({
  group, pendingByItemId, selectedIds, buyingItemId, onToggleSelect, onBuyNow, onQtyDec, onQtyInc, onRemove, onSaveForLater, onEditVariant,
}: {
  group: CartSellerGroup;
  pendingByItemId: Record<string, RowPendingAction>;
  selectedIds: Set<string>;
  buyingItemId: string | null;
  onToggleSelect: (itemId: string) => void;
  onBuyNow: (item: CartItem) => void;
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
    <Card style={sg.root}>
      {/* Seller header */}
      <View style={sg.sellerRow}>
        <View style={[sg.avatar, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
          <Text style={[sg.avatarText, { color: theme.accentLight }]}>{group.sellerInitial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sg.sellerName}>{group.sellerName}</Text>
          <Text style={sg.sellerHandle}>{group.sellerHandle}</Text>
        </View>
        <Button
          label="Visit store"
          size="small"
          variant="secondary"
          onPress={() => router.push(('/seller-profile?id=' + group.sellerId) as never)}
          accessibilityHint={`Opens ${group.sellerName}'s store`}
        />
      </View>

      {/* Items */}
      {group.items.map((item, idx) => (
        <View key={item.id}>
          {idx > 0 && <View style={sg.divider} />}
          <CartItemRow
            item={item}
            pendingAction={pendingByItemId[item.id]}
            selected={selectedIds.has(item.id)}
            onToggleSelect={() => onToggleSelect(item.id)}
            buyingNow={buyingItemId === item.id}
            onBuyNow={() => onBuyNow(item)}
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
    </Card>
  );
}

const makeSellerGroupStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { marginBottom: SP.md },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  avatar: { width: 36, height: 36, borderRadius: RADII.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FS.sm, fontFamily: FONT.bold },
  sellerName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  sellerHandle: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
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
          <Button
            label="Move to cart"
            size="small"
            variant="secondary"
            onPress={onMove}
            disabled={!item.isAvailable}
            accessibilityHint={`Moves ${item.productName} to cart`}
          />
          <Button
            label="Remove"
            size="small"
            variant="tertiary"
            onPress={onRemove}
            accessibilityHint={`Removes ${item.productName} from saved items`}
          />
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
    <Card style={sum.root}>
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
    </Card>
  );
}

const makeSummaryStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { marginBottom: SP.md },
  title: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  label: { ...TYPE.body, color: theme.muted },
  labelSm: { fontSize: FS.sm },
  value: { ...TYPE.bodyMedium, ...TABULAR_NUMS, fontFamily: FONT.semibold, color: theme.text },
  valueSm: { fontSize: FS.sm },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: SP.sm },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: SP.xs },
  totalLabel: { ...TYPE.subheading, color: theme.text },
  totalValue: { ...TYPE.subheading, ...TABULAR_NUMS, color: theme.text },
  note: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginTop: SP.sm },
  preOrderNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: SP.sm },
  preOrderNoteText: { fontSize: FS.xs, fontFamily: FONT.regular, flex: 1 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CartScreen() {
  const barInset = useBuyerTabBarInset();
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
  /** True only when we couldn't confirm the cart is really empty (see getCartForScreen). */
  const [loadError, setLoadError] = useState(false);
  const [validating, setValidating] = useState(false);
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [pointsInput, setPointsInput] = useState('');
  const [redeemingPoints, setRedeemingPoints] = useState(false);
  const [loyaltyRedemption, setLoyaltyRedemption] = useState<CheckoutLoyaltyRedemption | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // THREAD CASH HOOK POINT — see components/thread-cash/UseThreadCashCard.tsx.
  const threadCashCheckoutEnabled = useFeatureFlag('threadCashCheckoutDiscount');
  const [threadCashRedemption, setThreadCashRedemption] = useState<CheckoutThreadCashRedemption | null>(null);

  // Which lines are included in "Checkout selected" / a per-item Buy. New
  // items default to selected — buyers opt OUT, they never have to opt in
  // just to check out everything.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const knownItemIdsRef = useRef<Set<string>>(new Set());
  const [buyingItemId, setBuyingItemId] = useState<string | null>(null);

  // Per-row pending actions: itemId → action
  const [pendingByItemId, setPendingByItemId] = useState<Record<string, RowPendingAction>>({});

  const setPending = (itemId: string, action: RowPendingAction) =>
    setPendingByItemId(prev => ({ ...prev, [itemId]: action }));
  const clearPending = (itemId: string) =>
    setPendingByItemId(prev => { const next = { ...prev }; delete next[itemId]; return next; });

  const load = useCallback(async () => {
    try {
      const { cart: nextCart, loadError: nextLoadError } = await getCartForScreen();
      setCart(nextCart);
      setLoadError(nextLoadError);
      setSelectedIds(prev => {
        const next = new Set<string>();
        for (const item of nextCart.items) {
          // A brand-new line (never seen before) defaults to selected; a line
          // the buyer already saw keeps whatever they chose, including "off".
          const isNew = !knownItemIdsRef.current.has(item.id);
          if (isNew || prev.has(item.id)) next.add(item.id);
        }
        knownItemIdsRef.current = new Set(nextCart.items.map(i => i.id));
        return next;
      });
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
    } catch {
      setLoadError(true);
    }
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
  const rewardsAppliedCents = (loyaltyRedemption?.discountCents ?? 0) + (threadCashRedemption?.discountCents ?? 0);
  const displayedDiscount = summary.discountTotalCents + rewardsAppliedCents;
  const displayedTotal = Math.max(0, summary.totalCents - rewardsAppliedCents);

  const selectedItems = cart.items.filter(i => selectedIds.has(i.id));
  const allSelected = cart.items.length > 0 && selectedItems.length === cart.items.length;
  const selectedSummary = calculateCartSummary(selectedItems);
  const selectedDisplayedTotal = allSelected ? displayedTotal : selectedSummary.totalCents;

  function toggleSelect(itemId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  function toggleSelectAll() {
    Haptics.selectionAsync();
    setSelectedIds(allSelected ? new Set() : new Set(cart.items.map(i => i.id)));
  }

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

  /**
   * Shared checkout entry for the whole cart, a "checkout selected" subset,
   * or a single item's own Buy button — always through the same existing
   * order/payment APIs (isBuyNow=true just scopes which items build the
   * session; it never changes how payment itself works).
   */
  async function startCheckout(items: CartItem[], opts: { onBusy?: (busy: boolean) => void } = {}) {
    const setBusy = opts.onBusy ?? setValidating;
    if (items.length === 0) return;
    setBusy(true);
    try {
      if (isSignedIn) {
        const validation = await validateCart(items);
        if (!validation.isValid) {
          const issues = validation.issues.map(i => `• ${i.message}`).join('\n');
          Alert.alert('Review your cart', `Some items need your attention:\n\n${issues}`, [{ text: 'OK' }]);
          setBusy(false);
          return;
        }
      }

      // Check each seller's payment account before entering checkout
      const currentGroups = groupCartBySeller(items);
      // A rewards redemption was computed against the full cart's subtotal —
      // only honor it when this checkout actually covers the whole cart.
      const checkingOutFullCart = items.length === cart.items.length;
      const loyaltyToApply = checkingOutFullCart ? (loyaltyRedemption ?? undefined) : undefined;
      const threadCashToApply = checkingOutFullCart ? (threadCashRedemption ?? undefined) : undefined;
      if ((loyaltyToApply || threadCashToApply) && currentGroups.length !== 1) {
        Alert.alert('Rewards need one store', 'Remove items from other sellers before continuing with this rewards discount.');
        setBusy(false);
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
              setBusy(false);
              return;
            }
          } catch {
            Alert.alert('Unable to verify payments', `We could not confirm ${group.sellerName} can accept payments. Check your connection and try again.`);
            setBusy(false);
            return;
          }
        }
      }

      // Items to check out are always passed explicitly — this is what keeps
      // a single-item Buy, a "checkout selected" subset, and "checkout all"
      // from ever forcing the buyer to purchase (or clear out) more than
      // they chose; buyer-checkout.tsx removes only these items on success.
      await createCheckoutSession(cart, true, items, loyaltyToApply, threadCashToApply);
      push(('/thread-checkout?source=cart') as never);
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
    setBusy(false);
  }

  async function handleCheckoutSelected() {
    await startCheckout(selectedItems);
  }

  async function handleBuyNow(item: CartItem) {
    if (buyingItemId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await startCheckout([item], { onBusy: busy => setBuyingItemId(busy ? item.id : null) });
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
      {/* Header — full-cart totals stay visible at the top too, not just the footer.
          Same BrandthreadHeader treatment used by Orders/Following so the tab-reachable
          buyer screens read as one shell. */}
      <View style={{ paddingTop: insets.top }}>
        <BrandthreadHeader
          title="Cart"
          rightElement={hasItems ? (
            <View style={s.headerRight}>
              <View style={[s.headerBadge, { backgroundColor: theme.accent }]}>
                <Text style={[s.headerBadgeText, { color: theme.onAccent }]}>{cart.items.reduce((s, i) => s + i.quantity, 0)}</Text>
              </View>
              <Text style={s.headerSubtotal}>{fmtPrice(summary.subtotalCents)}</Text>
            </View>
          ) : undefined}
        />
      </View>

      {!hasItems && !hasSaved && !loadError ? (
        <EmptyState
          icon="shopping-bag"
          title="Your cart is ready for something great."
          description="Browse Home and tap Shop on the pieces you love."
          action={{
            label: 'Discover Products',
            icon: 'compass',
            onPress: () => router.push('/(buyer)/discover' as never),
          }}
          style={{ flex: 1 }}
        />
      ) : !hasItems && !hasSaved && loadError ? (
        <InlineError
          message="Couldn’t load your cart. Check your connection and try again."
          onRetry={() => { setLoading(true); void load(); }}
          style={{ flex: 1, justifyContent: 'center' }}
        />
      ) : (
        <>
          {hasItems && (
            <PressableScale
              style={s.selectAllRow}
              onPress={toggleSelectAll}
              accessibilityRole="checkbox"
              accessibilityLabel={allSelected ? 'All items selected' : `${selectedItems.length} of ${cart.items.length} selected`}
              accessibilityState={{ checked: allSelected }}
            >
              <View style={[s.selectAllBox, allSelected && { backgroundColor: theme.accent, borderColor: theme.accent }]}>
                {allSelected && <Feather name="check" size={12} color={theme.onAccent} />}
              </View>
              <Text style={s.selectAllText}>
                {allSelected ? 'All items selected' : `${selectedItems.length} of ${cart.items.length} selected`}
              </Text>
            </PressableScale>
          )}
          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={
              <ThemedRefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
              />
            }
            contentContainerStyle={{
              paddingHorizontal: SP.md,
              paddingTop: SP.sm,
              // Clears the checkout summary, which itself sits above the tab bar.
              paddingBottom: barInset + 150,
            }}
          >
            {/* Seller groups */}
            {groups.map(group => (
              <SellerGroup
                key={group.sellerId}
                group={group}
                pendingByItemId={pendingByItemId}
                selectedIds={selectedIds}
                buyingItemId={buyingItemId}
                onToggleSelect={toggleSelect}
                onBuyNow={handleBuyNow}
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
                      <Button
                        label="Apply"
                        size="small"
                        variant="secondary"
                        onPress={handleApplyPoints}
                        loading={redeemingPoints}
                        disabled={groups.length !== 1}
                        accessibilityHint="Applies loyalty points to this order"
                      />
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
              {/* THREAD CASH HOOK POINT: self-contained card, only visible behind
                  the 'threadCashCheckoutDiscount' flag (default OFF). See
                  components/thread-cash/UseThreadCashCard.tsx and
                  docs/payments/thread-cash-checkout-todo.md. */}
              {isSignedIn && groups.length === 1 && threadCashCheckoutEnabled && (
                <UseThreadCashCard
                  maxDiscountCents={Math.max(0, summary.subtotalCents + summary.shippingTotalCents - 1)}
                  redemption={threadCashRedemption}
                  onApply={setThreadCashRedemption}
                  onRemove={() => setThreadCashRedemption(null)}
                />
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
                <Card>
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
                </Card>
              </View>
            )}

            {!hasSaved && (
              <Text style={s.savedHint}>Products you save for later will appear here.</Text>
            )}
          </ScrollView>

          {/* Checkout button — acts on whatever's checked (all by default), Nike-bag style sticky pill */}
          {hasItems && (
            <StickyFooter tabBarInset={barInset}>
              <View style={s.checkoutSummaryRow}>
                <Text style={s.checkoutSummaryLabel}>
                  {allSelected ? 'Total' : `${selectedItems.length} selected`}
                </Text>
                <Text style={s.checkoutSummaryAmount}>{fmtPrice(selectedDisplayedTotal)}</Text>
              </View>
              <Button
                label={allSelected ? 'Check out' : `Check out ${selectedItems.length} selected`}
                icon="lock"
                onPress={handleCheckoutSelected}
                loading={validating}
                disabled={selectedItems.length === 0}
                fullWidth
                accessibilityHint="Reviews shipping and opens secure payment"
              />
              <Text style={s.secureNote}>
                <Feather name="shield" size={11} color={theme.subtle} /> Secured by Brandthread
              </Text>
            </StickyFooter>
          )}
        </>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeScreenStyles = (theme: AppThemePreset) => StyleSheet.create({
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  headerBadge: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  headerBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold },
  headerSubtotal: { ...TYPE_SCALE.headline, ...TABULAR_NUMS, color: theme.text },
  selectAllRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.md, paddingBottom: SP.xs,
  },
  selectAllBox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  selectAllText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },
  savedSection: { marginBottom: SP.md },
  savedTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
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
  pointsPreview: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: SP.xs, lineHeight: 17 },
  appliedPoints: { flexDirection: 'row', alignItems: 'center', backgroundColor: `${theme.success}26`, borderRadius: RADIUS.md, padding: SP.sm, gap: SP.sm },
  appliedPointsTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.success },
  appliedPointsSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  savedHint: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, textAlign: 'center', marginBottom: SP.lg },
  checkoutSummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
  checkoutSummaryLabel: { ...TYPE_SCALE.footnote, color: theme.muted },
  checkoutSummaryAmount: { ...TYPE_SCALE.headline, ...TABULAR_NUMS, color: theme.text },
  secureNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, textAlign: 'center', marginTop: SP.xs },
});
