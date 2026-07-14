/**
 * Brandthread Buyer Cart Screen
 * Multi-seller cart with save-for-later, summary, and checkout entry.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  getCart, updateCartItemQuantity, removeCartItem,
  saveForLater, moveToCart, removeSavedItem,
  groupCartBySeller, calculateCartSummary, validateCart,
} from '@/services/cartService';
import { Cart, CartItem, SavedCartItem, CartSellerGroup } from '@/services/cartTypes';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM,
  SUCCESS, SUCCESS_DIM,
  ORANGE, ORANGE_DIM,
  RED, RED_DIM,
  GRAD_PRIMARY,
  FONT, FS, SP, RADIUS, COMP, ICON,
  SHADOW_PURPLE,
} from '@/lib/theme';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BrandthreadScreen, BrandthreadHeader, StatusBadge, EmptyState,
} from '@/components/BrandthreadUI';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(n: number) { return '$' + n.toFixed(2); }

// ─── Quantity Row ─────────────────────────────────────────────────────────────

function QuantityControl({ value, max, onDec, onInc }: {
  value: number; max: number; onDec: () => void; onInc: () => void;
}) {
  return (
    <View style={qc.root}>
      <TouchableOpacity style={qc.btn} onPress={onDec} activeOpacity={0.7}>
        <Feather name="minus" size={13} color={FG} />
      </TouchableOpacity>
      <Text style={qc.val}>{value}</Text>
      <TouchableOpacity style={[qc.btn, value >= max && qc.btnDisabled]} onPress={onInc} activeOpacity={0.7} disabled={value >= max}>
        <Feather name="plus" size={13} color={value >= max ? SUBTLE : FG} />
      </TouchableOpacity>
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
  const lineTotal = item.price * item.quantity;
  const hasDiscount = item.compareAtPrice && item.compareAtPrice > item.price;

  return (
    <View style={ir.root}>
      {/* Image placeholder */}
      <View style={ir.img}>
        <Feather name="package" size={ICON.lg} color={MUTED} />
      </View>

      {/* Details */}
      <View style={{ flex: 1 }}>
        <Text style={ir.name} numberOfLines={2}>{item.productName}</Text>
        <TouchableOpacity style={ir.variantRow} onPress={onEditVariant} activeOpacity={0.7}>
          <Text style={ir.variant}>{item.variantTitle}</Text>
          <Feather name="edit-2" size={11} color={PURPLE_LIGHT} />
        </TouchableOpacity>

        {item.isPreOrder && (
          <View style={ir.preOrderBadge}>
            <Feather name="clock" size={10} color={CYAN} />
            <Text style={ir.preOrderText}>
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
              <Text style={ir.comparePrice}>{fmtPrice(item.compareAtPrice! * item.quantity)}</Text>
            )}
            <Text style={[ir.price, hasDiscount ? ir.priceDiscounted : undefined]}>{fmtPrice(lineTotal)}</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={ir.actions}>
          <TouchableOpacity style={ir.actionBtn} onPress={onSaveForLater} activeOpacity={0.7}>
            <Feather name="bookmark" size={12} color={MUTED} />
            <Text style={ir.actionText}>Save</Text>
          </TouchableOpacity>
          <View style={ir.actionDivider} />
          <TouchableOpacity style={ir.actionBtn} onPress={onRemove} activeOpacity={0.7}>
            <Feather name="trash-2" size={12} color={RED} />
            <Text style={[ir.actionText, { color: RED }]}>Remove</Text>
          </TouchableOpacity>
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
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 4, lineHeight: 18 },
  variantRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  variant: { fontSize: FS.xs, fontFamily: FONT.regular, color: PURPLE_LIGHT },
  preOrderBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  preOrderText: { fontSize: FS.xs, fontFamily: FONT.medium, color: CYAN },
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
  const router = useRouter();
  return (
    <View style={sg.root}>
      {/* Seller header */}
      <View style={sg.sellerRow}>
        <View style={sg.avatar}>
          <Text style={sg.avatarText}>{group.sellerInitial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sg.sellerName}>{group.sellerName}</Text>
          <Text style={sg.sellerHandle}>{group.sellerHandle}</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push(('/seller-profile?id=' + group.sellerId) as never)}
          activeOpacity={0.7}
          style={sg.visitBtn}
        >
          <Text style={sg.visitBtnText}>Visit Store</Text>
        </TouchableOpacity>
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
            <Feather name="clock" size={12} color={CYAN} />
            <Text style={[sg.footerText, { color: CYAN }]}>Contains pre-order items</Text>
          </View>
        )}
        <Text style={sg.groupSubtotal}>Group subtotal: {fmtPrice(group.subtotal)}</Text>
      </View>
    </View>
  );
}

