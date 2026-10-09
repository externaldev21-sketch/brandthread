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
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, Alert, TextInput, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header, StickyFooter } from '@/components/layout';
import { CachedImage } from '@/components/CachedImage';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { applyCartQuantity } from '@/lib/cartOptimistic';
import * as Haptics from 'expo-haptics';
import {
  getCartForScreen, updateCartItemQuantity, removeCartItem, removeCartItems, restoreCartSnapshot,
  saveForLater, moveToCart, removeSavedItem,
  groupCartBySeller, calculateCartSummary, createCheckoutSession, getCheckoutSession, validateCart,
} from '@/services/cartService';
import {
  Cart, CartItem, SavedCartItem, CartSellerGroup, CheckoutLoyaltyRedemption, CheckoutThreadCashRedemption,
} from '@/services/cartTypes';
import { useScrollReset } from '@/hooks/useScrollReset';
import { ThreadIllustration } from '@/components/illustrations/EmptyStateArt';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { UseThreadCashCard } from '@/components/thread-cash/UseThreadCashCard';
// Same flat-black language as the one-page checkout: sections on pure black,
// uppercase labels, 1px hairlines. No card containers.
import { CheckoutSection } from '@/components/checkout/CheckoutPrimitives';
import { isPreviewCheckoutGroup } from '@/lib/previewCheckout';
import { RecentlyViewedRow } from '@/components/RecentlyViewedRow';
import { useApi } from '@/hooks/useApi';
import SwipeableActions, { type SwipeAction } from '@/components/SwipeableActions';
import { invalidateSellerPaymentStatusCache } from '@/lib/api';
import {
  FONT, FS, SP, RADIUS, COMP, ICON, TYPE,
} from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import {
  BrandedLoader, PressableScale, useUndoToast,
} from '@/components/BrandthreadUI';
import {
  Button, ErrorState, QuantityStepper, StickyBottomCTA, ThemedRefreshControl,
} from '@/components/ui';
import { RADII, radius } from '@/constants/radii';
import { TABULAR_NUMS, TYPE_SCALE } from '@/constants/typography';

import { useAuth } from '@clerk/expo';
import { formatCents } from '@/lib/money';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { BUYER_CART_STEPS } from '@/lib/firstRunTips/content';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPrice = formatCents;

// Sticky checkout bar's own fixed height (excluding the safe-area padding,
// which is added separately wherever this is used) — StickyFooter's
// paddingTop (SP.sm) plus the Checkout pill's height (COMP.buttonH), the
// tallest thing in that row. Used to size the scroll content's own bottom
// padding so the last line of content always clears the bar, instead of a
// guessed magic number.
const STICKY_BAR_CONTENT_HEIGHT = SP.sm + COMP.buttonH;

// ─── Row pending state tracker ────────────────────────────────────────────────
// Tracks which action is in-flight per item ID so the row can show a localized
// spinner without blocking the whole cart.
type RowPendingAction = 'qty_dec' | 'qty_inc' | 'remove' | 'save';

const HIT_SLOP_8 = { top: 8, bottom: 8, left: 8, right: 8 };

// ─── Quantity Row ─────────────────────────────────────────────────────────────

