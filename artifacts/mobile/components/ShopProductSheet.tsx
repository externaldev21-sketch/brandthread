/**
 * ShopProductSheet — Compact shoppable-video drawer
 *
 * Hydrates product from the public buyer API, shows image/name/price/seller/trust cues,
 * handles variant selection, quantity, Add to cart (with attribution), and Buy Now.
 * Supports multi-tag switching, sold-out, unavailable, loading, success, and retry states.
 * Preserves video/feed position behind the drawer.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReanimatedAnimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useSheetTransition } from '@/components/ui/BottomSheet';
import { CachedImage } from '@/components/CachedImage';
import { Avatar } from '@/components/ui/Avatar';
import { profileHref } from '@/lib/profileNavigation';
import { ProductReviewsSection, type ReviewsSeed } from '@/components/ProductReviewsSection';
import { formatCents } from '@/lib/money';
import { SizeRecommendationBadge, RecommendedTag, useSizeBadgeModel } from '@/components/SizeRecommendationBadge';
import {
  ON_DARK, OVERLAY,
  FONT, FS, SP, RADIUS, ICON, COMP,
} from '@/lib/theme';
import {
  addToCart,
  createBuyNowSession,
  getCart,
  getBuyerProduct,
} from '@/services/cartService';
import type {
  BuyerProduct,
  BuyerProductOption,
  BuyerProductVariant,
  CheckoutAttribution,
} from '@/services/cartTypes';
import {
  CART_FLIGHT_ITEM_SIZE,
  getCartFlightVector,
  getSuccessfulCartCount,
  flightSourceFromRect,
  measureCartTarget,
  measureWindowRect,
  shouldAnimateCartSuccess,
  type CartFlightPoint,
  type CartFlightSource,
} from '@/lib/cartFlight';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShopTag {
  productId: string;
  productName: string;
  priceCents: number;
  tagId?: string;
  // A plain fallback photo for this tag's own LIST-step row (see
  // ProductListRow), shown only until that tag's real product finishes
  // hydrating (listProducts) — never overrides a real hydrated product's
  // own imageUris once it's loaded.
  imageUri?: string;
}

export interface ShopSheetSelection {
  postId: string;
  postSellerId?: string;
  tags: ShopTag[];
  activeTagIndex: number;
  previewProduct?: BuyerProduct;
  /** The POSTING creator/brand's display name — whoever posted the video,
   *  not necessarily whoever owns every tagged product on it (see the
   *  header's "Shop with {Brand}" — SpotlightItem.creator at the feed.tsx
   *  call site). Header falls back to the old generic "Shop the post" copy
   *  when this isn't available (e.g. a caller outside the feed). */
  postCreatorName?: string;
  postCreatorVerified?: boolean;
}

interface ShopProductSheetProps {
  selection: ShopSheetSelection;
  onClose: () => void;
  onCartUpdated?: (newCount: number) => void;
  cartTargetRef?: RefObject<View | null>;
  reduceMotion: boolean | null;
}

// ─── Preview reviews seed ─────────────────────────────────────────────────────
// Preview catalog products aren't real rows in the reviews table, so they get
// seeded review data — enough to exercise the average/breakdown/top-reviews
// UI without a network call.
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

/**
 * Built at render time from the previewed product's own photo set (rather
 * than a module-level constant) so review photos are real, already-loaded
 * images instead of a made-up asset reference.
 */
function buildPreviewReviewsSeed(productPhotos: string[]): ReviewsSeed {
  const photo = (i: number) => productPhotos.length ? [productPhotos[i % productPhotos.length]] : undefined;
  return {
  avgRating: 4.6,
  totalCount: 128,
  // A realistic distribution (mostly 5/4★, a few lower) rather than an
  // arbitrary handful, so the star breakdown bars and fit meter below read
  // like real aggregate data instead of a token sample.
  reviews: [
    { id: 'preview-review-1', rating: 5, body: 'Runs true to size and the fabric feels even better in person. Fast shipping too.', buyerName: 'Jordan M.', createdAt: daysAgo(3), verifiedBuyer: true, sizeBought: 'M', fitNote: 'True to size', fitScale: 0, helpfulCount: 12, photos: photo(0) },
    { id: 'preview-review-2', rating: 4, body: 'Great fit, sized up one for a roomier look. Would buy again.', buyerName: 'Priya K.', createdAt: daysAgo(9), verifiedBuyer: true, sizeBought: 'S', fitNote: 'Runs small', fitScale: -1, helpfulCount: 6 },
    { id: 'preview-review-3', rating: 5, body: 'Exactly like the video — quality is there.', buyerName: 'Sam R.', createdAt: daysAgo(20), verifiedBuyer: true, sizeBought: 'L', fitNote: 'True to size', fitScale: 0, helpfulCount: 3, photos: productPhotos.length ? [productPhotos[1 % productPhotos.length], productPhotos[2 % productPhotos.length]] : undefined },
    { id: 'preview-review-4', rating: 5, buyerName: 'Alex T.', createdAt: daysAgo(2), verifiedBuyer: true, sizeBought: 'M', fitNote: 'True to size', fitScale: 0 },
    { id: 'preview-review-5', rating: 5, buyerName: 'Morgan L.', createdAt: daysAgo(5), verifiedBuyer: true, sizeBought: 'M', fitNote: 'True to size', fitScale: 0 },
    { id: 'preview-review-6', rating: 4, buyerName: 'Casey B.', createdAt: daysAgo(7), verifiedBuyer: true, sizeBought: 'L', fitNote: 'Runs large', fitScale: 1 },
    { id: 'preview-review-7', rating: 5, buyerName: 'Riley P.', createdAt: daysAgo(11), verifiedBuyer: true, sizeBought: 'S', fitNote: 'True to size', fitScale: 0 },
    { id: 'preview-review-8', rating: 5, buyerName: 'Jamie F.', createdAt: daysAgo(14), verifiedBuyer: true, sizeBought: 'M', fitNote: 'True to size', fitScale: 0 },
    { id: 'preview-review-9', rating: 3, buyerName: 'Drew S.', createdAt: daysAgo(16), verifiedBuyer: true, sizeBought: 'M', fitNote: 'Runs small', fitScale: -1 },
    { id: 'preview-review-10', rating: 5, buyerName: 'Taylor N.', createdAt: daysAgo(18), verifiedBuyer: true, sizeBought: 'L', fitNote: 'True to size', fitScale: 0 },
    { id: 'preview-review-11', rating: 4, buyerName: 'Reese V.', createdAt: daysAgo(22), verifiedBuyer: true, sizeBought: 'M', fitNote: 'True to size', fitScale: 0 },
    { id: 'preview-review-12', rating: 5, buyerName: 'Sage O.', createdAt: daysAgo(25), verifiedBuyer: true, sizeBought: 'S', fitNote: 'Runs small', fitScale: -1 },
    { id: 'preview-review-13', rating: 5, buyerName: 'Quinn H.', createdAt: daysAgo(27), verifiedBuyer: true, sizeBought: 'M', fitNote: 'True to size', fitScale: 0 },
    { id: 'preview-review-14', rating: 2, buyerName: 'Blair G.', createdAt: daysAgo(30), verifiedBuyer: true, sizeBought: 'L', fitNote: 'Runs large', fitScale: 2 },
    { id: 'preview-review-15', rating: 5, buyerName: 'Emerson D.', createdAt: daysAgo(33), verifiedBuyer: true, sizeBought: 'M', fitNote: 'True to size', fitScale: 0 },
    { id: 'preview-review-16', rating: 5, buyerName: 'Avery W.', createdAt: daysAgo(36), verifiedBuyer: true, sizeBought: 'M', fitNote: 'True to size', fitScale: 0 },
    { id: 'preview-review-17', rating: 4, buyerName: 'Rowan K.', createdAt: daysAgo(40), verifiedBuyer: true, sizeBought: 'S', fitNote: 'Runs small', fitScale: -1 },
    { id: 'preview-review-18', rating: 5, buyerName: 'Elliot J.', createdAt: daysAgo(44), verifiedBuyer: true, sizeBought: 'L', fitNote: 'True to size', fitScale: 0 },
    { id: 'preview-review-19', rating: 5, buyerName: 'Hayden R.', createdAt: daysAgo(48), verifiedBuyer: true, sizeBought: 'M', fitNote: 'True to size', fitScale: 0 },
    { id: 'preview-review-20', rating: 4, buyerName: 'Skyler A.', createdAt: daysAgo(52), verifiedBuyer: true, sizeBought: 'M', fitNote: 'True to size', fitScale: 0 },
  ],
  };
}

// ─── Shipping / returns copy (item 7) ──────────────────────────────────────────
// The returns half reuses `product.refundPolicy` — real, per-product copy
// already computed for the buyer product-detail page (adaptApiProduct in
// services/cartService.ts, and the seeded preview catalog in
// lib/previewProducts.ts). The shipping-estimate half has no equivalent
// source anywhere in the app yet (grepped services/cartTypes.ts,
// cartService.ts and buyer-product-detail.tsx — no generic per-product
// shipping-time field exists), so it's a placeholder pending real
// seller-level shipping data — flagged in this PR, not silently presented
// as real.
const SHIPPING_ESTIMATE_COPY = 'Ships in 2-3 days'; // PLACEHOLDER — see comment above
const DEFAULT_RETURNS_COPY = 'Free returns within 14 days';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findVariant(
  product: BuyerProduct,
  selections: Record<string, string>,
): BuyerProductVariant | null {
  const optionIds = product.options.map(o => o.id);
  if (Object.keys(selections).length < optionIds.length) return null;
  return (
    product.variants.find(v =>
      optionIds.every(optId => {
        const valueId = selections[optId];
        return v.optionValues.some(
          ov => ov.optionId === optId && ov.valueId === valueId,
        );
      }),
    ) ?? null
  );
}

