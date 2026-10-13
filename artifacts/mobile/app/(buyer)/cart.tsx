import { haptics } from '@/lib/haptics';
/**
 * Brandthread bag — SSENSE's Shopping bag flow 1:1, reskinned
 * (https://mobbin.com/flows/b906e342-83ab-4424-bf3b-59514df7dc6d; parts in
 * components/bag/BagParts.tsx). Size and quantity change in place; shipping
 * shows the sellers' real rates; "Go to checkout" checks out every available
 * line as one session (one payment per seller, as before).
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { View, Text, ScrollView, StyleSheet, Alert, TextInput, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CachedImage } from '@/components/CachedImage';
import { Icon } from '@/components/ui/Icon';
import { useRouter, useFocusEffect } from 'expo-router';
import { applyCartQuantity } from '@/lib/cartOptimistic';
import * as Haptics from 'expo-haptics';
import {
  getCartForScreen, updateCartItemQuantity, removeCartItem, removeCartItems, restoreCartSnapshot,
  saveForLater, moveToCart, removeSavedItem,
  groupCartBySeller, calculateCartSummary, createCheckoutSession, getCheckoutSession, validateCart,
  estimateGroupShipping, totalShippingEstimate, replaceCartItemVariant, type ShippingEstimate,
} from '@/services/cartService';
import { VariantPickerSheet } from '@/components/buy-now/VariantPickerSheet';
import {
  BAG_BAR_HEIGHT, BagCheckoutBar, BagColumns, BagEmpty, BagHeader, BagItemRow, BagTotals, toNewArrivals,
  type BagLineBusy, type NewArrival,
} from '@/components/bag/BagParts';
import { Cart, CartItem, SavedCartItem, CheckoutThreadCashRedemption, CheckoutLoyaltyRedemption, BuyerProduct, BuyerProductVariant } from '@/services/cartTypes';
import { useScrollReset } from '@/hooks/useScrollReset';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { ThreadIllustration } from '@/components/illustrations/EmptyStateArt';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { UseThreadCashCard } from '@/components/thread-cash/UseThreadCashCard';
import { rewardsNeedOneStore } from '@/lib/threadCashCheckout';
import { stripePaymentAvailable } from '@/components/checkout/StripePayment';
// Same flat-black language as the one-page checkout: sections on pure black,
// uppercase labels, 1px hairlines. No card containers.
import { CheckoutSection } from '@/components/checkout/CheckoutPrimitives';
import { isPreviewCheckoutGroup } from '@/lib/previewCheckout';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { useApi } from '@/hooks/useApi';
import { invalidateSellerPaymentStatusCache } from '@/lib/api';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { savedProducts } from '@/lib/saved/savedProducts';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { BrandedLoader, PressableScale, useUndoToast } from '@/components/BrandthreadUI';
import { Button, ErrorState, ThemedRefreshControl } from '@/components/ui';
import { useAuth } from '@clerk/expo';
import { formatCents } from '@/lib/money';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { BUYER_CART_STEPS } from '@/lib/firstRunTips/content';
import { useScreenInteractive } from '@/lib/perf';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPrice = formatCents;

type RowPendingAction = NonNullable<BagLineBusy>;

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
        <Icon name="bookmark" size={20} color={theme.muted} />
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
  price: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, marginBottom: 4, fontVariant: ['tabular-nums'] },
  unavail: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.error, marginBottom: 4 },
  actions: { flexDirection: 'row', gap: SP.sm },
});

// ─── Order summary ─────────────────────────────────────────────────────────────

export default function CartScreen() {
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removingSelected, setRemovingSelected] = useState(false);
  async function handleRemoveSelected() {
    if (!selectedIds.size || removingSelected) return;
    setRemovingSelected(true);
    try {
      setCart(await removeCartItems([...selectedIds]));
      setSelectedIds(new Set());
      setEditMode(false);
    } catch (error) {
      Alert.alert('Couldn’t remove items', error instanceof Error ? error.message : 'Try again.');
    } finally { setRemovingSelected(false); }
  }
  const scrollResetRef = useScrollReset<ScrollView>();
  // Cart is a pushed screen reached from the feed's cart icon or Shop the
  // Post (see BUYER_TAB_BAR_HIDDEN_ROUTES in BuyerTabBar.tsx) — the floating
  // tab bar is hidden here entirely, so content pads by the plain safe-area
  // bottom inset instead of the bar's occupied height.
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const s = useMemo(() => makeScreenStyles(theme), [theme]);
  const headerTopInset = useHeaderTopInset();
  const router = useRouter();
  const { push } = useThreadPull();
  const api = useApi();
  const { isSignedIn, userId: cartOwnerId } = useAuth();
  const { showUndo } = useUndoToast();

  const [cart, setCart] = useState<Cart>({ id: '', items: [], savedItems: [], updatedAt: '' });
  const [shippingEstimates, setShippingEstimates] = useState<Record<string, ShippingEstimate | null>>({});
  // The line whose size/qty is being changed in the inline picker.
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [loading, setLoading] = useState(true);
  useScreenInteractive('bag', !loading);
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
  const hostedCheckoutFallback = useFeatureFlag('hostedCheckoutFallback');
  const [threadCashRedemption, setThreadCashRedemption] = useState<CheckoutThreadCashRedemption | null>(null);

  // Which lines are included in "Checkout selected" / a per-item Buy. New
  // items default to selected — buyers opt OUT, they never have to opt in
  // just to check out everything.
  const knownItemIdsRef = useRef<Set<string>>(new Set());
  const [checkingOutSellerId, setCheckingOutSellerId] = useState<string | null>(null);

  // Header "Edit" toggle — reuses the existing per-item selection checkboxes
  // to drive a bulk "Remove selected" action instead of adding a second,
  // parallel selection model.

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
  // Real shipping per seller group (the rate checkout will charge).
  const groupsKey = groups.map(g => `${g.sellerId}:${g.subtotalCents}`).join('|');
  useEffect(() => {
    if (!groupsKey) return undefined;
    let active = true;
    const current = groupCartBySeller(cart.items);
    void Promise.all(current.map(async g => [g.sellerId, await estimateGroupShipping(g.sellerId, g.subtotalCents)] as const))
      .then(entries => { if (active) setShippingEstimates(Object.fromEntries(entries)); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsKey]);
  const shippingTotal = totalShippingEstimate(groups.map(g => g.sellerId), shippingEstimates);
  const summary = calculateCartSummary(cart.items, 0, shippingTotal ?? 0);
  const requestedPoints = Math.floor(Number(pointsInput));
  const maxRedeemablePoints = Math.min(
    loyaltyBalance,
    Math.max(0, summary.subtotalCents - 1),
  );
  const loyaltyPreviewCents = Number.isFinite(requestedPoints) && requestedPoints >= 100
    ? Math.min(requestedPoints, maxRedeemablePoints)
    : 0;
  const rewardsAppliedCents = loyaltyRedemption?.discountCents ?? 0;
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
    haptics.selection();
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
    haptics.warning();
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
    haptics.light();
    setPending(itemId, 'save');
    try {
      const newCart = await saveForLater(itemId);
      setCart(newCart);
    } finally {
      clearPending(itemId);
    }
  }

  async function handleMoveToCart(savedId: string) {
    haptics.light();
    const newCart = await moveToCart(savedId);
    setCart(newCart);
  }

  async function handleRemoveSaved(savedId: string) {
    const newCart = await removeSavedItem(savedId);
    setCart(newCart);
  }

  function handleEditVariant(item: CartItem) {
    setEditingItem(item);
  }

  async function handleConfirmVariant(product: BuyerProduct, variant: BuyerProductVariant, quantity: number) {
    if (!editingItem) return;
    const result = await replaceCartItemVariant(editingItem.id, product, variant, quantity);
    if (!result.success) {
      Alert.alert('Couldn’t update this item', result.message ?? 'Try again.');
      return;
    }
    setCart(result.cart);
    setEditingItem(null);
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
      haptics.success();
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
      // Thread Cash covers several stores when checkout pays in the app (BT-270).
      if (rewardsNeedOneStore({
        storeCount: currentGroups.length, loyalty: !!loyaltyToApply, threadCash: !!threadCashToApply,
        paysInApp: !!isSignedIn && stripePaymentAvailable() && !hostedCheckoutFallback,
      })) {
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
      await createCheckoutSession(cart, true, items, loyaltyToApply);
      push(('/thread-checkout?source=cart') as never);
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
    setBusy(false);
  }

  async function handleMoveToSaves(itemId: string) {
    if (pendingByItemId[itemId]) return;
    const item = cart.items.find(i => i.id === itemId);
    if (!item) return;
    // Signed out there are no Saves yet; keep the line on this device instead.
    if (!savedProducts.isSignedIn()) { await handleSaveForLater(itemId); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const snapshot = cart;
    setPending(itemId, 'save');
    try {
      if (!savedProducts.has(item.productId)) {
        const result = await savedProducts.toggle({
          productId: item.productId, title: item.productName, brand: item.sellerName, priceCents: item.priceCents,
        });
        if (!result.ok) {
          Alert.alert('Couldn’t move to saves', 'Check your connection and try again.');
          return;
        }
      }
      setCart(await removeCartItem(itemId));
      showUndo({
        message: 'Moved to saves',
        undo: async () => setCart(await restoreCartSnapshot(snapshot)),
      });
    } finally {
      clearPending(itemId);
    }
  }

  const loadNewArrivals = useCallback(async (): Promise<NewArrival[]> => {
    if (isBuyerDevPreview() && !isSignedIn) return [];
    return toNewArrivals(await api.publicProducts.list({ limit: 12 }));
  }, [api, isSignedIn]);

  const availableItems = cart.items.filter(item => item.isAvailable);
  const itemCount = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  const closeBag = () => goBackOr(router, '/(buyer)');

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <BagHeader topInset={headerTopInset} onClose={closeBag} />
        <BrandedLoader label="Gathering your picks…" />
      </View>
    );
  }

  const hasItems = cart.items.length > 0;
  const hasSaved = cart.savedItems.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <BagHeader topInset={headerTopInset} onClose={closeBag} rightElement={hasItems ? (
        <TouchableOpacity onPress={() => setEditMode(v => !v)} accessibilityRole="button" accessibilityLabel={editMode ? 'Done editing cart' : 'Edit cart'}>
          <Text style={{ color: theme.text }}>{editMode ? 'Done' : 'Edit'}</Text>
        </TouchableOpacity>
      ) : undefined} />

      {!hasItems && loadError ? (
        <ErrorState
          message="Couldn’t load your bag."
          onRetry={() => { setLoading(true); void load(); }}
          style={{ flex: 1, justifyContent: 'center' }}
        />
      ) : (
        <>
          <ScrollView
            ref={scrollResetRef}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
            contentContainerStyle={{
              paddingHorizontal: SP.md,
              paddingBottom: (hasItems ? BAG_BAR_HEIGHT : 0) + insets.bottom + SP.lg,
            }}
          >
            {hasItems ? (
              <>
                <BagColumns count={itemCount} />
                {editMode && <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: SP.sm }}>
                  <Button label="Select all" variant="secondary" size="small" onPress={() => setSelectedIds(new Set(cart.items.map(i => i.id)))} />
                  <Button label={`Remove (${selectedIds.size})`} variant="secondary" size="small" disabled={!selectedIds.size} loading={removingSelected} onPress={handleRemoveSelected} />
                </View>}
                {cart.items.map(item => (
                  <View key={item.id}>
                  {editMode && <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: selectedIds.has(item.id) }} accessibilityLabel={`Select ${item.productName}`} onPress={() => setSelectedIds(ids => { const next = new Set(ids); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}>
                    <Text style={{ color: theme.text }}>{selectedIds.has(item.id) ? 'Selected' : 'Select'}</Text>
                  </TouchableOpacity>}
                  <BagItemRow
                    key={item.id}
                    item={item}
                    busy={pendingByItemId[item.id]}
                    onOpen={() => push({ pathname: '/thread-product-detail' as any, params: { productId: item.productId, src: 'cart' } } as never)}
                    onChangeSize={() => handleEditVariant(item)}
                    onQtyDec={() => handleQtyDec(item.id)}
                    onQtyInc={() => handleQtyInc(item.id)}
                    onMoveToSaves={() => handleMoveToSaves(item.id)}
                    onRemove={() => handleRemove(item.id)}
                  />
                  </View>
                ))}

                {/* Points sit where SSENSE puts its promo line, only when the buyer has some. */}
                {isSignedIn && loyaltyBalance > 0 && (
                  <View style={s.loyaltyCard}>
                    <Text style={s.loyaltyTitle}>Use points</Text>
                    <Text style={s.loyaltySub}>
                      {loyaltyBalance.toLocaleString()} points available · 100 points = $1.00
                    </Text>
                    {loyaltyRedemption ? (
                      <Text style={s.appliedPointsTitle}>
                        {loyaltyRedemption.pointsUsed.toLocaleString()} points applied · −{fmtPrice(loyaltyRedemption.discountCents)}
                      </Text>
                    ) : (
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
                    )}
                    {!loyaltyRedemption && (
                      <Text style={s.pointsPreview}>
                        {groups.length !== 1
                          ? 'Points apply to one seller at a time.'
                          : loyaltyPreviewCents > 0
                            ? `You'll save ${fmtPrice(loyaltyPreviewCents)} at checkout.`
                            : `Use up to ${maxRedeemablePoints.toLocaleString()} points on this order.`}
                      </Text>
                    )}
                  </View>
                )}

                <BagTotals
                  itemCount={itemCount}
                  subtotalCents={summary.subtotalCents}
                  discountCents={displayedDiscount}
                  shippingCents={shippingTotal}
                  totalCents={displayedTotal}
                  hasPreOrder={hasPreOrder}
                />
              </>
            ) : (
              <BagEmpty
                loadArrivals={loadNewArrivals}
                onShopNow={() => router.navigate('/(buyer)/discover' as never)}
                onViewAll={() => router.navigate('/(buyer)/discover' as never)}
                onOpenProduct={(productId) => push({ pathname: '/thread-product-detail' as any, params: { productId, src: 'cart' } } as never)}
              />
            )}

            {/* Lines kept on this device from before Saves existed (or while signed out). */}
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
          </ScrollView>

          {hasItems && (
            <BagCheckoutBar
              totalCents={displayedTotal}
              bottomInset={insets.bottom}
              busy={validating}
              disabled={availableItems.length === 0 || validating}
              onCheckout={() => { void startCheckout(availableItems); }}
            />
          )}
        </>
      )}
      {/* Change size / qty in place (no trip back to the product page). */}
      {editingItem && (
        <VariantPickerSheet
          productId={editingItem.productId}
          initialVariantId={editingItem.variantId}
          initialQuantity={editingItem.quantity}
          confirmVerb="Update"
          onClose={() => setEditingItem(null)}
          onConfirm={handleConfirmVariant}
        />
      )}
    </View>
  );
}

const makeScreenStyles = (theme: AppThemePreset) => StyleSheet.create({
  savedSection: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: 14, marginTop: SP.md, marginBottom: SP.md },
  savedTitle: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginBottom: SP.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginVertical: SP.xs },
  loyaltyCard: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border, paddingVertical: 14, gap: SP.xs },
  loyaltyTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  loyaltySub: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  pointsRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'center', marginTop: SP.xs },
  pointsInput: { flex: 1, height: 44, borderRadius: RADIUS.md, backgroundColor: '#1C1C1E', color: theme.text, fontFamily: FONT.regular, paddingHorizontal: 14 },
  pointsPreview: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, lineHeight: 17 },
  appliedPointsTitle: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
});