function QuantityControl({
  value, max, onDec, onInc, onRemove, pendingDec, pendingInc, itemLabel, testID,
}: {
  value: number;
  max: number;
  onDec: () => void;
  onInc: () => void;
  /** At qty 1 the − becomes a trash and removes the line (same flow + Undo as Remove). */
  onRemove: () => void;
  pendingDec?: boolean;
  pendingInc?: boolean;
  itemLabel: string;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const busy = pendingDec || pendingInc;
  const handleChange = useCallback((next: number) => (next > value ? onInc() : onDec()), [value, onInc, onDec]);
  return (
    <View style={{ opacity: busy ? 0.5 : 1, flexDirection: 'row', alignItems: 'center', gap: SP.xs }}>
      <QuantityStepper
        value={value}
        min={1}
        max={Math.max(max, 1)}
        disabled={busy}
        onChange={handleChange}
        onRemoveAtMin={onRemove}
        itemLabel={itemLabel}
        testID={testID}
      />
      {busy && <ActivityIndicator size="small" color={theme.text} style={{ marginLeft: 2 }} />}
    </View>
  );
}

// ─── Cart Item Row ─────────────────────────────────────────────────────────────

function CartItemRow({
  item, pendingAction, selected, onToggleSelect, onQtyDec, onQtyInc, onRemove, onSaveForLater, onEditVariant,
}: {
  item: CartItem;
  pendingAction?: RowPendingAction;
  selected: boolean;
  onToggleSelect: () => void;
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

  // Swipe left to reveal Save for later + Remove — Mobbin: ZARA iOS shopping
  // bag (row swiped left → SAVE / DELETE side by side). Same shared
  // SwipeableActions as Activity rows; both actions run the exact handlers
  // the row's own Save / Remove buttons use (same API, same undo toast).
  // Monochrome: Save on a light-gray tint of the card (ZARA's dark SAVE), Remove
  // white with a black trash (the screen's one solid "act" color, like the
  // Checkout pill) — no red.
  const swipeActions = useMemo<SwipeAction[]>(() => [
    {
      key: 'save',
      icon: 'bookmark',
      color: 'rgba(255,255,255,0.14)',
      iconColor: theme.text,
      accessibilityLabel: `Save ${item.productName} for later`,
      onPress: onSaveForLater,
    },
    {
      key: 'remove',
      icon: 'trash-2',
      color: '#FFFFFF',
      iconColor: '#000000',
      accessibilityLabel: `Remove ${item.productName} from cart`,
      onPress: onRemove,
    },
  ], [item.productName, onRemove, onSaveForLater, theme.text]);

  return (
    <View style={ir.swipeBleed} testID={`cart-row-${item.id}`}>
    <SwipeableActions actions={swipeActions} disabled={isRowBusy}>
    <View style={[ir.root, ir.swipeFront, isRowBusy && ir.rowBusy]}>
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

      {/* Dev's line-item spec (Ulta Beauty bag; Amazon / Zalando for the
          qty and remove pattern): a bigger 3:4 image, never cropped; name
          with the price right-aligned on the title row; size + edit; the
          stepper on its own row; one quiet grey text row at the bottom. No
          purchase control on the line: checkout is per seller group (under
          the group subtotal) and the main Checkout bar. */}
      <View style={ir.img}>
        {item.imageUri
          ? <CachedImage source={{ uri: item.imageUri }} style={ir.productImage} contentFit="contain" recyclingKey={item.imageUri} />
          : <Feather name="image" size={ICON.md} color={theme.muted} />}
      </View>

      <View style={ir.col}>
        <View style={ir.titleRow}>
          <Text style={ir.name} numberOfLines={3}>{item.productName}</Text>
          <View style={ir.priceBlock}>
            <Text style={[ir.price, hasDiscount ? ir.priceDiscounted : undefined]}>{fmtPrice(lineTotal)}</Text>
            {hasDiscount && (
              <Text style={ir.comparePrice}>{fmtPrice(item.compareAtPriceCents! * item.quantity)}</Text>
            )}
          </View>
        </View>
        <PressableScale
          style={ir.variantRow}
          onPress={onEditVariant}
          disabled={isRowBusy}
          noMinHeight
          hitSlop={HIT_SLOP_8}
          accessibilityLabel={`Change options for ${item.productName}. Current: ${item.variantTitle}`}
        >
          <Text style={ir.variant}>{item.variantTitle}</Text>
          <Feather name="edit-2" size={12} color={theme.muted} />
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

        {/* Qty on its own row. At 1 the − is a trash (QuantityStepper's
            onRemoveAtMin): the same remove flow + Undo as the text link. */}
        <View style={ir.qtyRow}>
          <QuantityControl
            value={item.quantity}
            max={item.maxQuantity}
            onDec={onQtyDec}
            onInc={onQtyInc}
            onRemove={onRemove}
            itemLabel={item.productName}
            testID={`cart-qty-${item.id}`}
            pendingDec={pendingAction === 'qty_dec'}
            pendingInc={pendingAction === 'qty_inc'}
          />
        </View>

        {/* One quiet text row, left-aligned, grey 13pt (never red: red is
            LIVE and end-call only), well away from any primary button. */}
        <View style={ir.textActions}>
          <PressableScale
            style={ir.textAction}
            onPress={onSaveForLater}
            disabled={isRowBusy}
            noMinHeight
            rippleEnabled={false}
            accessibilityLabel={`Save ${item.productName} for later`}
            accessibilityState={{ disabled: isRowBusy, busy: pendingAction === 'save' }}
            testID={`cart-save-${item.id}`}
          >
            <Text style={ir.textActionLabel}>Save for later</Text>
          </PressableScale>
          <Text style={ir.textActionDot} importantForAccessibility="no" accessibilityElementsHidden>·</Text>
          <PressableScale
            style={ir.textAction}
            onPress={onRemove}
            disabled={isRowBusy}
            noMinHeight
            rippleEnabled={false}
            accessibilityLabel={`Remove ${item.productName} from cart`}
            accessibilityState={{ disabled: isRowBusy, busy: pendingAction === 'remove' }}
            testID={`cart-remove-${item.id}`}
          >
            <Text style={ir.textActionLabel}>Remove</Text>
          </PressableScale>
        </View>
      </View>
    </View>
    </SwipeableActions>
    </View>
  );
}

const makeItemRowStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flexDirection: 'row', gap: SP.sm, paddingVertical: SP.sm, alignItems: 'flex-start' },
  rowBusy: { opacity: 0.7 },
  // The swipe row spans the full screen width (edge to edge, cancelling the
  // list's 16pt gutter) so the revealed actions sit flush with the screen
  // edge; the row pads itself back in, so at rest nothing moves. Opaque black
  // (the page color) so the actions never show through at rest (web).
  swipeBleed: { marginHorizontal: -SP.md },
  swipeFront: { paddingHorizontal: SP.md, backgroundColor: theme.background },
  checkbox: { width: COMP.minTouchTarget, height: 72, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  checkboxBox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  busyOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 10, alignItems: 'center', justifyContent: 'center',
  },
  // 3:4 and `contain`: the whole product shows, never cropped.
  img: {
    width: 84, height: 112, borderRadius: RADII.card,
    backgroundColor: theme.cardElevatedGlass, borderWidth: 1, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  productImage: { width: '100%', height: '100%' },
  // Root gap (8) + this margin (8) = the 16pt gutter between image and text.
  col: { flex: 1, minWidth: 0, marginLeft: SP.sm },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  name: { ...TYPE.bodyMedium, fontFamily: FONT.semibold, color: theme.text, flex: 1, minWidth: 0 },
  // 28pt + 8pt hitSlop above and below = a 44pt target.
  variantRow: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, alignSelf: 'flex-start', marginTop: 2 },
  variant: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  preOrderBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  preOrderText: { fontSize: FS.xs, fontFamily: FONT.medium },
  unavailBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: `${theme.error}26`, borderRadius: RADIUS.pill,
    paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-start', marginBottom: 4,
  },
  unavailText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.error, flex: 1, flexShrink: 1 },
  stockWarnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4,
    backgroundColor: `${theme.warning}26`, borderRadius: RADIUS.pill,
    paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start',
  },
  stockWarnCritical: { backgroundColor: `${theme.error}26` },
  stockWarn: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.warning },
  stockWarnCriticalText: { color: theme.error },
  priceBlock: { alignItems: 'flex-end' },
  comparePrice: { fontSize: FS.meta, ...TABULAR_NUMS, fontFamily: FONT.medium, color: theme.subtle, textDecorationLine: 'line-through' },
  price: { fontSize: FS.md, ...TABULAR_NUMS, fontFamily: FONT.bold, color: theme.text },
  priceDiscounted: { color: theme.success },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: SP.xs },
  // Grey 13pt text links, each a 44pt-tall target, left-aligned.
  textActions: { flexDirection: 'row', alignItems: 'center', marginTop: 2, marginLeft: -SP.xs },
  textAction: { height: 44, justifyContent: 'center', paddingHorizontal: SP.xs },
  textActionLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
  textActionDot: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.subtle, marginHorizontal: 2 },
});


