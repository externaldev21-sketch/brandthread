import { Pressable, ScrollView, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { formatCents } from '@/lib/money';
import { Icon as Feather } from '@/components/ui/Icon';
import { openContextMenu } from '@/lib/contextMenu';

import { copyText } from '@/lib/shareActions';

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { usePersistedChoice } from '@/hooks/usePersistedChoice';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';

import { CachedImage as Image } from '@/components/CachedImage';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FlashList, type FlashListRef } from '@shopify/flash-list';

import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';

import { statusBadgeRepeatsHeadline } from '@/lib/buyerOrderCardStatus';

import { Icon } from '@/components/ui/Icon';

import { useAuth } from '@clerk/expo';

import { isSecondDeliveryMoment, maybeRequestStoreReview } from '@/lib/storeReviewPrompt';

import { useRouter, useFocusEffect } from 'expo-router';
import { useShopperRoutes } from '@/hooks/useShopperRoutes';
import { keepShopping } from '@/lib/navigation/shopperRoutes';


import { prefetchBuyerOrderOnPressIn } from '@/lib/detailPrefetch';

import * as Haptics from 'expo-haptics';
import { haptic } from '@/lib/haptics';

import { useScrollReset } from '@/hooks/useScrollReset';

import { BuyerOrderView, cancellationReasonLabel, TrackingStatus, OrderStatus } from '@/services/orderTypes';

import { getBuyerOrdersWithStatus, mapApiBuyerOrder } from '@/services/orderService';

import { visibleOrdersForBuyer } from '@/lib/buyerOrdersVisibility';

import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';

import { getPreviewBuyerOrders as getPreviewDeliveryBuyerOrders, isPreviewOrderId } from '@/lib/previewOrders';

import { getPreviewBuyerOrders as getPreviewCommerceBuyerOrders, isPreviewCommerceId } from '@/lib/previewCommerce';

import { deliveryHeadline } from '@/lib/deliveryGuarantee';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import {
  BrandthreadScreen, FilterChip,
  StatusBadge, EmptyState, SearchBar,
} from '@/components/BrandthreadUI';
import { searchOrders } from '@/lib/orderSearch';
import { Header, SkeletonBlock, useCenteredContentPadding } from '@/components/layout';

import { OrderStatusTimeline } from '@/components/orders/OrderStatusTimeline';
import { stepIndex } from '@/components/orders/OrderProgressTimeline';
import { orderDisplayNumber } from '@/lib/orderDisplayNumber';
import { useReorderFlow } from '@/components/orders/ReorderFlow';

import { canReorderStatus } from '@/lib/reorderSummary';

import { RetryRow } from '@/components/ui/RetryRow';
import { getBuyerReturns } from '@/services/buyerReturnsService';
import { returnReasonLabel, statusLabel as returnStatusLabel, type ReturnView } from '@/lib/returns';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useRealtimeEvents } from '@/lib/realtime/conversationRealtime';

import { syncOrderActivities } from '@/lib/nativeSystem';

import { formatMoney } from '@/lib/format';

import { ChipRow } from '@/components/ui/ChipRow';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Monochrome: every order status reads as the same neutral pill; the label carries the meaning.
function statusBadgeVariant(_status: OrderStatus): 'neutral' {
  return 'neutral';
}

function statusBadgeLabel(status: OrderStatus): string {
  switch (status) {
    case 'new':           return 'NEW';
    case 'processing':    return 'PROCESSING';
    case 'ready_to_ship': return 'READY';
    case 'shipped':       return 'SHIPPED';
    case 'delivered':     return 'DELIVERED';
    case 'cancelled':     return 'CANCELLED';
    case 'refunded':      return 'REFUNDED';
    case 'disputed':      return 'DISPUTED';
    default:              return (status as string).toUpperCase();
  }
}

function trackingLabel(ts: TrackingStatus): string {
  switch (ts) {
    case 'label_created':    return 'Label created';
    case 'accepted':         return 'Accepted';
    case 'in_transit':       return 'In transit';
    case 'out_for_delivery': return 'Out for delivery';
    case 'delivered':        return 'Delivered';
    case 'exception':        return 'Exception';
    case 'returned_to_sender': return 'Returned to sender';
    default: return ts;
  }
}

type BuyerFilterKey = 'all' | 'active' | 'shipped' | 'delivered' | 'returns' | 'pre-order';

const FILTER_CHIPS: { key: BuyerFilterKey; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'active',    label: 'Active' },
  { key: 'shipped',   label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'returns',   label: 'Returns' },
  { key: 'pre-order', label: 'Pre-order' },
];

function applyFilter(orders: BuyerOrderView[], filter: BuyerFilterKey): BuyerOrderView[] {
  switch (filter) {
    case 'all':       return orders;
    case 'active':    return orders.filter(o => ['new', 'processing', 'ready_to_ship'].includes(o.status));
    case 'shipped':   return orders.filter(o => o.status === 'shipped');
    case 'delivered': return orders.filter(o => o.status === 'delivered');
    // The Returns tab renders the buyer's return requests from
    // GET /api/returns/buyer (see BuyerReturnCard), not order rows.
    case 'returns':   return [];
    case 'pre-order': return orders.filter(o => o.isPreOrder);
    default:          return orders;
  }
}

