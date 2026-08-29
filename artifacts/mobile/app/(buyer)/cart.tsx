/**
 * Brandthread Buyer Cart Screen
 * Multi-seller cart with save-for-later, summary, and checkout entry.
 */
import React, { useState, useCallback } from 'react';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, StyleSheet, Image,
  ActivityIndicator, Alert, TextInput, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  getCart, updateCartItemQuantity, removeCartItem,
  saveForLater, moveToCart, removeSavedItem,
  groupCartBySeller, calculateCartSummary, createCheckoutSession, getCheckoutSession, validateCart,
} from '@/services/cartService';
import {
  Cart, CartItem, SavedCartItem, CartSellerGroup, CheckoutLoyaltyRedemption,
} from '@/services/cartTypes';
import { useApi } from '@/hooks/useApi';
import { invalidateSellerPaymentStatusCache } from '@/lib/api';
import {
  BG, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE,
  SUCCESS, SUCCESS_DIM,
  ORANGE, ORANGE_DIM,
  RED, RED_DIM,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BrandthreadScreen, BrandthreadHeader, StatusBadge, EmptyState, BrandedLoader, PressableScale,
} from '@/components/BrandthreadUI';

import { useAuth } from '@clerk/expo';
import { formatCents } from '@/lib/money';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPrice = formatCents;

// ─── Quantity Row ─────────────────────────────────────────────────────────────

function QuantityControl({ value, max, onDec, onInc }: {
  value: number; max: number; onDec: () => void; onInc: () => void;
}) {
  return (
    <View style={qc.root}>
      <PressableScale style={qc.btn} onPress={onDec} >
        <Feather name="minus" size={13} color={FG} />
      </PressableScale>
      <Text style={qc.val}>{value}</Text>
      <PressableScale style={[qc.btn, value >= max && qc.btnDisabled]} onPress={onInc} disabled={value >= max}>
        <Feather name="plus" size={13} color={value >= max ? SUBTLE : FG} />
      </PressableScale>
    </View>
  );
}
const qc = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  btn:  { width: 28, height: 28, borderRadius: 8, backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.4 },
  val:  { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, minWidth: 20, textAlign: 'center' },
});

// ─── Cart Item Row ─────────────────────────────────────────────────────────────

function CartItemRow({
  item, onQtyDec, onQtyInc, onRemove, onSaveForLater, onEditVariant,
}: {
  item: CartItem;
  onQtyDec: () => void;
  onQtyInc: () => void;
  onRemove: () => void;
  onSaveForLater: () => void;
  onEditVariant: () => void;
}) {
  const { theme } = useAppTheme();
  const lineTotal = item.priceCents * item.quantity;
  const hasDiscount = item.compareAtPriceCents && item.compareAtPriceCents > item.priceCents;

  return (
    <View style={ir.root}>
      <View style={ir.img}>
        {item.imageUri
          ? <Image source={{ uri: item.imageUri }} style={ir.productImage} resizeMode="cover" />
          : <Feather name="image" size={ICON.lg} color={MUTED} />}
      </View>

      {/* Details */}
      <View style={{ flex: 1 }}>
        <Text style={ir.name} numberOfLines={2}>{item.productName}</Text>
        <PressableScale style={ir.variantRow} onPress={onEditVariant} >
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

        {!item.isAvailable && (
          <View style={ir.unavailBadge}>
            <Text style={ir.unavailText}>{item.unavailableReason ?? 'Unavailable'}</Text>
          </View>
        )}

        {item.maxQuantity <= 3 && item.isAvailable && (
          <Text style={ir.stockWarn}>Only {item.maxQuantity} left</Text>
        )}

        {/* Price + qty */}
        <View style={ir.bottomRow}>
          <QuantityControl
            value={item.quantity}
            max={item.maxQuantity}
            onDec={onQtyDec}
            onInc={onQtyInc}
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
          <PressableScale style={ir.actionBtn} onPress={onSaveForLater} >
            <Feather name="bookmark" size={12} color={MUTED} />
            <Text style={ir.actionText}>Save</Text>
          </PressableScale>
          <View style={ir.actionDivider} />
          <PressableScale style={ir.actionBtn} onPress={onRemove} >
            <Feather name="trash-2" size={12} color={RED} />
            <Text style={[ir.actionText, { color: RED }]}>Remove</Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

const ir = StyleSheet.create({
  root: { flexDirection: 'row', gap: SP.sm, paddingVertical: SP.sm },
  img: {
    width: 80, height: 100, borderRadius: RADIUS.md,
    backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  productImage: { width: '100%', height: '100%' },
  name: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 4, lineHeight: 18 },
  variantRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  variant: { fontSize: FS.xs, fontFamily: FONT.regular },
  preOrderBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  preOrderText: { fontSize: FS.xs, fontFamily: FONT.medium },
  unavailBadge: { backgroundColor: RED_DIM, borderRadius: RADIUS.xs, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 4 },
  unavailText: { fontSize: FS.xs, fontFamily: FONT.medium, color: RED },
  stockWarn: { fontSize: FS.xs, fontFamily: FONT.medium, color: ORANGE, marginBottom: 4 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  priceBlock: { alignItems: 'flex-end' },
  comparePrice: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textDecorationLine: 'line-through' },
  price: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  priceDiscounted: { color: SUCCESS },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: SP.xs },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8 },
  actionText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  actionDivider: { width: 1, height: 14, backgroundColor: BORDER },
});