// ─── Seller Group ─────────────────────────────────────────────────────────────

function SellerGroup({
  group, first, pendingByItemId, selectedIds, checkingOut, checkoutDisabled, onCheckoutGroup, onToggleSelect, onQtyDec, onQtyInc, onRemove, onSaveForLater, onEditVariant,
}: {
  group: CartSellerGroup;
  /** The first section has no hairline above it. */
  first: boolean;
  pendingByItemId: Record<string, RowPendingAction>;
  selectedIds: Set<string>;
  /** This seller's own checkout is starting. */
  checkingOut: boolean;
  /** Another checkout is already starting. */
  checkoutDisabled: boolean;
  onCheckoutGroup: (sellerId: string) => void;
  onToggleSelect: (itemId: string) => void;
  onQtyDec: (itemId: string) => void;
  onQtyInc: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onSaveForLater: (itemId: string) => void;
  onEditVariant: (item: CartItem) => void;
}) {
  const { theme } = useAppTheme();
  const sg = useMemo(() => makeSellerGroupStyles(theme), [theme]);
  const router = useRouter();
  const openStore = useCallback(
    () => router.push(('/seller-profile?id=' + encodeURIComponent(group.sellerId)) as never),
    [router, group.sellerId],
  );
  const checkoutThisSeller = useCallback(() => onCheckoutGroup(group.sellerId), [onCheckoutGroup, group.sellerId]);
  const hasAvailable = group.items.some(item => item.isAvailable);
  return (
    <CheckoutSection first={first} testID={`cart-seller-${group.sellerId}`}>
      {/* Seller header — avatar, name, and a chevron to the store (the
          whole row is the tap target, not a separate "Visit store" button).
          Same per-seller grouping as checkout: both come from
          groupCartBySeller (checkout's deliveryGroups are built from it in
          createCheckoutSession), so a cart section = one checkout payment.
          Only the lines below are swipeable/steppable — never this header. */}
      <PressableScale
        style={sg.sellerRow}
        onPress={openStore}
        testID={`cart-seller-header-${group.sellerId}`}
        accessibilityRole="button"
        accessibilityLabel={`Visit ${group.sellerName}'s store`}
        noMinHeight
      >
        <View style={[sg.avatar, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
          {group.sellerAvatarUri ? (
            <CachedImage source={{ uri: group.sellerAvatarUri }} style={sg.avatarImage} contentFit="cover" recyclingKey={group.sellerAvatarUri} />
          ) : (
            <Text style={[sg.avatarText, { color: theme.accentLight }]}>{group.sellerInitial}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sg.sellerName}>{group.sellerName}</Text>
          <Text style={sg.sellerHandle}>{group.sellerHandle}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={theme.muted} />
      </PressableScale>

      {/* Items */}
      {group.items.map((item, idx) => (
        <View key={item.id}>
          {idx > 0 && <View style={sg.divider} />}
          <SellerGroupLine
            item={item}
            pendingAction={pendingByItemId[item.id]}
            selected={selectedIds.has(item.id)}
            onToggleSelect={onToggleSelect}
            onQtyDec={onQtyDec}
            onQtyInc={onQtyInc}
            onRemove={onRemove}
            onSaveForLater={onSaveForLater}
            onEditVariant={onEditVariant}
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
        {/* The only per-line purchase path now: this seller's items, as one
            payment (a cart section = one checkout delivery group). */}
        <Button
          label={`Checkout from ${group.sellerName}`}
          variant="secondary"
          fullWidth
          loading={checkingOut}
          disabled={!hasAvailable || checkoutDisabled}
          onPress={checkoutThisSeller}
          accessibilityHint={`Checks out only ${group.sellerName}'s items, ${fmtPrice(group.subtotalCents)}`}
          style={sg.groupCheckout}
          testID={`cart-group-checkout-${group.sellerId}`}
        />
      </View>
    </CheckoutSection>
  );
}

/**
 * One line inside a seller section: binds the section's id-based handlers to
 * this line with stable callbacks (no inline arrows reaching the row's
 * PressableScale buttons).
 */
function SellerGroupLine({
  item, pendingAction, selected,
  onToggleSelect, onQtyDec, onQtyInc, onRemove, onSaveForLater, onEditVariant,
}: {
  item: CartItem;
  pendingAction?: RowPendingAction;
  selected: boolean;
  onToggleSelect: (itemId: string) => void;
  onQtyDec: (itemId: string) => void;
  onQtyInc: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onSaveForLater: (itemId: string) => void;
  onEditVariant: (item: CartItem) => void;
}) {
  const id = item.id;
  const toggle = useCallback(() => onToggleSelect(id), [onToggleSelect, id]);
  const dec = useCallback(() => onQtyDec(id), [onQtyDec, id]);
  const inc = useCallback(() => onQtyInc(id), [onQtyInc, id]);
  const remove = useCallback(() => onRemove(id), [onRemove, id]);
  const save = useCallback(() => onSaveForLater(id), [onSaveForLater, id]);
  const edit = useCallback(() => onEditVariant(item), [onEditVariant, item]);
  return (
    <CartItemRow
      item={item}
      pendingAction={pendingAction}
      selected={selected}
      onToggleSelect={toggle}
      onQtyDec={dec}
      onQtyInc={inc}
      onRemove={remove}
      onSaveForLater={save}
      onEditVariant={edit}
    />
  );
}

const makeSellerGroupStyles = (theme: AppThemePreset) => StyleSheet.create({
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  avatar: { width: 38, height: 38, borderRadius: RADII.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { fontSize: FS.sm, fontFamily: FONT.bold },
  sellerName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  sellerHandle: { fontSize: FS.meta, fontFamily: FONT.medium, color: theme.muted },
  // The checkout's hairline (theme.borderSubtle), between lines and above the footer.
  divider: { height: 1, backgroundColor: theme.borderSubtle, marginVertical: SP.xs },
  footer: { borderTopWidth: 1, borderTopColor: theme.borderSubtle, marginTop: SP.sm, paddingTop: SP.sm, gap: 4 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerText: { fontSize: FS.meta, fontFamily: FONT.medium, color: theme.muted },
  groupSubtotal: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, marginTop: 4 },
  groupCheckout: { marginTop: SP.sm },
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
  variant: { fontSize: FS.meta, fontFamily: FONT.medium, color: theme.muted, marginBottom: 2 },
  price: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, marginBottom: 4 },
  unavail: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.error, marginBottom: 4 },
  actions: { flexDirection: 'row', gap: SP.sm },
});

// ─── Order summary ─────────────────────────────────────────────────────────────

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
    <CheckoutSection title="Order summary" testID="cart-order-summary">
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
    </CheckoutSection>
  );
}

const makeSummaryStyles = (theme: AppThemePreset) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  label: { ...TYPE.body, color: theme.muted },
  labelSm: { fontSize: FS.sm },
  value: { ...TYPE.bodyMedium, ...TABULAR_NUMS, fontFamily: FONT.semibold, color: theme.text },
  valueSm: { fontSize: FS.sm },
  divider: { height: 1, backgroundColor: theme.borderSubtle, marginVertical: SP.sm },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: SP.xs },
  totalLabel: { ...TYPE.subheading, color: theme.text },
  totalValue: { ...TYPE.subheading, ...TABULAR_NUMS, color: theme.text },
  note: { fontSize: FS.meta, fontFamily: FONT.medium, color: theme.subtle, marginTop: SP.sm },
  preOrderNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: SP.sm },
  preOrderNoteText: { fontSize: FS.meta, fontFamily: FONT.medium, flex: 1 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CartScreen() {
  const scrollResetRef = useScrollReset<ScrollView>();
  // Cart is a pushed screen reached from the feed's cart icon or Shop the
  // Post (see BUYER_TAB_BAR_HIDDEN_ROUTES in BuyerTabBar.tsx) — the floating
  // tab bar is hidden here entirely, so content pads by the plain safe-area
  // bottom inset instead of the bar's occupied height.
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const s = useMemo(() => makeScreenStyles(theme), [theme]);
  const router = useRouter();
  const { push } = useThreadPull();
  const api = useApi();
  const { isSignedIn, userId: cartOwnerId } = useAuth();
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
  const [checkingOutSellerId, setCheckingOutSellerId] = useState<string | null>(null);

  // Header "Edit" toggle — reuses the existing per-item selection checkboxes
  // to drive a bulk "Remove selected" action instead of adding a second,
  // parallel selection model.
  const [editMode, setEditMode] = useState(false);
  const [removingSelected, setRemovingSelected] = useState(false);

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

  // Revisits refresh silently over the cart already on screen; the loading
  // state is only for the very first load (no flash back to a spinner).
  const hasLoadedCartRef = useRef<string | null | undefined>(undefined);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (hasLoadedCartRef.current !== cartOwnerId) setLoading(true);
    void load().then(() => { hasLoadedCartRef.current = cartOwnerId; });
    if (isSignedIn) {
      void api.loyalty.get()
        .then(result => { if (active) setLoyaltyBalance(Math.max(0, Number(result.balance ?? 0))); })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [api, load, isSignedIn, cartOwnerId]));

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

  // Quantity steppers are optimistic: the new count shows on the tap itself
  // (lib/cartOptimistic.ts mirrors the service's own rules) and is persisted
  // right after. cartRef tracks the latest optimistic cart so rapid taps
  // build on each other instead of on a stale render. Only a failed write
  // rolls back.
  const cartRef = useRef(cart);
  cartRef.current = cart;

  async function changeQuantity(itemId: string, delta: number) {
    if (pendingByItemId[itemId]) return;
    Haptics.selectionAsync();
    const snapshot = cartRef.current;
    const item = snapshot.items.find(i => i.id === itemId);
    if (!item) return;
    const target = item.quantity + delta;
    const optimistic = applyCartQuantity(snapshot, itemId, target);
    cartRef.current = optimistic;
    setCart(optimistic);
    if (target <= 0) {
      showUndo({
        message: `"${item.productName}" removed`,
        undo: async () => setCart(await restoreCartSnapshot(snapshot)),
      });
    }
    try {
      await updateCartItemQuantity(itemId, target);
    } catch {
      cartRef.current = snapshot;
      setCart(snapshot);
    }
  }

  function handleQtyDec(itemId: string) {
    void changeQuantity(itemId, -1);
  }

  function handleQtyInc(itemId: string) {
    void changeQuantity(itemId, 1);
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

  async function handleRemoveSelected() {
    if (selectedIds.size === 0 || removingSelected) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRemovingSelected(true);
    try {
      const newCart = await removeCartItems([...selectedIds]);
      setCart(newCart);
      setSelectedIds(new Set());
      setEditMode(false);
    } finally {
      setRemovingSelected(false);
    }
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
   * or one seller's section ("Checkout from {Seller}") — always through the same existing
   * order/payment APIs (isBuyNow=true just scopes which items build the
   * session; it never changes how payment itself works).
   */
  async function startCheckout(items: CartItem[], opts: { onBusy?: (busy: boolean) => void } = {}) {
    const setBusy = opts.onBusy ?? setValidating;
    if (items.length === 0) return;
    setBusy(true);
    // Dev-web preview only: seeded preview products have no server cart or
    // seller payment account to check (lib/previewCheckout.ts).
    const previewOnlyCheckout = groupCartBySeller(items).every(isPreviewCheckoutGroup);
    try {
      if (isSignedIn && !previewOnlyCheckout) {
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
          if (isPreviewCheckoutGroup(group)) continue;
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

  // "Checkout from {Seller}": that seller's available lines as one payment.
  async function handleCheckoutGroup(sellerId: string) {
    if (checkingOutSellerId) return;
    const items = cart.items.filter(item => item.sellerId === sellerId && item.isAvailable);
    if (items.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await startCheckout(items, { onBusy: busy => setCheckingOutSellerId(busy ? sellerId : null) });
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
      {/* Pushed-screen header: back chevron + "Cart (N)" + Edit, matching
          every other stack screen (not the tab-root large-title header) —
          this is a screen reached from the feed's cart icon or Shop the
          Post, never its own tab (see BUYER_TAB_BAR_HIDDEN_ROUTES). */}
      <Header
        title={`Cart${hasItems ? ` (${cart.items.reduce((sum, i) => sum + i.quantity, 0)})` : ''}`}
        showBack
        // Over the page's pure black (no second, lighter band).
        transparent
        rightElement={hasItems ? (
          <TouchableOpacity
            onPress={() => { Haptics.selectionAsync(); setEditMode(e => !e); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={editMode ? 'Done editing cart' : 'Edit cart'}
            // Header's compact row already contributes SP.sm (8pt) of its own
            // paddingHorizontal; this adds the remaining 8pt so Edit's right
            // inset totals 16pt — the same as the back chevron's left inset.
            style={s.editBtn}
          >
            <Text style={[s.editText, { color: theme.accentLight }]}>{editMode ? 'Done' : 'Edit'}</Text>
          </TouchableOpacity>
        ) : undefined}
      />

      {!hasItems && !hasSaved && !loadError ? (
        // Monochrome empty state (Threads/Instagram-style plain icon-in-circle,
        // not the shared BrandthreadUI EmptyState's colored gradient
        // illustration) at the requested 120pt circle / 52pt CTA sizing.
        <View style={[s.emptyWrap, { flex: 1 }]}>
          <View style={[s.emptyIconCircle, { backgroundColor: theme.cardElevatedGlass, borderColor: theme.border }]}>
            <ThreadIllustration motif="hanger" size={52} color={theme.muted} strokeWidth={4.5} />
          </View>
          <Text style={[s.emptyTitle, { color: theme.text }]}>Your cart is empty</Text>
          <Text style={[s.emptyDescription, { color: theme.muted }]}>Tap Shop on a post you love to add it here.</Text>
          <Button
            label="Continue shopping"
            icon="compass"
            onPress={() => router.navigate('/(buyer)/discover' as never)}
            style={s.emptyCta}
            accessibilityHint="Opens Discover to browse products"
          />
        </View>
      ) : !hasItems && !hasSaved && loadError ? (
        <ErrorState
          message="Couldn’t load your cart. Check your connection and try again."
          onRetry={() => { setLoading(true); void load(); }}
          style={{ flex: 1, justifyContent: 'center' }}
        />
      ) : (
        <>
          {hasItems && editMode && (
            <View style={s.editBar}>
              <Text style={s.editBarText}>
                {selectedItems.length > 0 ? `${selectedItems.length} selected` : 'Select items to remove'}
              </Text>
              <Button
                label="Remove"
                size="compact"
                // Monochrome: red is for LIVE and end-call only. Same grey
                // secondary treatment as the row and swipe Remove actions.
                variant="secondary"
                onPress={handleRemoveSelected}
                loading={removingSelected}
                disabled={selectedItems.length === 0}
                accessibilityHint="Removes the selected items from your cart"
              />
            </View>
          )}
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
            ref={scrollResetRef}
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
              // Sticky bar's own height + the safe-area inset it pads by +
              // 16pt breathing room, so the last line of content (the saved-
              // for-later hint) is never left peeking out from behind the
              // bar — no floating tab bar to clear on this pushed screen.
              paddingBottom: STICKY_BAR_CONTENT_HEIGHT + insets.bottom + SP.md,
            }}
          >
            {/* Seller groups */}
            {groups.map((group, index) => (
              <SellerGroup
                key={group.sellerId}
                group={group}
                first={index === 0}
                pendingByItemId={pendingByItemId}
                selectedIds={selectedIds}
                checkingOut={checkingOutSellerId === group.sellerId}
                checkoutDisabled={!!checkingOutSellerId && checkingOutSellerId !== group.sellerId}
                onCheckoutGroup={handleCheckoutGroup}
                onToggleSelect={toggleSelect}
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
                <View style={s.multiSellerNotice}>
                  <Feather name="layers" size={15} color={theme.muted} style={{ marginTop: 2 }} />
                  <Text style={[s.multiSellerText, { color: theme.muted }]}>Items from {groups.length} sellers ship separately, each with its own delivery estimate.</Text>
                </View>
              )}
              {isSignedIn && (
              <View style={s.loyaltyCard}>
                <View style={s.loyaltyHeading}>
                  <View style={s.loyaltyIcon}>
                    <Feather name="gift" size={15} color={theme.text} />
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
                <View>
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

            <RecentlyViewedRow style={{ marginTop: SP.xl }} />
          </ScrollView>

          {/* Sticky checkout bar — total on the left, a white "Checkout" pill
              on the right, pinned above the home indicator. This is a pushed
              screen with the floating tab bar hidden (see
              BUYER_TAB_BAR_HIDDEN_ROUTES), so it pads by insets.bottom + 8,
              not the tab bar's occupied height. */}
          {hasItems && (
            <StickyFooter style={{ paddingBottom: insets.bottom + 8, backgroundColor: theme.background, borderTopColor: theme.borderSubtle }}>
              <View style={s.checkoutBarRow}>
                <View>
                  <Text style={s.checkoutSummaryLabel}>
                    {allSelected ? 'Total' : `${selectedItems.length} selected`}
                  </Text>
                  <Text style={s.checkoutSummaryAmount}>{fmtPrice(selectedDisplayedTotal)}</Text>
                </View>
                <TouchableOpacity
                  onPress={handleCheckoutSelected}
                  disabled={selectedItems.length === 0 || validating}
                  activeOpacity={0.85}
                  style={[s.checkoutPill, (selectedItems.length === 0 || validating) && { opacity: 0.5 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Checkout"
                  accessibilityHint="Reviews shipping and opens secure payment"
                >
                  {validating ? (
                    <ActivityIndicator size="small" color="#000000" />
                  ) : (
                    <Text style={s.checkoutPillText}>Checkout</Text>
                  )}
                </TouchableOpacity>
              </View>
            </StickyFooter>
          )}
        </>
      )}
      <FirstRunTip
        id="buyer-cart"
        variant="anchored"
        contentReady={!loading}
        anchored={{ steps: BUYER_CART_STEPS }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeScreenStyles = (theme: AppThemePreset) => StyleSheet.create({
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl, gap: SP.sm },
  emptyIconCircle: {
    width: 120, height: 120, borderRadius: 60, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm,
  },
  emptyTitle: { fontSize: FS.lg, fontFamily: FONT.bold, textAlign: 'center' },
  emptyDescription: { fontSize: FS.base, fontFamily: FONT.regular, textAlign: 'center', lineHeight: 21, maxWidth: 280 },
  emptyCta: { marginTop: SP.md },
  editBtn: { paddingRight: SP.sm },
  editText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  editBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    backgroundColor: theme.background, borderBottomWidth: 1, borderBottomColor: theme.borderSubtle,
  },
  editBarText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
  selectAllRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.md, paddingBottom: SP.xs,
  },
  selectAllBox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  selectAllText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
  // Same label + hairline as a checkout section (CheckoutPrimitives).
  savedSection: { borderTopWidth: 1, borderTopColor: theme.borderSubtle, paddingTop: 14, marginBottom: SP.md },
  savedTitle: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: SP.sm + 4 },
  divider: { height: 1, backgroundColor: theme.borderSubtle, marginVertical: SP.xs },
  multiSellerNotice: { flexDirection: 'row', gap: SP.sm, borderTopWidth: 1, borderTopColor: theme.borderSubtle, paddingVertical: 14 },
  multiSellerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  loyaltyCard: { borderTopWidth: 1, borderTopColor: theme.borderSubtle, paddingVertical: 14 },
  loyaltyHeading: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  loyaltyIcon: { width: 30, height: 30, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  loyaltyTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  loyaltySub: { fontSize: FS.meta, fontFamily: FONT.medium, color: theme.muted, marginTop: 2 },
  pointsRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'center' },
  // The checkout's dark field with a hairline border.
  pointsInput: { flex: 1, height: 48, borderRadius: 12, backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border, color: theme.text, fontFamily: FONT.regular, paddingHorizontal: 14 },
  pointsPreview: { fontSize: FS.meta, fontFamily: FONT.medium, color: theme.muted, marginTop: SP.xs, lineHeight: 17 },
  appliedPoints: { flexDirection: 'row', alignItems: 'center', backgroundColor: `${theme.success}26`, borderRadius: RADIUS.md, padding: SP.sm, gap: SP.sm },
  appliedPointsTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.success },
  appliedPointsSub: { fontSize: FS.meta, fontFamily: FONT.medium, color: theme.muted, marginTop: 2 },
  savedHint: { fontSize: FS.meta, fontFamily: FONT.medium, color: theme.subtle, textAlign: 'center', marginBottom: SP.lg },
  // Sticky checkout bar: total on the left, a white pill on the right —
  // Nike Bag / TikTok Shop checkout-bar reference, forced white/black
  // regardless of theme so it reads as the one fixed "pay" affordance.
  checkoutBarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkoutSummaryLabel: { ...TYPE_SCALE.footnote, color: theme.muted },
  checkoutSummaryAmount: { ...TYPE_SCALE.headline, ...TABULAR_NUMS, color: theme.text },
  checkoutPill: {
    minWidth: 132, minHeight: COMP.buttonH,
    borderRadius: radius.md, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SP.lg,
  },
  checkoutPillText: { fontSize: FS.base, fontFamily: FONT.bold, color: '#000000' },
});