// ─── Card pieces ──────────────────────────────────────────────────────────────

/** The seller's logo in a circle, or their initial when there's none (or it fails to load). */
function BrandMark({ order, style, textStyle }: { order: BuyerOrderView; style: StyleProp<ViewStyle>; textStyle: StyleProp<TextStyle> }) {
  const { theme } = useAppTheme();
  const [failed, setFailed] = useState(false);
  const logo = failed ? undefined : order.sellerLogoUri;
  return (
    <View style={[style, { backgroundColor: theme.accentDim, borderColor: theme.accent, overflow: 'hidden' }]}>
      {logo ? (
        <Image source={{ uri: logo }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
      ) : (
        <Text style={[textStyle, { color: theme.accentLight }]}>{order.sellerName.charAt(0).toUpperCase()}</Text>
      )}
    </View>
  );
}

/**
 * Item photo. When the item has none, or it fails to load, the tile shows the
 * seller's brand mark instead of a gray placeholder icon (item 80).
 */
function OrderItemThumb({ item, order, style, fallbackStyle, markStyle, textStyle }: {
  item: BuyerOrderView['lineItems'][number];
  order: BuyerOrderView;
  style: StyleProp<ImageStyle & ViewStyle>;
  fallbackStyle: StyleProp<ViewStyle>;
  markStyle: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
}) {
  const [failed, setFailed] = useState(false);
  if (item.imageUri && !failed) {
    return <Image source={{ uri: item.imageUri }} style={style as StyleProp<ImageStyle>} resizeMode="cover" accessibilityLabel={item.productName} onError={() => setFailed(true)} />;
  }
  return (
    <View style={[style as StyleProp<ViewStyle>, fallbackStyle]} accessibilityLabel={item.productName}>
      <BrandMark order={order} style={markStyle} textStyle={textStyle} />
    </View>
  );
}

const CARD_STEPS = ['Ordered', 'Shipped', 'Delivered'] as const;

/**
 * Three labelled steps for the card (item 81). Uses the order detail
 * tracker's own stage rule (stepIndex) so the card and the detail screen
 * never disagree: placed/confirmed → Ordered, shipped/out for delivery →
 * Shipped, delivered → Delivered. Monochrome like that tracker.
 */
function CardProgress({ order }: { order: BuyerOrderView }) {
  const { theme } = useAppTheme();
  const detailStep = stepIndex(order.status, order.trackingStatus);
  const current = detailStep >= 4 ? 2 : detailStep >= 2 ? 1 : 0;
  return (
    <View style={progressStyles.row} accessibilityLabel={`Order progress: ${CARD_STEPS[current]}`}>
      {CARD_STEPS.map((label, i) => {
        const reached = i <= current;
        return (
          <View key={label} style={progressStyles.step}>
            <View style={progressStyles.track}>
              <View style={[progressStyles.line, { backgroundColor: i === 0 ? 'transparent' : reached ? theme.text : theme.border }]} />
              <View style={[progressStyles.dot, { backgroundColor: reached ? theme.text : 'transparent', borderColor: reached ? theme.text : theme.border }]} />
              <View style={[progressStyles.line, { backgroundColor: i === CARD_STEPS.length - 1 ? 'transparent' : i < current ? theme.text : theme.border }]} />
            </View>
            <Text
              numberOfLines={1}
              style={[progressStyles.label, { color: reached ? theme.text : theme.muted, fontFamily: i === current ? FONT.semibold : FONT.regular }]}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const progressStyles = StyleSheet.create({
  row: { flexDirection: 'row', paddingVertical: SP.xs },
  step: { flex: 1, alignItems: 'center' },
  track: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', height: 10 },
  line: { flex: 1, height: 1.5 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  label: { fontSize: FS.xs, marginTop: SP.xs },
});

// ─── Filter tabs ──────────────────────────────────────────────────────────────

/**
 * X-style filter tabs (item 83): plain labels, the active one bold with a
 * label-wide underline, one hairline under the row. Same spec as the reframe
 * SegmentTabs primitive (44pt row, 15pt labels, 3pt underline, 24pt gap),
 * kept local to this screen. The row scrolls; a short fade at the right
 * edge marks that more tabs follow and goes away once the row is scrolled
 * to its end.
 */
function OrderFilterTabs({ value, onChange, gutter }: { value: BuyerFilterKey; onChange: (key: BuyerFilterKey) => void; gutter: number }) {
  const { theme } = useAppTheme();
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);
  const moreToRight = content > 0 && offset + viewport < content - 2;
  return (
    <View style={[tabStyles.row, { borderBottomColor: theme.border }]} accessibilityRole="tablist">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        scrollEventThrottle={32}
        onLayout={e => setViewport(e.nativeEvent.layout.width)}
        onContentSizeChange={w => setContent(w)}
        onScroll={e => setOffset(e.nativeEvent.contentOffset.x)}
        contentContainerStyle={{ paddingHorizontal: gutter, gap: 24 }}
      >
        {FILTER_CHIPS.map(item => {
          const active = value === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => {
                if (active) return;
                Haptics.selectionAsync();
                onChange(item.key);
              }}
              style={({ pressed }) => pressed && tabStyles.pressed}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
            >
              <View style={tabStyles.labelWrap}>
                <Text
                  numberOfLines={1}
                  style={[tabStyles.label, { color: active ? theme.text : theme.muted, fontFamily: active ? FONT.bold : FONT.medium }]}
                >
                  {item.label}
                </Text>
                {active && <View style={[tabStyles.indicator, { backgroundColor: theme.text }]} />}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {moreToRight && (
        <LinearGradient
          pointerEvents="none"
          colors={[`${theme.background}00`, theme.background]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={tabStyles.fade}
        />
      )}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  row: { height: 44, borderBottomWidth: StyleSheet.hairlineWidth },
  labelWrap: { height: 44, justifyContent: 'center', minWidth: 24 },
  label: { fontSize: 15, lineHeight: 20 },
  indicator: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, borderRadius: 2 },
  pressed: { opacity: 0.6 },
  fade: { position: 'absolute', top: 0, right: 0, bottom: 0, width: 40 },
});

// ─── Order Card ───────────────────────────────────────────────────────────────
// Visual, tracker-forward card: seller + order meta up top, a live compact
// status tracker as the centerpiece, then item preview / total / actions.

const BuyerOrderCard = React.memo(function BuyerOrderCard({ order, onOpen, onTrack, onReorder, reordering }: { order: BuyerOrderView; onOpen: (orderId: string) => void; onTrack: (orderId: string) => void; onReorder?: (orderId: string) => void; reordering?: boolean }) {
  const onPress = () => onOpen(order.id);
  const { theme } = useAppTheme();
  const styles = useMemo(() => cardStyles(theme), [theme]);
  const firstItem = order.lineItems[0];
  const extraCount = order.lineItems.length - 1;
  const orderLabel = orderDisplayNumber(order.orderNumber);
  const isTerminalStatus = order.status === 'cancelled' || order.status === 'refunded' || order.status === 'disputed';
  // Preview orders open their read-only detail, but never prefetch, menu or
  // track through routes that can reach the live API.
  const isPreview = isPreviewOrderId(order.id) || isPreviewCommerceId(order.id);
  const autoRefunded = !!order.delivery?.autoRefund;
  const headline = deliveryHeadline(order);
  // Show the status once: hide the pill when the headline already says it.
  const showBadge = !statusBadgeRepeatsHeadline({ status: order.status, hasHeadline: !!headline, autoRefunded });
  const thumbs = order.lineItems.slice(0, 4);

  // Long-press: the long-press preview menu (Instagram) — the order enlarged
  // over a blurred list with its actions under it; tapping it opens the order.
  const openMenu = () => {
    openContextMenu({
      preview: {
        imageUri: firstItem?.imageUri,
        aspectRatio: 1,
        title: order.sellerName,
        subtitle: [order.orderNumber, headline?.text].filter(Boolean).join(' · '),
      },
      onPreviewPress: onPress,
      items: [
        { key: 'open', label: 'View order', icon: 'package', onPress },
        ...(onReorder ? [{ key: 'reorder', label: 'Buy again', icon: 'rotate-cw' as const, onPress: () => onReorder(order.id) }] : []),
        { key: 'copy', label: 'Copy order number', icon: 'copy', onPress: () => { void copyText(order.orderNumber, 'Order number copied'); } },
      ],
    });
  };

  return (
    // The card's body is the tap target (item 82); Track / Reorder are its
    // siblings, never nested inside it, so web never renders button-in-button.
    <View style={styles.card}>
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      onPressIn={isPreview ? undefined : () => prefetchBuyerOrderOnPressIn(order.id)}
      onLongPress={isPreview ? undefined : openMenu}
      delayLongPress={350}
      accessibilityLabel={`${orderLabel ?? 'Order'} from ${order.sellerName}, ${statusBadgeLabel(order.status).toLowerCase()}`}
      accessibilityHint="Opens order details"
    >
      {/* Top row */}
      <View style={styles.cardTopRow}>
        <BrandMark order={order} style={styles.avatarCircle} textStyle={styles.avatarText} />
        <View style={{ flex: 1 }}>
          <Text style={styles.sellerName}>{order.sellerName}</Text>
          {/* "Order #10234 · Oct 3" — never a raw or synthetic ID (item 79). */}
          <Text style={styles.orderMeta}>{orderLabel ? `${orderLabel} · ` : ''}{fmtDate(order.createdAt)}</Text>
        </View>
        {showBadge && (
          <StatusBadge
            label={autoRefunded ? (order.delivery?.autoRefund?.partial ? 'PARTIAL REFUND' : 'REFUNDED') : statusBadgeLabel(order.status)}
            variant={autoRefunded ? 'neutral' : statusBadgeVariant(order.status)}
            small
          />
        )}
      </View>

      {/* Delivery headline — "Arriving Oct 15" / "Delivered" / "Refunded" */}
      {headline && (
        <Text
          style={[styles.headline, headline.tone === 'muted' && { color: theme.muted }]}
          numberOfLines={1}
        >
          {headline.text}
        </Text>
      )}

      {/* Item thumbnails */}
      {thumbs.length > 0 && (
        <View style={styles.thumbRow}>
          {thumbs.map((item, i) => (
            <OrderItemThumb key={i} item={item} order={order} style={styles.thumb} fallbackStyle={styles.thumbFallback} markStyle={styles.thumbMark} textStyle={styles.avatarText} />
          ))}
          {order.lineItems.length > thumbs.length && (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Text style={styles.moreText}>+{order.lineItems.length - thumbs.length}</Text>
            </View>
          )}
        </View>
      )}

      {/* Items */}
      <View style={{ marginTop: SP.sm }}>
        {firstItem && (
          <Text style={styles.itemText} numberOfLines={1}>
            {firstItem.productName}{firstItem.variant ? ` (${firstItem.variant})` : ''} × {firstItem.quantity}
          </Text>
        )}
        {extraCount > 0 && (
          <Text style={styles.moreText}>+ {extraCount} more item{extraCount > 1 ? 's' : ''}</Text>
        )}
      </View>

      {/* Live status tracker — visual centerpiece of the card. Labelled
          Ordered · Shipped · Delivered (item 81); cancelled / refunded /
          disputed keep the shared timeline's exception pill — except
          cancelled, whose "Order cancelled" banner below already says it
          (the pill was a second "Cancelled" right above it). */}
      {!autoRefunded && order.status !== 'cancelled' && (
        <View style={styles.trackerWrap}>
          {isTerminalStatus
            ? <OrderStatusTimeline status={order.status} compact />
            : <CardProgress order={order} />}
        </View>
      )}

      {/* Price + pre-order row */}
      <View style={styles.statusRow}>
        {order.isPreOrder && (
          <View style={styles.preOrderBadge}>
            <Text style={styles.preOrderText}>PRE-ORDER</Text>
          </View>
        )}
        <Text style={styles.totalText}>{formatMoney(order.payment.totalCents)}</Text>
      </View>

      {order.status === 'cancelled' && !autoRefunded && (
        <View style={styles.cancellationBanner}>
          <Icon name="x-circle" size={ICON.sm} color={theme.error} />
          <View style={styles.cancellationCopy}>
            <Text style={styles.cancellationLabel}>Order cancelled</Text>
            <Text style={styles.cancellationReason} numberOfLines={1}>
              {cancellationReasonLabel(order.cancellationReason)}
            </Text>
          </View>
        </View>
      )}

      {/* Tracking info */}
      {order.trackingStatus && !isTerminalStatus && !order.delivery && (
        <View style={styles.trackingRow}>
          <Icon name="truck" size={ICON.xs} color={theme.secondary} />
          <Text style={styles.trackingText}>
            {trackingLabel(order.trackingStatus)}
            {order.estimatedDelivery ? ` → Est. ${fmtDate(order.estimatedDelivery)}` : ''}
          </Text>
        </View>
      )}

    </TouchableOpacity>

      {/* Actions — the card opens the order (item 82), so only the extra
          actions get buttons, and only when they apply. */}
      {((order.trackingNumber && !isPreview) || (onReorder && canReorderStatus(order.status))) && (
      <View style={styles.actionsRow}>
        {order.trackingNumber && !isPreview && (
          <TouchableOpacity
             style={[styles.actionBtn, styles.actionBtnSecondary, { backgroundColor: theme.secondaryDim, borderColor: theme.secondary }]}
            activeOpacity={0.8}
            hitSlop={ORDER_ACTION_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Track shipment"
            onPress={() => { haptic('select'); onTrack(order.id); }}
          >
            <Icon name="map-pin" size={12} color={theme.secondary} />
            <Text style={[styles.actionBtnText, { color: theme.secondary }]}>Track shipment</Text>
          </TouchableOpacity>
        )}
        {onReorder && canReorderStatus(order.status) && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.reorderBtn, { backgroundColor: theme.accentDim, borderColor: theme.accent, opacity: reordering ? 0.5 : 1 }]}
            activeOpacity={0.8}
            disabled={reordering}
            accessibilityRole="button"
            accessibilityLabel="Reorder"
            onPress={() => onReorder(order.id)}
          >
            <Icon name="repeat" size={12} color={theme.accentLight} />
            <Text style={[styles.actionBtnText, { color: theme.accentLight }]}>{reordering ? 'Adding…' : 'Reorder'}</Text>
          </TouchableOpacity>
        )}
      </View>
      )}
    </View>
  );
});

// ─── Return card (Returns tab) ───────────────────────────────────────────────
// One row per return request from GET /api/returns/buyer; opens the shared
// return status screen (app/return-detail.tsx).

const BuyerReturnCard = React.memo(function BuyerReturnCard({ item, onOpen }: { item: ReturnView; onOpen: (returnId: string) => void }) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => cardStyles(theme), [theme]);
  const firstItem = item.items[0];
  const refund = item.refundAmountCents != null ? formatCents(item.refundAmountCents) : null;
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.82}
      onPress={() => onOpen(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`Return for order ${item.orderNumber}, ${returnStatusLabel(item.status)}`}
    >
      <View style={styles.cardTopRow}>
        <View style={[styles.avatarCircle, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
          <Feather name="rotate-ccw" size={ICON.sm} color={theme.accentLight} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sellerName}>{item.sellerName}</Text>
          <Text style={styles.orderMeta}>{item.orderNumber ? `${item.orderNumber} · ` : ''}{fmtDate(item.createdAt)}</Text>
        </View>
        <StatusBadge label={returnStatusLabel(item.status).toUpperCase()} variant="neutral" small />
      </View>
      <View style={{ marginTop: SP.sm }}>
        <Text style={styles.itemText} numberOfLines={1}>{returnReasonLabel(item.reason)}</Text>
        {firstItem && (
          <Text style={styles.moreText} numberOfLines={1}>
            {firstItem.productName}{firstItem.variantTitle ? ` (${firstItem.variantTitle})` : ''} × {firstItem.quantity}
            {item.items.length > 1 ? ` + ${item.items.length - 1} more` : ''}
          </Text>
        )}
        {item.status === 'denied' && !!item.sellerResponse && (
          <Text style={styles.moreText} numberOfLines={2}>{item.sellerResponse}</Text>
        )}
      </View>
      <View style={styles.statusRow}>
        <Text style={styles.totalText}>{refund ? `Refund ${refund}` : formatCents(item.orderTotalCents)}</Text>
      </View>
    </TouchableOpacity>
  );
});

// ─── Order card skeleton — matches BuyerOrderCard: avatar + seller/date, item
// line, then a status + price row ──────────────────────────────────────────
function BuyerOrderCardSkeleton() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => cardStyles(theme), [theme]);
  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <SkeletonBlock width={40} height={40} radius={RADIUS.pill} />
        <View style={{ flex: 1, gap: SP.xs }}>
          <SkeletonBlock width="55%" height={14} />
          <SkeletonBlock width="35%" height={11} />
        </View>
      </View>
      <View style={{ marginTop: SP.sm }}>
        <SkeletonBlock width="70%" height={13} />
      </View>
      <View style={{ marginTop: SP.md }}>
        <SkeletonBlock width="100%" height={10} />
      </View>
      <View style={styles.statusRow}>
        <SkeletonBlock width={56} height={14} style={{ marginLeft: 'auto' }} />
      </View>
    </View>
  );
}

function BuyerOrdersListSkeleton() {
  return (
    <View style={{ gap: SP.md }}>
      {Array.from({ length: 4 }).map((_, i) => <BuyerOrderCardSkeleton key={i} />)}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BuyerOrdersScreen() {
  const scrollResetRef = useScrollReset<FlashListRef<BuyerOrderView>>(true, false);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const barInset = useBuyerTabBarInset();
  const centeredPadding = useCenteredContentPadding();
  const router = useRouter();
  // A seller's purchases (app/purchases.tsx) are pushed, not a tab: give them Back.
  const shopperRoutes = useShopperRoutes();
  const openOrder = useCallback((orderId: string) => {
    // Synthetic preview orders never reach the live API: the detail screen
    // renders them read-only from the same local preview data.
    if (isPreviewOrderId(orderId) || isPreviewCommerceId(orderId)) {
      router.push(('/buyer-order-detail?id=' + encodeURIComponent(orderId)) as never);
      return;
    }
    router.push(('/buyer-order-detail?id=' + orderId) as never);
  }, [router]);
  // Track Shipment opens the order's tracking screen (carrier, number,
  // status, scan history, carrier link), not the order details page.
  const openTracking = useCallback((orderId: string) => {
    if (isPreviewOrderId(orderId) || isPreviewCommerceId(orderId)) return;
    router.push(('/buyer-order-tracking?id=' + encodeURIComponent(orderId)) as never);
  }, [router]);
  const openReturn = useCallback((returnId: string) => {
    router.push(('/return-detail?returnId=' + encodeURIComponent(returnId)) as never);
  }, [router]);
  const { userId } = useAuth();
  const buyerPreview = isBuyerDevPreview() && !userId;
  const { reorder, busyOrderId, element: reorderElement } = useReorderFlow({ aboveTabBar: true });

  const [orders, setOrders] = useState<BuyerOrderView[]>([]);
  const [ordersOwnerId, setOrdersOwnerId] = useState<string | null | undefined>(userId);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = usePersistedChoice<BuyerFilterKey>('buyer-orders.filter', 'all', FILTER_CHIPS.map((c) => c.key));
  const [query, setQuery] = useState('');
  // Returns tab: the buyer's real return requests (GET /api/returns/buyer).
  const [returns, setReturns] = useState<ReturnView[]>([]);
  const [returnsOwnerId, setReturnsOwnerId] = useState<string | null | undefined>(userId);
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [returnsError, setReturnsError] = useState(false);
  const returnsGenerationRef = useRef(0);
  // Track whether the very first load has completed so re-focuses and
  // polling intervals don't flash the full-screen spinner.
  const hasLoadedRef = useRef(false);
  // Backoff: stop polling after 3 consecutive failures; resume on next focus.
  // A generation counter ensures requests from a previous focus cycle cannot
  // increment the failure count or clear the timer of the current focus cycle.
  const consecutiveFailuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);

  const load = useCallback(async (generation: number) => {
    if (!userId) {
      // The explicit demo cast includes delivery-guarantee states; a fresh
      // buyer preview retains its list-only synthetic commerce orders.
      setOrders(isPreviewDemoMode()
        ? getPreviewDeliveryBuyerOrders().map(mapApiBuyerOrder)
        : buyerPreview ? getPreviewCommerceBuyerOrders() : []);
      setOrdersOwnerId(userId);
      setLoading(false);
      setRefreshing(false);
      setLoadError(false);
      hasLoadedRef.current = true;
      return;
    }
    try {
      const result = await getBuyerOrdersWithStatus(userId);
      if (generationRef.current !== generation) return; // stale focus cycle
      // A failed fetch still returns cached/previous orders (see
      // getBuyerOrdersWithStatus). Never replace real orders with an empty
      // list just because this fetch failed — show an error banner instead.
      setOrders(result.orders);
      // Order tracking Live Activities follow the real orders (iOS builds).
      if (!result.error) syncOrderActivities(result.orders);
      setOrdersOwnerId(userId);
      setLoadError(!!result.error);
      // A buyer's 2nd delivered order is the moment to ask for an App Store
      // rating (once per account, rate limited inside maybeRequestStoreReview).
      if (!result.error && isSecondDeliveryMoment(result.orders)) void maybeRequestStoreReview(userId, 'second_delivery');
      if (!result.error) consecutiveFailuresRef.current = 0;
      else consecutiveFailuresRef.current += 1;
      if (result.error && consecutiveFailuresRef.current >= 3 && timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } catch {
      if (generationRef.current !== generation) return; // stale focus cycle
      // Keep whatever orders were already loaded — an error is never shown
      // as an empty state.
      setOrdersOwnerId(userId);
      setLoadError(true);
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 3 && timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    if (generationRef.current !== generation) return;
    setLoading(false);
    setRefreshing(false);
    hasLoadedRef.current = true;
  }, [buyerPreview, userId]);

  const loadReturns = useCallback(async () => {
    const generation = ++returnsGenerationRef.current;
    if (!userId) {
      // Signed-out preview: no synthetic returns.
      setReturns([]);
      setReturnsOwnerId(userId);
      setReturnsError(false);
      setReturnsLoading(false);
      return;
    }
    setReturnsLoading(true);
    setReturnsError(false);
    try {
      const rows = await getBuyerReturns();
      if (returnsGenerationRef.current !== generation) return;
      setReturns(rows);
      setReturnsOwnerId(userId);
    } catch {
      if (returnsGenerationRef.current !== generation) return;
      // Keep the last loaded rows for this account; never show an error as "no returns".
      setReturnsOwnerId(userId);
      setReturnsError(true);
    } finally {
      if (returnsGenerationRef.current === generation) setReturnsLoading(false);
    }
  }, [userId]);

  React.useEffect(() => {
    returnsGenerationRef.current += 1;
    setReturns([]);
    setReturnsOwnerId(userId);
    setReturnsError(false);
    setReturnsLoading(false);
  }, [userId]);

  // Load when the Returns tab is opened (and again whenever the screen refocuses on it).
  useFocusEffect(useCallback(() => {
    if (filter === 'returns') void loadReturns();
  }, [filter, loadReturns]));

  const retry = useCallback(() => {
    if (refreshing) return;
    haptic('refresh');
    consecutiveFailuresRef.current = 0;
    setRefreshing(true);
    if (orders.length === 0) setLoading(true);
    void load(generationRef.current);
  }, [load, orders.length, refreshing]);

  React.useEffect(() => {
    generationRef.current += 1;
    hasLoadedRef.current = false;
    consecutiveFailuresRef.current = 0;
    setOrders([]);
    setOrdersOwnerId(userId);
    setLoadError(false);
    setRefreshing(false);
    setLoading(true);
  }, [userId]);

  // Refresh immediately on focus, then poll every 30 s while on this screen.
  // Spinner only shows on the very first load; subsequent refreshes are silent.
  // After 3 consecutive failures the interval is cleared to avoid hammering a
  // down/offline server; it resets on the next focus event.
  useFocusEffect(useCallback(() => {
    const generation = ++generationRef.current;
    consecutiveFailuresRef.current = 0;
    if (!hasLoadedRef.current) setLoading(true);
    load(generation);
    timerRef.current = setInterval(() => load(generation), 30_000);
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [load]));

  // Realtime: shipped / delivered / refunded land on the list immediately
  // (api-server lib/orderChangeListener.ts); the 30s poll is the fallback.
  useRealtimeEvents((event) => {
    if (event.type === 'order.updated' && hasLoadedRef.current) load(generationRef.current);
  });

  // Clerk can switch active sessions without unmounting this route. Guard the
  // render synchronously so the previous account's rows disappear before the
  // reset effect or the new account's request has completed.
  const ownsRenderedOrders = ordersOwnerId === userId;
  const visibleOrders = visibleOrdersForBuyer(orders, ordersOwnerId, userId);
  const filtered = searchOrders(applyFilter(visibleOrders, filter), query);
  const searching = query.trim().length > 0;
  const visibleLoading = loading || !ownsRenderedOrders;
  const showingReturns = filter === 'returns';
  const visibleReturns = returnsOwnerId === userId ? returns : [];

  return (
    <BrandthreadScreen noSafeBottom noSafeTop>
      {/* Shared page header — identical large-title size/weight/offset to every other tab-root page */}
      <Header title="My orders" largeTitle showBack={shopperRoutes.isSeller} />

      {/* Filter chips — horizontal scroll, edge-to-edge. The screen's own
          gutter (`centeredPadding`) on the content container is what lets
          the last chip clip naturally at the screen edge as a scroll
          affordance — no gradient overlay on top of the chips themselves
          (a previous `GRAD_DARK_FADE` scrim here went fully opaque at its
          own edge, painting a solid black block over the last chip instead
          of fading it — same antipattern the tab-bar glass zone replaced
          for Activity, see app/activity-center.tsx's history). */}
      {visibleOrders.length > 0 || searching ? (
        <View style={{ paddingHorizontal: centeredPadding, paddingBottom: SP.sm }}>
          <SearchBar value={query} onChange={setQuery} placeholder="Search all orders" />
        </View>
      ) : null}
      {/* Filter tabs — X-style underline tabs with a right-edge fade while
          more tabs are off-screen (item 83). */}
      <OrderFilterTabs value={filter} onChange={setFilter} gutter={centeredPadding} />

      {showingReturns ? (
        (returnsLoading || returnsOwnerId !== userId) && visibleReturns.length === 0 ? (
          <View style={{ paddingHorizontal: centeredPadding, paddingTop: SP.sm }}>
            <BuyerOrdersListSkeleton />
          </View>
        ) : visibleReturns.length === 0 ? (
          returnsError ? (
            <EmptyState
              icon="alert-triangle"
              title="Couldn't load your returns."
              description="Check your connection and try again."
              action={{ label: 'Try again', icon: 'refresh-cw', onPress: () => { void loadReturns(); } }}
              style={{ flex: 1 }}
            />
          ) : (
            <EmptyState
              icon="rotate-ccw"
              title="No returns"
              description="Return requests you start from a delivered order will show up here with their status."
              style={{ flex: 1 }}
            />
          )
        ) : (
          <>
            {returnsError && (
              <View style={screenStyles.loadErrorRow}>
                <RetryRow label="Couldn't refresh — showing your last loaded returns" onRetry={() => { void loadReturns(); }} />
              </View>
            )}
            <FlashList
              data={visibleReturns}
              keyExtractor={r => r.id}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={returnsLoading} onRefresh={() => { void loadReturns(); }} tintColor={theme.accent} />}
              contentContainerStyle={{
                paddingHorizontal: centeredPadding,
                paddingTop: SP.sm,
                paddingBottom: barInset + SP.md,
              }}
              ItemSeparatorComponent={OrderCardGap}
              renderItem={({ item }) => <BuyerReturnCard item={item} onOpen={openReturn} />}
            />
          </>
        )
      ) : visibleLoading ? (
        <View style={{ paddingHorizontal: centeredPadding, paddingTop: SP.sm }}>
          <BuyerOrdersListSkeleton />
        </View>
      ) : (
        <>
          {loadError && orders.length > 0 && (
            <View style={screenStyles.loadErrorRow}>
              <RetryRow label="Couldn't refresh — showing your last saved orders" onRetry={retry} />
            </View>
          )}
          {filtered.length === 0 ? (
            searching && visibleOrders.length > 0 ? (
              <EmptyState
                icon="search"
                title="No matching orders"
                description="Try a product, brand or order number."
                style={{ flex: 1 }}
              />
            ) : loadError ? (
              <EmptyState
                icon="alert-triangle"
                title="Couldn't load your orders"
                description="Check your connection and try again."
                action={{
                  label: 'Try again',
                  icon: 'refresh-cw',
                  onPress: retry,
                }}
                style={{ flex: 1 }}
              />
            ) : (
              <EmptyState
                icon="shopping-bag"
                illustration="tee"
                title="Your first find is still out there"
                description="When something catches your eye, every update from checkout to doorstep will live here."
                action={{
                  label: 'Discover products',
                  icon: 'compass',
                  onPress: () => (shopperRoutes.isSeller ? keepShopping(router, shopperRoutes) : router.navigate('/(buyer)/discover' as never)),
                }}
                style={{ flex: 1 }}
              />
            )
          ) : (
            <FlashList
              ref={scrollResetRef}
              data={filtered}
              keyExtractor={o => o.id}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={retry} tintColor={theme.accent} />}
              contentContainerStyle={{
                paddingHorizontal: centeredPadding,
                paddingTop: SP.sm,
                paddingBottom: barInset + SP.md,
              }}
              extraData={busyOrderId}
              ItemSeparatorComponent={OrderCardGap}
              renderItem={({ item }) => <BuyerOrderCard order={item} onOpen={openOrder} onTrack={openTracking} onReorder={reorder} reordering={busyOrderId === item.id} />}
            />
          )}
        </>
      )}
      {reorderElement}
    </BrandthreadScreen>
  );
}

function OrderCardGap() {
  return <View style={{ height: SP.md }} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

// Order-card action buttons draw 36pt tall (1pt border, which hitSlop is
// measured inside of); pad vertically to 44pt — 8pt margin above, the card's
// 16pt padding below, so nothing else is covered.
const ORDER_ACTION_HIT_SLOP = { top: 5, bottom: 5, left: 0, right: 0 };

function cardStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.card,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: theme.border,
      padding: SP.md,
    },
    cardTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP.sm,
    },
    avatarCircle: {
      width: 40,
      height: 40,
      borderRadius: RADIUS.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontSize: FS.base,
      fontFamily: FONT.bold,
    },
    sellerName: {
      fontSize: FS.base,
      fontFamily: FONT.semibold,
      color: theme.text,
    },
    orderMeta: {
      fontSize: FS.meta,
      fontFamily: FONT.regular,
      color: theme.muted,
      marginTop: 1,
    },
    headline: {
      fontSize: FS.base,
      fontFamily: FONT.bold,
      color: theme.text,
      marginTop: SP.sm,
    },
    thumbRow: {
      flexDirection: 'row',
      gap: SP.sm,
      marginTop: SP.sm,
    },
    thumb: {
      width: 56,
      height: 70,
      borderRadius: RADIUS.sm,
      borderWidth: 1,
      borderColor: theme.border,
      overflow: 'hidden',
    },
    thumbFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.cardElevated,
    },
    // Brand mark centred in a photo-less thumbnail tile.
    thumbMark: {
      width: 32,
      height: 32,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemText: {
      fontSize: FS.sm,
      fontFamily: FONT.medium,
      color: theme.text,
    },
    moreText: {
      fontSize: FS.meta,
      fontFamily: FONT.regular,
      color: theme.muted,
      marginTop: 2,
    },
    trackerWrap: {
      marginTop: SP.md,
      paddingVertical: SP.xs,
      paddingHorizontal: 2,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP.sm,
      flexWrap: 'wrap',
      marginTop: SP.sm,
    },
    cancellationBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP.sm,
      marginTop: SP.sm,
      paddingHorizontal: SP.sm,
      paddingVertical: 7,
      borderRadius: RADIUS.sm,
      borderWidth: 1,
      borderColor: `${theme.error}48`,
      backgroundColor: `${theme.error}1F`,
    },
    cancellationCopy: {
      flex: 1,
      minWidth: 0,
    },
    cancellationLabel: {
      fontSize: FS.xs,
      fontFamily: FONT.bold,
      color: theme.error,
      letterSpacing: 0.2,
    },
    cancellationReason: {
      fontSize: FS.meta,
      fontFamily: FONT.medium,
      color: theme.muted,
    },
    preOrderBadge: {
      backgroundColor: theme.secondaryDim,
      borderRadius: RADIUS.pill,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    preOrderText: {
      fontSize: FS.xs,
      fontFamily: FONT.bold,
      color: theme.secondary,
    },
    totalText: {
      marginLeft: 'auto',
      fontSize: FS.base,
      fontFamily: FONT.bold,
      color: theme.text,
    },
    trackingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP.xs,
      marginTop: SP.xs,
    },
    trackingText: {
      fontSize: FS.meta,
      fontFamily: FONT.medium,
      color: theme.secondary,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: SP.sm,
      marginTop: SP.sm,
      flexWrap: 'wrap',
    },
    actionBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      minHeight: 44,
      borderRadius: RADIUS.sm,
      backgroundColor: theme.cardElevated,
      borderWidth: 1,
      borderColor: theme.border,
      flexDirection: 'row',
      gap: 4,
    },
    // Own line under View / Track so those two keep their existing width.
    reorderBtn: {
      flexBasis: '100%',
      paddingHorizontal: SP.sm,
    },
    actionBtnSecondary: {
      backgroundColor: theme.secondaryDim,
      borderColor: theme.border,
    },
    actionBtnText: {
      fontSize: FS.meta,
      fontFamily: FONT.semibold,
      color: theme.text,
    },
  });
}

const screenStyles = StyleSheet.create({
  loadErrorRow: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
  },
});