const sg = StyleSheet.create({
  root: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, marginBottom: SP.md },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  avatar: { width: 36, height: 36, borderRadius: RADIUS.pill, backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: BORDER_ACTIVE, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FS.sm, fontFamily: FONT.bold, color: PURPLE_LIGHT },
  sellerName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  sellerHandle: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  visitBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: BORDER_ACTIVE },
  visitBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
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
  return (
    <View style={si.root}>
      <View style={si.img}>
        <Feather name="bookmark" size={ICON.md} color={MUTED} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={si.name} numberOfLines={1}>{item.productName}</Text>
        <Text style={si.variant}>{item.variantTitle}</Text>
        <Text style={si.price}>{fmtPrice(item.price)}</Text>
        {!item.isAvailable && (
          <Text style={si.unavail}>No longer available</Text>
        )}
        <View style={si.actions}>
          <TouchableOpacity style={si.btn} onPress={onMove} activeOpacity={0.7} disabled={!item.isAvailable}>
            <Text style={[si.btnText, !item.isAvailable && { color: SUBTLE }]}>Move to Cart</Text>
          </TouchableOpacity>
          <TouchableOpacity style={si.btnGhost} onPress={onRemove} activeOpacity={0.7}>
            <Text style={si.btnGhostText}>Remove</Text>
          </TouchableOpacity>
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
  btn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: BORDER_ACTIVE },
  btnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  btnGhost: { paddingHorizontal: 10, paddingVertical: 5 },
  btnGhostText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
});

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ subtotal, discountTotal, shipping, tax, total, hasPreOrder }: {
  subtotal: number; discountTotal: number; shipping: number; tax: number; total: number; hasPreOrder: boolean;
}) {
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
          <Feather name="clock" size={12} color={CYAN} />
          <Text style={sum.preOrderNoteText}>Pre-order items will ship after production. Items may ship separately.</Text>
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
  preOrderNoteText: { fontSize: FS.xs, fontFamily: FONT.regular, color: CYAN, flex: 1 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CartScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [cart, setCart] = useState<Cart>({ id: '', items: [], savedItems: [], updatedAt: '' });
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);

  const load = useCallback(async () => {
    try { setCart(await getCart()); } catch {}
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const groups = groupCartBySeller(cart.items);
  const hasPreOrder = cart.items.some(i => i.isPreOrder);
  const summary = calculateCartSummary(cart.items);

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
    router.push(('/buyer-product-detail?productId=' + item.productId + '&editVariantId=' + item.variantId) as never);
  }

  async function handleCheckout() {
    if (cart.items.length === 0) return;
    setValidating(true);
    try {
      const validation = await validateCart(cart.items);
      if (!validation.isValid) {
        const issues = validation.issues.map(i => `• ${i.message}`).join('\n');
        Alert.alert('Review Your Cart', `Some items need your attention:\n\n${issues}`, [{ text: 'OK' }]);
        setValidating(false);
        return;
      }
      router.push(('/buyer-checkout?source=cart') as never);
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
    setValidating(false);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={PURPLE} size="large" />
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
          <View style={s.headerBadge}>
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
              <SummaryCard
                subtotal={summary.subtotal}
                discountTotal={summary.discountTotal}
                shipping={summary.shippingTotal}
                tax={summary.taxTotal}
                total={summary.total}
                hasPreOrder={hasPreOrder}
              />
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
              <TouchableOpacity
                style={s.checkoutBtn}
                onPress={handleCheckout}
                activeOpacity={0.88}
                disabled={validating}
              >
                <LinearGradient
                  colors={[...GRAD_PRIMARY]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.checkoutGrad}
                >
                  {validating ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Feather name="lock" size={16} color="#fff" />
                      <Text style={s.checkoutText}>Checkout · {fmtPrice(summary.total)}</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
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
    backgroundColor: PURPLE,
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
  checkoutBtn: { borderRadius: RADIUS.lg, overflow: 'hidden', ...SHADOW_PURPLE },
  checkoutGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    height: COMP.buttonH,
    borderRadius: RADIUS.lg,
  },
  checkoutText: { fontSize: FS.base, fontFamily: FONT.bold, color: '#fff' },
  secureNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', marginTop: SP.xs },
});