function isVariantComboAvailable(
  product: BuyerProduct,
  optionId: string,
  valueId: string,
  otherSelections: Record<string, string>,
): boolean {
  const candidate = { ...otherSelections, [optionId]: valueId };
  const filledOptionIds = Object.keys(candidate);
  return product.variants.some(
    v =>
      v.isAvailable &&
      filledOptionIds.every(oid =>
        v.optionValues.some(
          ov => ov.optionId === oid && ov.valueId === candidate[oid],
        ),
      ),
  );
}

// ─── Option Chip ──────────────────────────────────────────────────────────────

function OptionChip({
  label,
  selected,
  available,
  onPress,
  accentColor,
  recommended,
}: {
  label: string;
  selected: boolean;
  available: boolean;
  onPress: () => void;
  accentColor: string;
  /** Marks (never selects) the size the buyer's saved sizes point at. */
  recommended?: boolean;
}) {
  const { theme } = useAppTheme();
  const chipS = useMemo(() => makeChipStyles(theme), [theme]);
  const chip = (
    <TouchableOpacity
      onPress={onPress}
      disabled={!available}
      activeOpacity={0.75}
      accessibilityRole="radio"
      accessibilityLabel={label + (recommended ? ', recommended for you' : '') + (available ? '' : ', unavailable')}
      accessibilityState={{ selected, disabled: !available }}
      style={[
        chipS.chip,
        recommended && !selected && available && { borderColor: theme.text, borderWidth: 1.5 },
        selected && { borderColor: accentColor, borderWidth: 2, backgroundColor: `${accentColor}1A` },
        !available && chipS.unavail,
      ]}
    >
      <Text
        style={[
          chipS.text,
          selected && { color: accentColor, fontFamily: FONT.bold },
          !available && chipS.textUnavail,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
  if (!recommended) return chip;
  return <View style={{ alignItems: 'center' }}>{chip}<RecommendedTag /></View>;
}

const makeChipStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    height: COMP.minTouchTarget,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.cardElevated,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  text: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  textUnavail: { color: theme.subtle, textDecorationLine: 'line-through' },
  // Dashed = unavailable, per the shop sheet's variant-chip convention
  // (bold solid border = selected).
  unavail: { borderStyle: 'dashed', borderColor: theme.subtle, backgroundColor: 'transparent' },
});

// ─── Quantity control ─────────────────────────────────────────────────────────

function QtyControl({
  qty,
  max,
  onDec,
  onInc,
}: {
  qty: number;
  max: number;
  onDec: () => void;
  onInc: () => void;
}) {
  const { theme } = useAppTheme();
  const qtyS = useMemo(() => makeQtyStyles(theme), [theme]);
  return (
    <View style={qtyS.row}>
      <TouchableOpacity
        onPress={onDec}
        disabled={qty <= 1}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
        accessibilityState={{ disabled: qty <= 1 }}
        style={qtyS.btn}
      >
        <Feather name="minus" size={14} color={qty <= 1 ? theme.subtle : theme.text} />
      </TouchableOpacity>
      <Text style={qtyS.val}>{qty}</Text>
      <TouchableOpacity
        onPress={onInc}
        disabled={qty >= max}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        accessibilityState={{ disabled: qty >= max }}
        style={qtyS.btn}
      >
        <Feather name="plus" size={14} color={qty >= max ? theme.subtle : theme.text} />
      </TouchableOpacity>
    </View>
  );
}

const makeQtyStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.cardElevated,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: theme.border,
  },
  btn: { width: COMP.minTouchTarget, height: COMP.minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  val: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: theme.text,
    minWidth: 28,
    textAlign: 'center',
  },
});

// ─── Main Component ───────────────────────────────────────────────────────────

type SheetPhase =
  | 'loading'
  | 'error'
  | 'ready'
  | 'sold_out'
  | 'unavailable'
  | 'adding'
  | 'buying'
  | 'added';