// ─── Seller Group ─────────────────────────────────────────────────────────────

function SellerGroup({
  group, onQtyDec, onQtyInc, onRemove, onSaveForLater, onEditVariant,
}: {
  group: CartSellerGroup;
  onQtyDec: (itemId: string) => void;
  onQtyInc: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onSaveForLater: (itemId: string) => void;
  onEditVariant: (item: CartItem) => void;
}) {
  const { theme } = useAppTheme();
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
        >
          <Text style={[sg.visitBtnText, { color: theme.accentLight }]}>Visit Store</Text>
        </PressableScale>
      </View>

      {/* Items */}
      {group.items.map((item, idx) => (
        <View key={item.id}>
          {idx > 0 && <View style={sg.divider} />}
          <CartItemRow
            item={item}
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
          <Feather name="truck" size={12} color={MUTED} />
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

const sg = StyleSheet.create({
  root: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, marginBottom: SP.md },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  avatar: { width: 36, height: 36, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FS.sm, fontFamily: FONT.bold },
  sellerName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  sellerHandle: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  visitBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.sm, borderWidth: 1 },
  visitBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: SP.xs },
  footer: { borderTopWidth: 1, borderTopColor: BORDER, marginTop: SP.sm, paddingTop: SP.sm, gap: 4 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  groupSubtotal: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginTop: 4 },
});

// ─── Saved for Later ──────────────────────────────────────────────────────────

function SavedItemRow({ item, onMove, onRemove }: {
  item: SavedCartItem;
  onMove: () => void;
  onRemove: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={si.root}>
      <View style={si.img}>
        <Feather name="bookmark" size={ICON.md} color={MUTED} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={si.name} numberOfLines={1}>{item.productName}</Text>
        <Text style={si.variant}>{item.variantTitle}</Text>
        <Text style={si.price}>{fmtPrice(item.priceCents)}</Text>
        {!item.isAvailable && (
          <Text style={si.unavail}>No longer available</Text>
        )}
        <View style={si.actions}>
          <PressableScale style={[si.btn, { backgroundColor: theme.accentDim, borderColor: theme.accent }]} onPress={onMove} >
            <Text style={[si.btnText, { color: theme.accentLight }, !item.isAvailable && { color: SUBTLE }]}>Move to Cart</Text>
          </PressableScale>
          <PressableScale style={si.btnGhost} onPress={onRemove} >
            <Text style={si.btnGhostText}>Remove</Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

const si = StyleSheet.create({
  root: { flexDirection: 'row', gap: SP.sm, paddingVertical: SP.sm },
  img: { width: 56, height: 70, borderRadius: RADIUS.sm, backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  variant: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginBottom: 2 },
  price: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 4 },
  unavail: { fontSize: FS.xs, fontFamily: FONT.medium, color: RED, marginBottom: 4 },
  actions: { flexDirection: 'row', gap: SP.sm },
  btn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.sm, borderWidth: 1 },
  btnText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  btnGhost: { paddingHorizontal: 10, paddingVertical: 5 },
  btnGhostText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
});

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ subtotal, discountTotal, shipping, tax, total, hasPreOrder }: {
  subtotal: number; discountTotal: number; shipping: number; tax: number; total: number; hasPreOrder: boolean;
}) {
  const { theme } = useAppTheme();
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
      <Text style={sum.title}>Order Summary</Text>
      <Row label="Subtotal" value={fmtPrice(subtotal)} />
      {discountTotal > 0 && <Row label="Discounts" value={`–${fmtPrice(discountTotal)}`} accent={SUCCESS} />}
      <Row label="Est. shipping" value={fmtPrice(shipping)} small />
      <Row label="Est. tax" value={fmtPrice(tax)} small />
      <View style={sum.divider} />
      <Row label="Est. total" value={fmtPrice(total)} />
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

const sum = StyleSheet.create({
  root: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, marginBottom: SP.md },
  title: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  label: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED },
  labelSm: { fontSize: FS.sm },
  value: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  valueSm: { fontSize: FS.sm },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: SP.sm },
  note: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: SP.sm },
  preOrderNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: SP.sm },
  preOrderNoteText: { fontSize: FS.xs, fontFamily: FONT.regular, flex: 1 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CartScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { isSignedIn } = useAuth();

  const [cart, setCart] = useState<Cart>({ id: '', items: [], savedItems: [], updatedAt: '' });
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [pointsInput, setPointsInput] = useState('');
  const [redeemingPoints, setRedeemingPoints] = useState(false);
  const [loyaltyRedemption, setLoyaltyRedemption] = useState<CheckoutLoyaltyRedemption | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
    Haptics.selectionAsync();
    const item = cart.items.find(i => i.id === itemId);
    if (!item) return;
    const newCart = await updateCartItemQuantity(itemId, item.quantity - 1);
    setCart(newCart);
  }

  async function handleQtyInc(itemId: string) {
    Haptics.selectionAsync();
    const item = cart.items.find(i => i.id === itemId);
    if (!item) return;
    const newCart = await updateCartItemQuantity(itemId, item.quantity + 1);
    setCart(newCart);
  }

  async function handleRemove(itemId: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newCart = await removeCartItem(itemId);
    setCart(newCart);
  }

  async function handleSaveForLater(itemId: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newCart = await saveForLater(itemId);
    setCart(newCart);
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
    router.push(('/buyer-product-detail?productId=' + item.productId + '&editVariantId=' + item.variantId + '&editCartItemId=' + item.id) as never);
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
          Alert.alert('Review Your Cart', `Some items need your attention:\n\n${issues}`, [{ text: 'OK' }]);
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
                'Payments Unavailable',
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
      router.push(('/buyer-checkout?source=cart') as never);
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
    setValidating(false);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <BrandedLoader label="Gathering your picks…" />
      </View>
    );
  }

  const hasItems = cart.items.length > 0;
  const hasSaved = cart.savedItems.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <Text style={s.headerTitle}>Cart</Text>
        {hasItems && (
          <View style={[s.headerBadge, { backgroundColor: theme.accent }]}>
            <Text style={s.headerBadgeText}>{cart.items.reduce((s, i) => s + i.quantity, 0)}</Text>
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
                    <Feather name="check-circle" size={19} color={SUCCESS} />
                  </View>
                ) : (
                  <>
                    <View style={s.pointsRow}>
                      <TextInput
                        value={pointsInput}
                        onChangeText={setPointsInput}
                        keyboardType="number-pad"
                        placeholder="Points to use"
                        placeholderTextColor={SUBTLE}
                        style={s.pointsInput}
                      />
                      <PressableScale
                        style={[s.pointsApply, { backgroundColor: theme.accentDim, borderColor: theme.accent }, (redeemingPoints || groups.length !== 1) && s.pointsApplyDisabled]}
                        onPress={handleApplyPoints}
                        disabled={redeemingPoints || groups.length !== 1}
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
                          ? `You’ll save ${fmtPrice(loyaltyPreviewCents)} at checkout.`
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
                <Text style={s.savedTitle}>Saved for Later ({cart.savedItems.length})</Text>
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
                      <Text style={[s.checkoutText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Checkout · {fmtPrice(displayedTotal)}</Text>
                    </>
                  )}
                </LinearGradient>
              </PressableScale>
              <Text style={s.secureNote}>
                <Feather name="shield" size={11} color={SUBTLE} /> Secured by Brandthread
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    gap: SP.sm,
  },
  headerTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  headerBadge: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  headerBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: '#fff' },
  savedSection: { marginBottom: SP.md },
  savedTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  savedCard: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: SP.xs },
  multiSellerNotice: { flexDirection: 'row', gap: SP.sm, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md },
  multiSellerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  loyaltyCard: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.md, marginBottom: SP.md },
  loyaltyHeading: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  loyaltyIcon: { width: 30, height: 30, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  loyaltyTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  loyaltySub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  pointsRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'center' },
  pointsInput: { flex: 1, height: COMP.inputH, borderRadius: RADIUS.md, backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, color: FG, fontFamily: FONT.regular, paddingHorizontal: SP.md },
  pointsApply: { minWidth: 76, height: COMP.inputH, borderRadius: RADIUS.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pointsApplyDisabled: { opacity: 0.5 },
  pointsApplyText: { fontSize: FS.sm, fontFamily: FONT.bold },
  pointsPreview: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: SP.xs, lineHeight: 17 },
  appliedPoints: { flexDirection: 'row', alignItems: 'center', backgroundColor: SUCCESS_DIM, borderRadius: RADIUS.md, padding: SP.sm, gap: SP.sm },
  appliedPointsTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: SUCCESS },
  appliedPointsSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  savedHint: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', marginBottom: SP.lg },
  checkoutBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    backgroundColor: BG,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  checkoutBtn: { borderRadius: RADIUS.lg, overflow: 'hidden', shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  checkoutGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    height: COMP.buttonH,
    borderRadius: RADIUS.lg,
  },
  checkoutText: { fontSize: FS.base, fontFamily: FONT.bold },
  secureNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', marginTop: SP.xs },
});