export function ShopProductSheet({
  selection,
  onClose,
  onCartUpdated,
  cartTargetRef,
  reduceMotion,
}: ShopProductSheetProps) {
  const { theme } = useAppTheme();
  const ss = useMemo(() => makeSheetStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const { push } = useThreadPull();

  // Gallery aspect (photo audit follow-up): always a full-width 3:4
  // portrait frame now, never a capped near-square crop — see
  // ProductImageCarousel below, which shows the whole image
  // (`contentFit="contain"`, letterboxed on `theme.cardElevated` rather
  // than cropped) instead of the old `cover`-fit-into-a-45%-height-cap
  // treatment that could cut off a differently-shaped seller photo. The
  // content area around it is a `flex:1` ScrollView (see below) and the
  // sticky Add to cart/Buy now bar is its own sibling OUTSIDE that
  // ScrollView, so a taller gallery just scrolls under the fold instead of
  // ever pushing the CTA bar off-screen or behind it.
  const [activeTagIdx, setActiveTagIdx] = useState(selection.activeTagIndex);
  const activeTag = selection.tags[activeTagIdx];
  const hasMultipleTags = selection.tags.length > 1;

  // LIST step sheet height (item: half-height-or-taller, drag-to-expand up
  // to 90%): opens at a real 55% of window height — not a bare `maxHeight`
  // (which only caps a content-driven height, so a short 2-row list opened
  // bottom-hugging-short instead of at 55% as intended) — and is draggable
  // up to 90%, TikTok Shop / eBay "Item lineup" style. A dedicated Pan
  // gesture on just the handle (not the whole sheet, which already owns a
  // drag-DOWN-to-close gesture via `panGesture`/`useSheetTransition`) so an
  // upward drag resizes instead of being swallowed by the close gesture's
  // own `Math.max(0, ...)` clamp. DETAIL step is unaffected — it keeps the
  // existing `maxHeight: '85%'` content-driven sizing (`ss.sheet`).
  const listSheetMinHeight = windowHeight * 0.55;
  const listSheetMaxHeight = windowHeight * 0.90;
  const listSheetHeight = useSharedValue(listSheetMinHeight);
  const listSheetDragStart = useSharedValue(0);
  const listResizeGesture = Gesture.Pan()
    .onStart(() => {
      listSheetDragStart.value = listSheetHeight.value;
    })
    .onUpdate((e) => {
      const next = listSheetDragStart.value - e.translationY;
      listSheetHeight.value = Math.min(listSheetMaxHeight, Math.max(listSheetMinHeight, next));
    });
  // `maxHeight: listSheetMaxHeight` overrides `ss.sheet`'s own blanket 85%
  // cap (meant for the DETAIL step) — the LIST step's own max is 90%.
  const listSheetAnimatedStyle = useAnimatedStyle(() => ({
    height: listSheetHeight.value,
    maxHeight: listSheetMaxHeight,
  }));

  // Two-step TikTok-Shop-style flow (rebuild): a post with 2+ tagged
  // products opens on a LIST step (a vertical row per product — no giant
  // photo); tapping a row pushes to that product's DETAIL step, with a
  // working back chevron. A single-product post skips the list entirely
  // and opens straight on DETAIL, with no back target at all.
  const [sheetStep, setSheetStep] = useState<'list' | 'detail'>(hasMultipleTags ? 'list' : 'detail');

  // Summary data for every tagged product's LIST row (thumbnail, price,
  // seller + verified check, real sold count) — hydrated once, in
  // parallel, through the exact same getBuyerProduct()/previewProduct path
  // the DETAIL step already uses, so every row shows a real image instead
  // of a bag-icon placeholder. `undefined` = still loading, `null` = failed.
  const [listProducts, setListProducts] = useState<Record<string, BuyerProduct | null | undefined>>({});
  useEffect(() => {
    if (!hasMultipleTags) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(selection.tags.map(async (tag) => {
        if (selection.previewProduct && tag.productId === selection.previewProduct.id) {
          return [tag.productId, selection.previewProduct] as const;
        }
        try {
          return [tag.productId, await getBuyerProduct(tag.productId)] as const;
        } catch {
          return [tag.productId, null] as const;
        }
      }));
      if (cancelled) return;
      setListProducts(prev => {
        const next = { ...prev };
        for (const [id, p] of entries) next[id] = p;
        return next;
      });
    })();
    return () => { cancelled = true; };
    // Tag list is fixed for the lifetime of one sheet instance — hydrate once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMultipleTags]);

  const [product, setProduct] = useState<BuyerProduct | null>(null);
  const sizeBadgeModel = useSizeBadgeModel(product);
  const [phase, setPhase] = useState<SheetPhase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [variantError, setVariantError] = useState('');
  // The sheet opens scrolled to the top (hero image + name/price + sticky
  // Add to cart/Buy now bar), with the size/color chips and this error
  // further down the scrollable content. Tapping Add to cart before
  // scrolling used to fail with only that inline message, entirely
  // off-screen and invisible — indistinguishable from the tap doing
  // nothing at all. contentScrollRef lets a failed validation scroll the
  // option chips into view; the message itself also now renders in the
  // always-visible sticky bar (see stickyActionsWrap below) so it can never
  // be scrolled out of sight.
  const contentScrollRef = useRef<ScrollView>(null);
  const optionsSectionY = useRef(0);
  const [flyingToCart, setFlyingToCart] = useState(false);
  const [showAddedConfirmation, setShowAddedConfirmation] = useState(false);
  const [cartTarget, setCartTarget] = useState<CartFlightPoint | null>(null);
  // Where the flight lifts off, measured at tap time: the product photo if
  // it's visible in the sheet's scroll area, else the selected product's
  // card thumbnail (multi-product posts), else the default start above the
  // Add to cart bar.
  const [flightSource, setFlightSource] = useState<CartFlightSource | null>(null);
  const productPhotoRef = useRef<View>(null);
  const activeTagImageRef = useRef<View>(null);
  const addedConfirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // cart-fly-to-icon animation only (unrelated to the sheet's own
  // mount/close transform — kept on the legacy Animated API, out of scope
  // for the sheet-close-glitch fix).
  const cartFlyProgress = useRef(new Animated.Value(0)).current;

  // Sheet mount/close transform + backdrop fade — Reanimated (UI-thread),
  // shared with every other sheet in the app via `useSheetTransition`
  // (components/ui/BottomSheet.tsx). `sheetOpen` starts true and flips false
  // on dismiss; `onClose` (passed as the hook's `onClosed`) fires exactly
  // once the close animation has actually finished — never before — so the
  // parent's `setShopSelection(null)` (which unmounts this component) can
  // never race the animation and yank it mid-flight.
  const [sheetOpen, setSheetOpen] = useState(true);
  const {
    modalVisible, sheetStyle, backdropStyle, panGesture, onSheetLayout,
  } = useSheetTransition(
    sheetOpen,
    onClose,
    { reduceMotion: !shouldAnimateCartSuccess(reduceMotion) },
  );

  useEffect(() => () => {
    if (addedConfirmationTimer.current) clearTimeout(addedConfirmationTimer.current);
  }, []);

  // Dismiss: flips `sheetOpen` false, which drives the single Reanimated
  // close timeline above; `onClose` (passed as `useSheetTransition`'s
  // `onClosed`) fires once that finishes — every call site here dismisses
  // via `onClose`, so this just triggers that shared timeline.
  function dismissSheet() {
    setSheetOpen(false);
  }

  function handleClose() {
    dismissSheet();
  }

  /**
   * Navigate away from the sheet (Buy now, View cart, View detail, seller
   * profile, etc). The destination pushes IMMEDIATELY — its own skeleton/
   * content is already mounted and rendering behind the sheet before the
   * sheet even starts moving, so there's zero blank frame. The sheet's
   * existing 220ms slide-down then plays as a reveal over that already-live
   * screen, and `onClose` unmounts the sheet's Modal (backdrop included)
   * once it finishes.
   *
   * Previously this used `dismissSheet(() => router.push(...))`, which
   * navigated only once the slide-down finished AND never called `onClose` —
   * so the sheet's Modal (and its full-screen backdrop) stayed mounted on
   * top of the destination screen indefinitely. That's what produced the
   * reported "sheet stays open on top of Checkout" glitch/flash.
   */
  function navigateAndDismiss(action: () => void) {
    action();
    dismissSheet();
  }

  /**
   * Same idea as navigateAndDismiss, but for a destination that itself
   * slides up and fully covers the screen (Checkout via /thread-checkout,
   * registered with `animation: 'slide_from_bottom'` in app/_layout.tsx).
   * That incoming screen's own cover animation is the ONLY motion the buyer
   * should see, so the sheet is torn down instantly and silently underneath
   * it instead of also playing its own ~220ms slide-down — two competing
   * animations at once was exactly what read as "Checkout appears under a
   * still-open sheet" glitch.
   */
  function navigateAndDismissInstantly(action: () => void) {
    action();
    onClose();
  }

  function showCartSuccess(newCount: number) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onCartUpdated?.(newCount);
    setShowAddedConfirmation(true);
    addedConfirmationTimer.current = setTimeout(() => {
      setShowAddedConfirmation(false);
      addedConfirmationTimer.current = null;
    }, 1200);
  }

  async function flyProductToCart(newCount: number) {
    if (!shouldAnimateCartSuccess(reduceMotion)) {
      showCartSuccess(newCount);
      return;
    }
    const scrollNode = contentScrollRef.current as unknown as { measureInWindow?: View['measureInWindow'] } | null;
    const [target, photoRect, scrollRect, tagRect] = await Promise.all([
      measureCartTarget(
        cartTargetRef?.current?.measureInWindow.bind(cartTargetRef.current),
        safeFallbackTarget,
      ),
      measureWindowRect(productPhotoRef.current?.measureInWindow?.bind(productPhotoRef.current)),
      measureWindowRect(scrollNode?.measureInWindow?.bind(scrollNode)),
      measureWindowRect(activeTagImageRef.current?.measureInWindow?.bind(activeTagImageRef.current)),
    ]);
    const screenClip = { top: 0, bottom: windowHeight };
    const scrollClip = scrollRect ? { top: scrollRect.y, bottom: scrollRect.y + scrollRect.height } : screenClip;
    setCartTarget(target);
    setFlightSource(flightSourceFromRect(photoRect, scrollClip) ?? flightSourceFromRect(tagRect, screenClip));
    setFlyingToCart(true);
    cartFlyProgress.setValue(0);
    requestAnimationFrame(() => {
      Animated.timing(cartFlyProgress, {
        toValue: 1,
        duration: 720,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setFlyingToCart(false);
        showCartSuccess(newCount);
      });
    });
  }

  // Swipe-down to close now lives entirely inside `useSheetTransition`'s
  // `panGesture` (Reanimated + react-native-gesture-handler, UI-thread) —
  // see the `GestureDetector` wrapping the sheet below.

  // Hydrate product when active tag changes
  const loadProduct = useCallback(async (tagIdx: number) => {
    const tag = selection.tags[tagIdx];
    if (!tag?.productId) {
      setPhase('error');
      setErrorMsg('No product linked to this tag.');
      return;
    }
    setPhase('loading');
    setErrorMsg('');
    setSelections({});
    setQty(1);
    setVariantError('');
    if (selection.previewProduct && tag.productId === selection.previewProduct.id) {
      const preview = selection.previewProduct;
      setProduct(preview);
      // Same rule as a real catalog product below: only auto-fill the
      // selection when there's exactly one variant (nothing to actually
      // choose). With more than one, the buyer must pick a size/variant
      // before Add to cart is enabled — preview data must not skip the
      // picker step that real products require.
      if (preview.variants.length === 0) {
        setPhase('sold_out');
        return;
      }
      if (preview.variants.length === 1) {
        const only = preview.variants[0];
        setSelections(Object.fromEntries(only.optionValues.map(ov => [ov.optionId, ov.valueId])));
        setPhase(only.isAvailable ? 'ready' : 'sold_out');
        return;
      }
      const hasAnyStock = preview.variants.some(v => v.isAvailable);
      setPhase(hasAnyStock ? 'ready' : 'sold_out');
      return;
    }
    try {
      const p = await getBuyerProduct(tag.productId);
      if (!p) {
        setPhase('error');
        setErrorMsg('Product not found.');
        return;
      }
      setProduct(p);

      if (!p.isActive) {
        setPhase('unavailable');
        return;
      }

      // Auto-select if no variants or single variant
      if (p.variants.length === 0) {
        setPhase('sold_out');
        return;
      }
      if (p.variants.length === 1) {
        const only = p.variants[0];
        const autoSel = Object.fromEntries(only.optionValues.map(ov => [ov.optionId, ov.valueId]));
        setSelections(autoSel);
        setPhase(only.isAvailable ? 'ready' : 'sold_out');
        return;
      }

      const hasAnyStock = p.variants.some(v => v.isAvailable);
      setPhase(hasAnyStock ? 'ready' : 'sold_out');
    } catch {
      setPhase('error');
      setErrorMsg("Couldn't load this product. Tap to retry.");
    }
  }, [selection.tags]);

  useEffect(() => { loadProduct(activeTagIdx); }, [activeTagIdx, loadProduct]);

  // Variant → price
  const variant = product ? findVariant(product, selections) : null;
  const variantPrice = variant?.priceCents ?? product?.priceCents ?? 0;
  const variantCompare = variant?.compareAtPriceCents ?? product?.compareAtPriceCents;
  const hasDiscount = variantCompare != null && variantCompare > variantPrice;
  const allOptionsSelected =
    !product ||
    product.options.length === 0 ||
    Object.keys(selections).length === product.options.length;
  // Size-specific gate for the CTAs (item 2): only a product that actually
  // HAS a size option is blocked on it — a product with no sizes (e.g.
  // color-only, or no options at all) is never gated here. Reuses the same
  // `BuyerProductOption`/`selections` shape the rest of this file already
  // reads (adaptApiProduct / previewProducts.ts both name the size option
  // exactly "Size"), not a new/invented stock model.
  const sizeOption = product?.options.find(o => o.name.toLowerCase() === 'size') ?? null;
  const sizeSelected = !sizeOption || !!selections[sizeOption.id];
  const nonSizeOptions = product?.options.filter(o => o !== sizeOption) ?? [];
  const inStock = variant
    ? variant.isAvailable && variant.inventoryQuantity > 0
    : product != null && product.variants.every(v => v.inventoryQuantity === 0)
      ? false
      : true;
  const maxQty = variant ? Math.max(1, variant.inventoryQuantity) : 10;

  const attribution: CheckoutAttribution = {
    sourcePostId: selection.postId,
    sourceTagId: activeTag?.tagId ?? activeTag?.productId,
    channel: 'thread',
  };

  /**
   * Quick add-to-cart from the tag list ("Item lineup" row — see the Mobbin
   * reference in ShopSideTab.tsx). Lets a buyer add a SECOND (or third…)
   * tagged product without first navigating away or manually switching +
   * scrolling to find its own Add to cart button.
   *
   * Tapping the row's own Add-to-cart button when that row is already the
   * active tag and its product is hydrated (`phase === 'ready'`) adds it
   * immediately through the exact same `handleAddToCart()` used by the
   * sticky bar — no parallel add-to-cart implementation. Tapping it for a
   * different row switches `activeTagIdx` to hydrate that product first;
   * `pendingQuickAddRef` remembers which product this was for, and the
   * effect below finishes the add once that product's own `phase` settles.
   */
  const pendingQuickAddRef = useRef<string | null>(null);

  function handleQuickAdd(idx: number) {
    Haptics.selectionAsync();
    const tag = selection.tags[idx];
    if (!tag) return;
    if (idx === activeTagIdx) {
      if (phase === 'ready') {
        void handleAddToCart();
      } else if (phase === 'loading') {
        pendingQuickAddRef.current = tag.productId;
      }
      return;
    }
    pendingQuickAddRef.current = tag.productId;
    setActiveTagIdx(idx);
  }

  // Finishes a quick add once the just-switched-to product hydrates: adds
  // it straight away when it needs no variant pick (loadProduct auto-fills
  // `selections` for a 0/1-variant product), otherwise scrolls its option
  // chips into view — the same non-dead-end behavior `rejectMissingVariant`
  // already guarantees for the sticky bar, just reached from this row
  // instead.
  useEffect(() => {
    if (!pendingQuickAddRef.current || activeTag?.productId !== pendingQuickAddRef.current) return;
    if (phase === 'ready') {
      pendingQuickAddRef.current = null;
      if (allOptionsSelected) {
        void handleAddToCart();
      } else {
        // Needs a size pick — push into the DETAIL step (the list step has
        // no chips to scroll to) and scroll its option chips into view.
        setSheetStep('detail');
        requestAnimationFrame(() => {
          contentScrollRef.current?.scrollTo({ y: Math.max(0, optionsSectionY.current - 12), animated: true });
        });
      }
    } else if (phase === 'sold_out' || phase === 'unavailable' || phase === 'error') {
      pendingQuickAddRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, activeTag, allOptionsSelected]);

  // Add to cart
  /**
   * Real root cause of "I tapped Add to cart and nothing happened": the
   * sheet opens scrolled to the top (hero image, name/price, the sticky
   * Add to cart/Buy now bar) — the size/color chips this validation is
   * about sit further down the scrollable content, off-screen until the
   * buyer scrolls. Tapping Add to cart before ever scrolling hit exactly
   * this early return: no exception, no console error, nothing written to
   * storage (there was nothing to write — addToCart() was never called),
   * and the only feedback was a small inline message rendered below the
   * fold, invisible at the scroll position the buyer was actually at. From
   * their side that reads as "the button does nothing." This scrolls the
   * option chips into view and mirrors the message into the always-visible
   * sticky action bar (see stickyActionsWrap) so it can't be missed again.
   */
  function rejectMissingVariant(message: string) {
    setVariantError(message);
    // Also ensures the DETAIL step is showing — a quick-add tapped from the
    // LIST step's own compact cart button can reach this same validation
    // (idx === activeTagIdx, already hydrated, but missing a size), and the
    // chips it needs to scroll to only exist in the DETAIL step.
    setSheetStep('detail');
    requestAnimationFrame(() => {
      contentScrollRef.current?.scrollTo({ y: Math.max(0, optionsSectionY.current - 12), animated: true });
    });
  }

  async function handleAddToCart() {
    if (!product) return;
    if (!allOptionsSelected) {
      rejectMissingVariant('Please select all options before adding to cart.');
      return;
    }
    if (!variant) {
      rejectMissingVariant('Please select a valid combination.');
      return;
    }
    if (!variant.isAvailable) {
      rejectMissingVariant('This combination is out of stock.');
      return;
    }
    setVariantError('');
    setPhase('adding');
    // Root cause fix: this used to short-circuit for selection.previewProduct
    // (the preview-mode "Shop the Post" flow) and only play the fly-to-cart
    // animation without ever calling addToCart() — so the item never touched
    // the AsyncStorage-backed cart the Cart screen actually reads, and the
    // preview cart always looked empty. addToCart() is a local-first,
    // AsyncStorage-backed write (services/cartService.ts) that never depends
    // on the product having a real server-side row, so the preview product
    // built in feed.tsx's buildPreviewShopProduct() goes through the exact
    // same path as a real catalog product — it always lands in the cart, and
    // only best-effort syncs to the API in the background when signed in.
    try {
      const result = await addToCart({ product, variant, quantity: qty, attribution });
      const newCount = getSuccessfulCartCount(result);
      if (newCount == null) {
        setPhase('ready');
        setVariantError(result.message ?? 'Could not add to cart.');
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPhase('added');
      void flyProductToCart(newCount);
    } catch {
      setPhase('ready');
      setVariantError("Couldn't add to bag. Try again.");
    }
  }

  // Buy now
  async function handleBuyNow() {
    if (!product) return;
    if (!allOptionsSelected) {
      rejectMissingVariant('Please select all options.');
      return;
    }
    if (!variant || !variant.isAvailable) {
      rejectMissingVariant('The selected variant is not available.');
      return;
    }
    setVariantError('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setPhase('buying');
    try {
      const cart = await getCart();
      await createBuyNowSession(product, variant, qty, cart);
      // Use the thread-pull push, fired immediately so Checkout's own
      // skeleton is already mounted before the incoming screen's
      // slide_from_bottom cover animation starts — and tear the sheet down
      // instantly (no competing slide-down of its own) since that cover
      // animation is the only motion this transition needs.
      navigateAndDismissInstantly(() => push('/thread-checkout' as never));
    } catch {
      setPhase('ready');
      setVariantError("Couldn't start checkout. Try again.");
    }
  }

  // View full detail
  function handleViewDetail() {
    if (!activeTag?.productId) return;
    navigateAndDismiss(() => {
      push(
        `/thread-product-detail?productId=${encodeURIComponent(activeTag.productId)}&sourcePostId=${encodeURIComponent(selection.postId)}` as never,
      );
    });
  }

  // Tapping a LIST-step row (its image/name/price/seller — not its own
  // compact cart button, a sibling, never nested inside this) pushes to
  // that product's DETAIL step WITHIN the same sheet — TikTok Shop's own
  // list → detail pattern — rather than navigating away to the full page
  // (handleViewDetail, above, is what "View details" inside the DETAIL
  // step itself still uses for that).
  function openDetailStep(idx: number) {
    Haptics.selectionAsync();
    if (idx !== activeTagIdx) setActiveTagIdx(idx);
    setVariantError('');
    setSheetStep('detail');
  }

  // Back from the DETAIL step to the LIST step (multi-product posts only —
  // a single-product post opens straight on DETAIL and never shows a back
  // chevron at all, since there's no list to go back to).
  function handleBackToList() {
    setVariantError('');
    setSheetStep('list');
  }

  function handleViewCart() {
    navigateAndDismiss(() => router.push('/(buyer)/cart' as never));
  }

  const accent = theme.accent;
  const isBusy = phase === 'adding' || phase === 'buying';
  const flySize = flightSource?.size ?? CART_FLIGHT_ITEM_SIZE;
  const flyStartLeft = flightSource ? flightSource.x - flySize / 2 : windowWidth / 2 - CART_FLIGHT_ITEM_SIZE / 2;
  const flyStartTop = flightSource ? flightSource.y - flySize / 2 : windowHeight - Math.min(330, windowHeight * 0.4);
  // The copy starts at the photo's own size and shrinks to the same small
  // end size (0.28 × 48pt) at the cart as before.
  const flySizeRatio = CART_FLIGHT_ITEM_SIZE / flySize;
  const safeFallbackTarget = { x: windowWidth - 54, y: insets.top + 26 };
  const resolvedCartTarget = cartTarget ?? safeFallbackTarget;
  const flightVector = getCartFlightVector(flyStartLeft, flyStartTop, resolvedCartTarget, flySize);
  // Capture phase as string to allow comparison across JSX blocks without narrowing conflicts
  const currentPhase: string = phase;

  // One option's chip row — shared by the size-under-price block and the
  // remaining (non-size) options further down, so there's exactly one chip-
  // rendering implementation instead of two diverging ones.
  function renderOptionChips(option: BuyerProductOption) {
    if (!product) return null;
    return (
      <View style={ss.optionSection}>
        <View style={ss.optionHeader}>
          <Text style={ss.optionLabel}>{option.name}</Text>
          {selections[option.id] && (
            <Text style={[ss.optionSelected, { color: accent }]}>
              {option.values.find(v => v.id === selections[option.id])?.label}
            </Text>
          )}
        </View>
        <View style={ss.chipsRow}>
          {option.values.map(val => {
            const { [option.id]: _ign, ...rest } = selections;
            const available = isVariantComboAvailable(product, option.id, val.id, rest);
            return (
              <OptionChip
                key={val.id}
                label={val.label}
                selected={selections[option.id] === val.id}
                available={available}
                accentColor={accent}
                recommended={option === sizeOption && sizeBadgeModel?.kind === 'recommend' && sizeBadgeModel.size === val.label}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelections(prev => {
                    const updated = { ...prev, [option.id]: val.id };
                    const newVariant = findVariant(product, updated);
                    if (newVariant && qty > newVariant.inventoryQuantity) setQty(1);
                    return updated;
                  });
                  setVariantError('');
                }}
              />
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <Modal transparent animationType="none" visible={modalVisible} onRequestClose={handleClose}>
      {/* Dim backdrop — tap to dismiss. Fades on the exact same Reanimated
          timeline/duration as the sheet's own slide (see useSheetTransition),
          instead of popping instantly. */}
      <ReanimatedAnimated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={ss.backdrop} />
        </TouchableWithoutFeedback>
      </ReanimatedAnimated.View>

      <GestureDetector gesture={panGesture}>
        <ReanimatedAnimated.View
          testID="shop-product-sheet"
          onLayout={onSheetLayout}
          style={[
            ss.sheet,
            sheetStep === 'list' && listSheetAnimatedStyle,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              paddingBottom: insets.bottom + 8,
            },
            sheetStyle,
          ]}
        >
        {/* ─ Handle — draggable up to 90% on the LIST step only (see
            `listResizeGesture` above); a plain static grabber on DETAIL. ─ */}
        {sheetStep === 'list' ? (
          <GestureDetector gesture={listResizeGesture}>
            <View style={ss.handle} hitSlop={{ top: 10, bottom: 10 }} />
          </GestureDetector>
        ) : (
          <View style={ss.handle} />
        )}

        {/* ─ Header — "Shop with {Brand}" (the POSTING creator/brand, not
            necessarily every tagged product's own seller — selection.
            postCreatorName, set at the feed.tsx call site from
            SpotlightItem.creator), with a small avatar + white verified
            check reusing the exact same pattern as `SellerRow` below, and
            a quiet "{N} products" subline (only when there's more than one
            tagged product) in place of the old shouty "Products in this
            post (N)" line. Same header for both LIST and DETAIL steps —
            this is one shared row above both. ─ */}
        <View style={ss.header}>
          <View style={ss.headerLeft}>
            {/* Back to the product LIST — only when there IS a list to go
                back to (2+ tagged products) and we're on the DETAIL step
                reached from it. A single-product post never shows this: it
                opens straight on DETAIL with no back target at all. */}
            {hasMultipleTags && sheetStep === 'detail' && (
              <TouchableOpacity
                onPress={handleBackToList}
                style={ss.backBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Back to products list"
              >
                <Feather name="chevron-left" size={18} color={theme.text} />
              </TouchableOpacity>
            )}
            <View style={ss.headerBrandCol}>
              <View style={ss.headerBrandRow}>
                {!!selection.postCreatorName && (
                  <Avatar name={selection.postCreatorName} size={24} />
                )}
                <Text style={ss.headerBrandName} numberOfLines={1}>
                  {selection.postCreatorName ? `Shop with ${selection.postCreatorName}` : 'Shop the post'}
                </Text>
                {selection.postCreatorVerified && (
                  <Feather name="check-circle" size={13} color={theme.text} style={ss.headerBrandVerified} />
                )}
              </View>
              {hasMultipleTags && (
                <Text style={ss.headerSubline}>{selection.tags.length} products</Text>
              )}
            </View>
          </View>
          <TouchableOpacity
            onPress={handleClose}
            style={ss.closeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Close"
          >
            <Feather name="x" size={17} color={theme.text} />
          </TouchableOpacity>
        </View>

        {/* ─ LIST step — every tagged product as a row (2+ products only);
            step 1 of the TikTok-Shop-style list → detail flow. No giant
            photo here, just a 72pt thumbnail per row. ─ */}
        {hasMultipleTags && sheetStep === 'list' && (
          <>
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={ss.listContent}
            >
              {selection.tags.map((tag, idx) => {
                const isActiveTag = activeTagIdx === idx;
                const rowProduct = listProducts[tag.productId];
                // Busy/added/sold-out for THIS row's own compact cart
                // button — only meaningful while this row is also the
                // active (hydrating/adding) tag.
                const rowAdding = isActiveTag && (
                  phase === 'adding' || (phase === 'loading' && pendingQuickAddRef.current === tag.productId)
                );
                const rowAdded = isActiveTag && phase === 'added';
                const rowSoldOut = isActiveTag && (phase === 'sold_out' || phase === 'unavailable');
                return (
                  <ProductListRow
                    key={tag.productId + idx}
                    tag={tag}
                    product={rowProduct}
                    adding={rowAdding}
                    added={rowAdded}
                    soldOut={rowSoldOut}
                    onPressRow={() => openDetailStep(idx)}
                    onPressCart={() => handleQuickAdd(idx)}
                    imageRef={isActiveTag ? activeTagImageRef : undefined}
                  />
                );
              })}
            </ScrollView>
          </>
        )}

        {/* ─ DETAIL step — content below unchanged from here down, except
            every phase block now also requires sheetStep === 'detail' so
            nothing from step 2 renders underneath the LIST step above. ─ */}
        {sheetStep === 'detail' && phase === 'loading' && (
          <View style={ss.centerBox} accessibilityLiveRegion="polite">
            <ActivityIndicator color={accent} size="large" />
            <Text style={ss.loadingText}>Loading product…</Text>
          </View>
        )}

        {sheetStep === 'detail' && phase === 'error' && (
          <View style={ss.centerBox}>
            <Feather name="alert-circle" size={ICON.lg} color={theme.error} />
            <Text style={ss.errorText}>{errorMsg || 'Could not load product.'}</Text>
            <TouchableOpacity
              onPress={() => loadProduct(activeTagIdx)}
              style={[ss.retryBtn, { borderColor: accent }]}
            >
              <Feather name="refresh-cw" size={14} color={accent} />
              <Text style={[ss.retryText, { color: accent }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {sheetStep === 'detail' && phase === 'sold_out' && product && (
          <ProductHeader
            product={product}
            variantPrice={variantPrice}
            variantCompare={variantCompare}
            hasDiscount={hasDiscount}
            accent={accent}
          />
        )}

        {sheetStep === 'detail' && phase === 'unavailable' && product && (
          <View>
            <ProductHeader
              product={product}
              variantPrice={variantPrice}
              variantCompare={variantCompare}
              hasDiscount={hasDiscount}
              accent={accent}
            />
            <View style={[ss.statusBanner, { backgroundColor: `${theme.error}26` }]}>
              <Feather name="alert-triangle" size={14} color={theme.error} />
              <Text style={[ss.statusText, { color: theme.error }]}>This product is no longer available</Text>
            </View>
          </View>
        )}

        {sheetStep === 'detail' && (phase === 'ready' || phase === 'adding' || phase === 'buying' || phase === 'added') && product && (
          <ScrollView
            // Without an explicit flex the sheet (maxHeight: '85%',
            // overflow: 'hidden') sizes this ScrollView to its full content
            // height instead of bounding it, so on short screens the
            // content — starting with the square product image — gets
            // clipped by the sheet's overflow instead of scrolling, and can
            // visually overlap the sticky Add to Cart/Buy Now bar below.
            // flex: 1 bounds it to the remaining sheet height so it scrolls
            // internally instead.
            ref={contentScrollRef}
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {/* Swipeable image gallery — capped near-square (item 1), never
                more than ~45% of the sheet's own height, so price/size/
                details sit above the fold without scrolling. */}
            {/* Measured at Add-to-cart time: the flight lifts off this photo. */}
            <View ref={productPhotoRef} collapsable={false}>
              <ProductImageCarousel imageUris={product.imageUris} />
            </View>

            {/* Product title/price row — the WHOLE row is the tap target to
                the full product page, with its own explicit "View details"
                affordance (item 4) instead of a bare chevron. No thumbnail:
                the carousel above already shows this exact photo full-size
                directly above it. */}
            <ProductHeader
              product={product}
              variantPrice={variantPrice}
              variantCompare={variantCompare}
              hasDiscount={hasDiscount}
              accent={accent}
              onViewDetail={handleViewDetail}
              showImage={false}
              showSellerLine={false}
            />

            {/* Size chips directly under the price (item 2) — real stock via
                the same BuyerProductVariant/isVariantComboAvailable this
                file already used for every option; sold-out sizes render
                strike-through + dashed border (OptionChip). */}
            {sizeOption && (
              <View onLayout={e => { optionsSectionY.current = e.nativeEvent.layout.y; }}>
                <View style={{ paddingHorizontal: 16 }}>
                  <SizeRecommendationBadge model={sizeBadgeModel} onBeforeNavigate={handleClose} />
                </View>
                {renderOptionChips(sizeOption)}
              </View>
            )}

            {/* One grey info line: shipping estimate + this product's real
                return policy (item 7), positioned under the size chips. */}
            <View style={ss.infoLine}>
              <Feather name="truck" size={12} color={theme.subtle} />
              <Text style={ss.infoLineText} numberOfLines={2}>
                {SHIPPING_ESTIMATE_COPY} · {product.refundPolicy || DEFAULT_RETURNS_COPY}
              </Text>
            </View>

            {/* Seller row — avatar, white/monochrome verified check, name;
                the WHOLE row taps through to the seller's store (item 5). A
                sibling of the title/price row above and the CTA buttons
                below, never nested inside either. */}
            <SellerRow product={product} />

            <View style={ss.descriptionSection}>
              <Text style={ss.descriptionLabel}>Description</Text>
              <Text style={ss.descriptionText}>
                {product.description.trim() || 'Product details are not available.'}
              </Text>
            </View>

            {/* Any remaining (non-size) variant options — e.g. Color. */}
            {nonSizeOptions.length > 0 && (
              <View onLayout={sizeOption ? undefined : e => { optionsSectionY.current = e.nativeEvent.layout.y; }}>
                {nonSizeOptions.map(option => (
                  <React.Fragment key={option.id}>{renderOptionChips(option)}</React.Fragment>
                ))}
              </View>
            )}

            {/* Qty + stock */}
            <View style={ss.qtyRow}>
              <Text style={ss.optionLabel}>Qty</Text>
              <View style={{ flex: 1 }} />
              {variant && variant.inventoryQuantity <= 5 && (
                <Text style={ss.lowStock}>
                  Only {variant.inventoryQuantity} left
                </Text>
              )}
              <QtyControl
                qty={qty}
                max={maxQty}
                onDec={() => setQty(q => Math.max(1, q - 1))}
                onInc={() => setQty(q => Math.min(maxQty, q + 1))}
              />
            </View>

            {/* Variant error — shown once, right here next to the size/
                option chips it's actually about (rejectMissingVariant
                scrolls this into view so it's always on screen when it
                fires). Used to also be mirrored into the sticky action bar
                below, which rendered the exact same message a second time
                whenever the sheet's scroll position already had this one
                in view — see the sticky bar's own comment for why that
                mirror was removed instead of this one. */}
            {!!variantError && (
              <View style={ss.variantError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                <Feather name="alert-circle" size={13} color={theme.error} />
                <Text style={ss.variantErrorText}>{variantError}</Text>
              </View>
            )}

            {/* Trust cues */}
            <View style={ss.trustRow}>
              <TrustCue icon="shield" label="Secure checkout" />
              <TrustCue icon="refresh-cw" label="Easy returns" />
              <TrustCue icon="truck" label="Fast shipping" />
            </View>

            <ProductReviewsSection
              productId={product.id}
              productName={product.name}
              seed={selection.previewProduct?.id === product.id ? buildPreviewReviewsSeed(product.imageUris) : undefined}
            />

            <TouchableOpacity onPress={handleViewDetail} style={ss.viewDetailBtn}>
              <Text style={ss.viewDetailText}>View full product details</Text>
              <Feather name="chevron-right" size={13} color={theme.muted} />
            </TouchableOpacity>

            {/* Spacer so content never sits behind the sticky action bar below */}
            <View style={{ height: 84 }} />
          </ScrollView>
        )}

        {/* Sticky Add to Cart + Buy Now — always reachable, never scrolls away */}
        {sheetStep === 'detail' && (phase === 'ready' || phase === 'adding' || phase === 'buying' || phase === 'added') && product && (
          <View style={[ss.stickyActionsWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            {/* Overnight follow-up: this used to mirror the same
                variantError message a second time here, so it rendered
                twice at once — once next to the size/option chips, once
                again in this always-on-screen sticky bar. rejectMissingVariant
                already scrolls the chips (and the one message next to them)
                into view when it fires, so the mirror was never load-
                bearing once that scroll landed — it only doubled the
                message. Removed; see the single render next to the option
                chips above. */}
            <View style={ss.actions}>
              <TouchableOpacity
                onPress={phase === 'added' ? handleViewCart : handleAddToCart}
                // Disabled outright (not just rejected-on-tap) once the
                // product actually has sizes and none is chosen yet (item
                // 2) — a product with no size option at all is never gated
                // here.
                disabled={isBusy || currentPhase === 'sold_out' || (phase !== 'added' && !sizeSelected)}
                activeOpacity={0.85}
                style={[ss.addBtn, (isBusy || (phase !== 'added' && !sizeSelected)) && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel={phase === 'added' ? 'View cart' : 'Add to cart'}
              >
                {phase === 'adding' ? (
                  <ActivityIndicator color={theme.text} size="small" />
                ) : (
                  <>
                    <Feather name="shopping-cart" size={17} color={theme.text} />
                    <Text style={ss.addBtnText}>{phase === 'added' ? 'View cart' : 'Add to cart'}</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleBuyNow}
                disabled={isBusy || currentPhase === 'sold_out' || !sizeSelected}
                activeOpacity={0.85}
                style={[ss.buyBtn, { backgroundColor: accent }, (isBusy || !sizeSelected) && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="Buy now"
              >
                {phase === 'buying' ? (
                  <ActivityIndicator color={theme.onAccent} size="small" />
                ) : (
                  // Text only (item 6) — the circle-arrow icon is dropped;
                  // Add to cart above keeps its cart icon.
                  <Text style={[ss.buyBtnText, { color: theme.onAccent }]}>Buy now</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {sheetStep === 'detail' && phase === 'sold_out' && product && (
          <View>
            <View style={[ss.statusBanner, { backgroundColor: `${theme.warning}22` }]}>
              <Feather name="clock" size={14} color={theme.warning} />
              <Text style={[ss.statusText, { color: theme.warning }]}>Sold out — check back soon</Text>
            </View>
            <TouchableOpacity onPress={handleViewDetail} style={[ss.addBtn, { marginHorizontal: 16, marginBottom: 8 }]}>
              <Feather name="eye" size={17} color={theme.text} />
              <Text style={ss.addBtnText}>View product</Text>
            </TouchableOpacity>
          </View>
        )}
        </ReanimatedAnimated.View>
      </GestureDetector>

      {flyingToCart && (
        <Animated.View
          testID="cart-fly-item"
          pointerEvents="none"
          style={[
            ss.cartFlyItem,
            {
              left: flyStartLeft,
              top: flyStartTop,
              width: flySize,
              height: flySize,
              borderRadius: 14 / flySizeRatio,
              opacity: cartFlyProgress.interpolate({
                inputRange: [0, 0.82, 1],
                outputRange: [1, 1, 0],
              }),
              transform: [
                {
                  translateX: cartFlyProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, flightVector.x],
                  }),
                },
                {
                  translateY: cartFlyProgress.interpolate({
                    inputRange: [0, 0.55, 1],
                    outputRange: [
                      0,
                      -Math.min(windowHeight * 0.27, Math.max(48, flyStartTop + flySize / 2 - resolvedCartTarget.y) * 0.45),
                      flightVector.y,
                    ],
                  }),
                },
                {
                  scale: cartFlyProgress.interpolate({
                    inputRange: [0, 0.7, 1],
                    outputRange: [1, 0.72 * flySizeRatio, 0.28 * flySizeRatio],
                  }),
                },
                {
                  rotate: cartFlyProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '10deg'],
                  }),
                },
              ],
            },
          ]}
        >
          {product?.imageUris?.[0] ? (
            <Image source={{ uri: product.imageUris[0] }} style={ss.cartFlyImage} />
          ) : (
            <View style={[ss.cartFlyFallback, { backgroundColor: theme.accent }]}>
              <Feather name="shopping-bag" size={21} color={theme.onAccent} />
            </View>
          )}
        </Animated.View>
      )}

      {/* Small, non-blocking toast — sits above the sticky action bar and
          never dims or intercepts touches on the rest of the sheet/feed
          behind it (only the toast row itself is tappable). Tapping "View"
          jumps straight to the cart, same destination as the sticky bar's
          own "View cart" state. */}
      {showAddedConfirmation && (
        <View style={ss.addedToastWrap} pointerEvents="box-none" accessibilityLiveRegion="polite">
          <TouchableOpacity
            style={[ss.addedToast, { backgroundColor: theme.accent }]}
            onPress={() => { setShowAddedConfirmation(false); handleViewCart(); }}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Added to cart. View cart"
          >
            <Feather name="check" size={15} color={theme.onAccent} />
            <Text style={[ss.addedToastText, { color: theme.onAccent }]}>Added to cart</Text>
            <Text style={[ss.addedToastDivider, { color: theme.onAccent }]}>·</Text>
            <Text style={[ss.addedToastView, { color: theme.onAccent }]}>View</Text>
          </TouchableOpacity>
        </View>
      )}
    </Modal>
  );
}

// ─── ProductHeader ─────────────────────────────────────────────────────────────

function ProductHeader({
  product,
  variantPrice,
  variantCompare,
  hasDiscount,
  accent,
  onViewDetail,
  showImage = true,
  showSellerLine = true,
}: {
  product: BuyerProduct;
  variantPrice: number;
  variantCompare?: number;
  hasDiscount: boolean;
  accent: string;
  onViewDetail?: () => void;
  /**
   * Whether to show the small thumbnail. Default true (used standalone, e.g.
   * sold-out/unavailable phases with no image carousel above it). Pass
   * false when this header renders directly under ProductImageCarousel,
   * which already shows the same photo full-size — otherwise a small
   * thumbnail of the identical image sits flush against the big hero image
   * right above it with no visual separation, reading as an overlap.
   */
  showImage?: boolean;
  /**
   * Whether this row also prints the inline "by Seller · @handle" line.
   * Default true (sold-out/unavailable phases, which don't render the
   * dedicated `SellerRow` below). The ready-phase call site passes false
   * since it renders `SellerRow` as its own separate, fully seller-focused
   * tappable row (item 5) instead — avoiding two different seller
   * affordances stacked on top of each other.
   */
  showSellerLine?: boolean;
}) {
  const { theme } = useAppTheme();
  const ss = useMemo(() => makeSheetStyles(theme), [theme]);
  const imageUri = product.imageUris[0];

  return (
    <TouchableOpacity
      style={[ss.productRow, !showImage && ss.productRowNoImage]}
      onPress={onViewDetail}
      activeOpacity={onViewDetail ? 0.8 : 1}
      accessibilityRole={onViewDetail ? 'button' : 'none'}
      accessibilityLabel={onViewDetail ? `View details for ${product.name}` : undefined}
    >
      {showImage && (
        <View style={ss.productImageWrap}>
          {imageUri ? (
            <CachedImage
              source={{ uri: imageUri }}
              style={ss.productImage}
              contentFit="cover"
            />
          ) : (
            <View style={[ss.productImage, ss.productImagePlaceholder]}>
              <Feather name="image" size={22} color={theme.subtle} />
            </View>
          )}
          {product.isPreOrder && (
            <View style={ss.preOrderBadge}>
              <Text style={ss.preOrderText}>PRE</Text>
            </View>
          )}
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={ss.productName} numberOfLines={2}>{product.name}</Text>
        <View style={ss.priceRow}>
          <Text style={[ss.productPrice, { color: accent }]}>
            {formatCents(variantPrice)}
          </Text>
          {hasDiscount && variantCompare != null && (
            <Text style={ss.comparePrice}>{formatCents(variantCompare)}</Text>
          )}
        </View>
        {showSellerLine && (
          <Text style={ss.sellerName} numberOfLines={1}>
            by {product.sellerName}
            {product.sellerHandle ? ` · ${product.sellerHandle}` : ''}
          </Text>
        )}
        {/* Explicit "View details" affordance (item 4) — the whole row
            above is already the tap target, but a bare trailing chevron
            (the old treatment) reads as ambiguous on its own, the same
            "icon alone isn't a clear tap target" issue the SHOP pill's own
            chevron has elsewhere in this feed. */}
        {onViewDetail && (
          <View style={ss.viewDetailInline}>
            <Text style={ss.viewDetailInlineText}>View details</Text>
            <Feather name="chevron-right" size={12} color={theme.muted} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Seller row — avatar, verified check, name; whole row → seller store ────

function SellerRow({ product }: { product: BuyerProduct }) {
  const { theme } = useAppTheme();
  const ss = useMemo(() => makeSheetStyles(theme), [theme]);
  const router = useRouter();

  return (
    <TouchableOpacity
      style={ss.sellerRow}
      onPress={() => router.push(profileHref({ userId: product.sellerId, accountType: 'seller' }) as never)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`View ${product.sellerName}'s shop`}
      testID="shop-sheet-seller-row"
    >
      <Avatar uri={product.sellerAvatarUri} name={product.sellerName} size={32} />
      <View style={ss.sellerRowNameWrap}>
        <Text style={ss.sellerRowName} numberOfLines={1}>{product.sellerName}</Text>
        {/* Monochrome verified check — theme.text (not a colored/blue
            badge), matching the same check-circle treatment PersonRow.tsx
            and BrandRow.tsx already use for a verified name sitting on a
            plain card surface (as opposed to CaptionBlock.tsx's ON_DARK
            white, which is for a badge over a playing video). */}
        {product.sellerVerified && (
          <Feather name="check-circle" size={13} color={theme.text} style={ss.sellerRowVerified} />
        )}
      </View>
      <View style={ss.sellerViewStore}>
        <Text style={ss.sellerViewStoreText}>View store</Text>
        <Feather name="chevron-right" size={14} color={theme.muted} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Product list row — LIST step (2+ tagged products) ──────────────────────
// TikTok Shop's own "Shopping from a video" product-anchor list (Mobbin:
// mobbin.com/screens/8f86927b-bff7-44d1-8f66-7264d31e76d5) and eBay's "Item
// lineup" sheet (mobbin.com/screens/0342aaee-4b93-4156-adf4-267ba35131e1) —
// a vertical list of real product rows, never a big preview image. A plain
// View, not a pressable — its two children (row nav, compact cart button)
// are SIBLING TouchableOpacitys, never nested inside one another (tests/
// buyer-shopping-no-nested-pressables.test.ts guards this file specifically).

function ProductListRow({
  tag, product, adding, added, soldOut, onPressRow, onPressCart, imageRef,
}: {
  tag: ShopTag;
  /** undefined = still hydrating, null = failed to load, else the real product. */
  product: BuyerProduct | null | undefined;
  adding: boolean;
  added: boolean;
  soldOut: boolean;
  onPressRow: () => void;
  onPressCart: () => void;
  imageRef?: RefObject<View | null>;
}) {
  const { theme } = useAppTheme();
  const ss = useMemo(() => makeSheetStyles(theme), [theme]);
  // The real hydrated photo once it's in, else the caller's own fallback
  // (tag.imageUri — e.g. feed.tsx's productTags) so the row shows a real
  // photo immediately instead of a loading skeleton whenever the caller
  // already has one on hand.
  const imageUri = product?.imageUris?.[0] ?? tag.imageUri;
  const loading = product === undefined && !imageUri;

  return (
    <View style={ss.listRow}>
      <TouchableOpacity
        style={ss.listRowBody}
        onPress={onPressRow}
        accessibilityRole="button"
        accessibilityLabel={`View ${tag.productName}, ${formatCents(tag.priceCents)}`}
      >
        <View style={ss.listRowThumbWrap} ref={imageRef} collapsable={false}>
          {loading ? (
            <View style={[ss.listRowThumb, ss.listRowThumbSkeleton]}>
              <ActivityIndicator size="small" color={theme.subtle} />
            </View>
          ) : imageUri ? (
            <CachedImage source={{ uri: imageUri }} style={ss.listRowThumb} contentFit="cover" />
          ) : (
            <View style={[ss.listRowThumb, ss.listRowThumbSkeleton]}>
              <Feather name="image" size={18} color={theme.subtle} />
            </View>
          )}
        </View>
        <View style={ss.listRowInfo}>
          <Text style={ss.listRowName} numberOfLines={2}>{tag.productName}</Text>
          <Text style={ss.listRowPrice}>{formatCents(tag.priceCents)}</Text>
          {product && (
            <View style={ss.listRowSellerRow}>
              <Text style={ss.listRowSellerText} numberOfLines={1}>{product.sellerName}</Text>
              {product.sellerVerified && (
                <Feather name="check-circle" size={11} color={theme.text} />
              )}
            </View>
          )}
          {/* Real sold count (BuyerProduct.claimedUnits — a sum of paid-
              order quantities, computed server-side; see cartService's
              adaptApiProduct) — hidden rather than shown as "0 sold" when
              there's genuinely no sales yet. */}
          {!!product?.claimedUnits && (
            <Text style={ss.listRowSoldText}>{product.claimedUnits} sold</Text>
          )}
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onPressCart}
        disabled={soldOut}
        activeOpacity={0.8}
        style={[ss.listRowCartBtn, added && ss.listRowCartBtnAdded, soldOut && ss.listRowCartBtnDisabled]}
        accessibilityRole="button"
        accessibilityLabel={added ? `${tag.productName} added to cart` : `Add ${tag.productName} to cart`}
      >
        {adding ? (
          <ActivityIndicator size="small" color={theme.text} />
        ) : added ? (
          <Feather name="check" size={16} color={theme.onAccent} />
        ) : (
          <Feather name="shopping-cart" size={16} color={theme.text} />
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── Full-screen image viewer — swipeable, tap/swipe-down to dismiss ────────

function FullScreenImageViewer({
  imageUris, startIndex, onClose,
}: {
  imageUris: string[]; startIndex: number; onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const ss = useMemo(() => makeSheetStyles(theme), [theme]);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [index, setIndex] = useState(startIndex);
  const scrollRef = useRef<ScrollView>(null);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={[ss.fullScreenWrap, { backgroundColor: '#000' }]}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: startIndex * windowWidth, y: 0 }}
          onMomentumScrollEnd={e => {
            const next = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
            setIndex(Math.max(0, Math.min(imageUris.length - 1, next)));
          }}
        >
          {imageUris.map((uri, i) => (
            <TouchableOpacity
              key={`${uri}-${i}`}
              activeOpacity={1}
              onPress={onClose}
              style={{ width: windowWidth, height: windowHeight }}
              accessibilityRole="button"
              accessibilityLabel="Close full-screen photo"
            >
              <CachedImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity
          onPress={onClose}
          style={ss.fullScreenClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Close"
        >
          <Feather name="x" size={20} color={ON_DARK} />
        </TouchableOpacity>
        {imageUris.length > 1 && (
          <View style={ss.fullScreenCounter} pointerEvents="none">
            <Text style={ss.carouselCounterText}>{index + 1}/{imageUris.length}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── Product image carousel — full sheet-width 3:4, swipeable, dot indicator ──
// Photo audit follow-up ("all these screens where you're swiping should be
// 3x4 instead of 9x16, I don't like how it cuts off the image at all."):
// always a fixed 3:4 portrait frame at the sheet's own width — never a
// near-square height cap — and `contentFit="contain"` rather than `cover`,
// so a differently-shaped seller photo is letterboxed on `theme.
// cardElevated` (visible, but never crops/cuts off real photo content)
// instead of being cropped to fill the box. Tap opens the full-screen
// viewer for a closer look. Page dots only — no numeric "1/N" badge (item
// 3); the full-screen viewer (a separate, immersive view) keeps its own.

function ProductImageCarousel({ imageUris }: { imageUris: string[] }) {
  const { theme } = useAppTheme();
  const ss = useMemo(() => makeSheetStyles(theme), [theme]);
  const { width: windowWidth } = useWindowDimensions();
  const pageWidth = Math.min(windowWidth, 520);
  const pageHeight = Math.round(pageWidth * (4 / 3)); // fixed 3:4 portrait, full sheet width
  const [index, setIndex] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  const images = imageUris.length > 0 ? imageUris : [''];

  if (images.length === 1) {
    return (
      <View style={[ss.carouselWrap, { height: pageHeight }]}>
        {images[0] ? (
          <CachedImage source={{ uri: images[0] }} style={StyleSheet.absoluteFill} contentFit="contain" />
        ) : (
          <View style={[StyleSheet.absoluteFill, ss.productImagePlaceholder]}>
            <Feather name="image" size={28} color={theme.subtle} />
          </View>
        )}
      </View>
    );
  }

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.95}
        onPress={() => images[index] && setFullScreen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Product photo ${index + 1} of ${images.length}. Tap to view full screen.`}
      >
        <View style={[ss.carouselWrap, { height: pageHeight }]}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={images.length > 1}
            onMomentumScrollEnd={e => {
              const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
              setIndex(Math.max(0, Math.min(images.length - 1, next)));
            }}
          >
            {images.map((uri, i) => (
              <View key={`${uri}-${i}`} style={{ width: pageWidth, height: pageHeight }}>
                {uri ? (
                  <CachedImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, ss.productImagePlaceholder]}>
                    <Feather name="image" size={28} color={theme.subtle} />
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
          {images.length > 1 && (
            <LinearGradient
              pointerEvents="none"
              colors={['transparent', 'rgba(0,0,0,0.45)']}
              style={ss.carouselBottomGradient}
            />
          )}
          {images.length > 1 && (
            <View style={ss.dotsRow} pointerEvents="none">
              {images.map((_, i) => (
                <View key={i} style={[ss.dot, i === index && ss.dotActive]} />
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>

      {fullScreen && (
        <FullScreenImageViewer
          imageUris={images.filter(Boolean)}
          startIndex={index}
          onClose={() => setFullScreen(false)}
        />
      )}
    </>
  );
}

// ─── Trust cue pill ───────────────────────────────────────────────────────────

function TrustCue({ icon, label }: { icon: string; label: string }) {
  const { theme } = useAppTheme();
  const ss = useMemo(() => makeSheetStyles(theme), [theme]);
  return (
    <View style={ss.trustCue}>
      <Feather name={icon as any} size={11} color={theme.muted} />
      <Text style={ss.trustCueText}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeSheetStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  cartFlyItem: {
    position: 'absolute',
    zIndex: 20,
    width: 48,
    height: 48,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: ON_DARK,
    shadowColor: theme.shadowColor,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  cartFlyImage: { width: '100%', height: '100%' },
  cartFlyFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addedToastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    // 76 clears the sheet's own sticky Add to cart/Buy Now bar (its
    // paddingTop + the 50pt buttons + their bottom margin) so the toast
    // floats just above it instead of overlapping.
    bottom: 76,
    alignItems: 'center',
    zIndex: 25,
  },
  addedToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  addedToastText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  addedToastDivider: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    opacity: 0.5,
  },
  addedToastView: {
    fontFamily: FONT.bold,
    fontSize: FS.sm,
    textDecorationLine: 'underline',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: OVERLAY,
  },
  // A real card surface (not "transparent" over the backdrop) with a visible
  // top border and taller corner radius, so the sheet reads as elevated
  // chrome sitting above the feed — the Shopee / Pinterest "shop the look"
  // reference (https://mobbin.com/screens/dfef528f-d30c-4841-8a38-42f006594b40).
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: theme.border,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  // LIST step (item: two-step list → detail rebuild) — a draggable
  // 55%-90% sheet now (see `listSheetAnimatedStyle`/`listResizeGesture`
  // above), per the TikTok Shop / eBay Item-lineup reference: a compact
  // product picker by default, not a nearly-full-screen surface, but
  // resizable for a longer product list.
  handle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  // flexShrink so the brand name truncates instead of pushing into (or
  // wrapping under) the close button — see headerBrandName's numberOfLines.
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  headerBrandCol: { flexShrink: 1, minWidth: 0, gap: 1 },
  headerBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerBrandName: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: theme.text,
    flexShrink: 1,
  },
  headerBrandVerified: { marginLeft: -2 },
  headerSubline: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.muted,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.cardElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.cardElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // LIST step — vertical rows, one per tagged product (TikTok Shop /
  // eBay "Item lineup" reference — see the ProductListRow module comment).
  // The step's own title line was demoted into the shared header's
  // `headerSubline` ("N products") — see the header JSX above.
  listContent: { paddingTop: 8, paddingBottom: 12 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.borderSubtle,
  },
  // The row's own nav (thumbnail, name, price, seller, sold count) — a
  // TouchableOpacity, but a SIBLING of listRowCartBtn below, not their
  // shared parent (that's the plain View `listRow` is applied to at the
  // call site) — see the no-nested-pressables comment in ProductListRow.
  listRowBody: { flex: 1, flexDirection: 'row', gap: 12 },
  listRowThumbWrap: { width: 72, height: 96, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.cardElevated, flexShrink: 0 },
  listRowThumb: { width: '100%', height: '100%' },
  listRowThumbSkeleton: { alignItems: 'center', justifyContent: 'center' },
  listRowInfo: { flex: 1, gap: 3, justifyContent: 'center' },
  listRowName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, lineHeight: 18 },
  listRowPrice: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text },
  listRowSellerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  listRowSellerText: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  listRowSoldText: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle },
  // Compact, row-scoped cart button — icon-only circle, monochrome outline
  // by default, inverted (solid text-color fill) only for the momentary
  // "Added" confirmation, matching the same allowance the old tag-card
  // button used.
  listRowCartBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.cardElevated,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  listRowCartBtnAdded: { backgroundColor: theme.accent, borderColor: theme.accent },
  listRowCartBtnDisabled: { opacity: 0.5 },

  // Loading / error
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  loadingText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.muted,
  },
  errorText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.error,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  retryText: { fontSize: FS.sm, fontFamily: FONT.semibold },

  // Product header
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
  },
  productRowNoImage: {
    paddingTop: 16,
  },
  productImageWrap: { position: 'relative' },
  productImage: {
    width: 88,
    height: 88 * 4 / 3, // 3:4 — matches how product photos are now saved
    borderRadius: RADIUS.md,
    backgroundColor: theme.cardElevated,
  },
  productImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.cardElevated,
  },
  carouselWrap: { width: '100%', backgroundColor: theme.cardElevated, overflow: 'hidden' },
  // Subtle bottom fade so the page dots stay readable over a bright photo —
  // a plain scrim, never a full-image dim. No numeric "1/N" pill in the
  // sheet's own carousel any more (item 3, dots only); the full-screen
  // viewer below still shows one (`fullScreenCounter`), reusing this same
  // text style.
  carouselBottomGradient: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 72,
  },
  carouselCounterText: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 11 },
  dotsRow: {
    position: 'absolute', left: 0, right: 0, bottom: 12,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: '#FFFFFF', width: 14 },
  fullScreenWrap: { flex: 1 },
  fullScreenClose: {
    position: 'absolute', top: 50, right: 16, width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  fullScreenCounter: {
    position: 'absolute', bottom: 40, alignSelf: 'center',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  preOrderBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  preOrderText: { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK },
  productName: {
    fontSize: 18,
    fontFamily: FONT.semibold,
    color: theme.text,
    lineHeight: 23,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  productPrice: { fontSize: 20, fontFamily: FONT.bold },
  comparePrice: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.subtle,
    textDecorationLine: 'line-through',
  },
  sellerName: { fontSize: 13, fontFamily: FONT.regular, color: theme.muted },
  // "View details" affordance under the title/price row (item 4) — small,
  // explicit text + chevron instead of a bare trailing icon.
  viewDetailInline: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  viewDetailInlineText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },

  // Seller row (item 5) — avatar, name + verified check, whole row taps to
  // the seller's store. Same card-row shape as buyer-product-detail.tsx's
  // own seller card, kept consistent rather than inventing a new layout.
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 8,
  },
  sellerRowNameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  sellerRowName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  sellerRowVerified: { marginTop: 1 },
  sellerViewStore: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sellerViewStoreText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },

  // Grey shipping + returns info line (item 7), directly under the size chips.
  infoLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 14,
  },
  infoLineText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, lineHeight: 16 },

  descriptionSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: theme.borderSubtle,
    gap: 6,
  },
  descriptionLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: theme.text,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  descriptionText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.muted,
    lineHeight: 20,
  },

  // Options
  optionSection: { paddingHorizontal: 16, marginBottom: 14 },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  optionLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  optionSelected: { fontSize: FS.sm, fontFamily: FONT.regular },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // Qty row
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 10,
  },
  lowStock: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: theme.warning,
  },

  // Variant error
  variantError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  variantErrorText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.error,
    flex: 1,
  },
  // Status banner
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 12,
    borderRadius: RADIUS.sm,
  },
  statusText: { fontSize: FS.sm, fontFamily: FONT.medium },

  // Trust cues
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  trustCue: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trustCueText: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle },

  // Action buttons
  stickyActionsWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    backgroundColor: theme.surface,
    borderTopWidth: 1,
    borderTopColor: theme.borderSubtle,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  addBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.cardElevated,
  },
  addBtnText: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: theme.text,
  },
  buyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 52,
    borderRadius: 14,
  },
  buyBtnText: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
  },

  // View detail
  viewDetailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    marginBottom: 4,
  },
  viewDetailText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: theme.muted,
  },
});
