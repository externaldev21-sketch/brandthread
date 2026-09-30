/**
 * SellerStudioRadialMenu — Seller Control Center
 *
 * The sheet opened from the tab bar's Studio button (accessibilityLabel
 * "Open Studio tools"). Despite the file's historical name (kept so the tab
 * bar's import and the native device-interaction contract test don't need to
 * change), this is the seller's condensed "control center": a store header
 * followed by a plain 4-column grid of every seller destination — reskinned
 * from Binance's own Features bottom sheet
 * (https://mobbin.com/screens/b2cccef3-bc9c-4320-b7c0-e495dd4c3627) in this
 * app's black/white/silver palette. Unlike Binance's boxed icons, each grid
 * item here is just a white line icon and a label — no tile or border behind
 * it — per Dev's call. There is no search field and no editable pinned-
 * shortcuts row anymore: every destination is always visible in the grid, so
 * there is nothing to search for or curate.
 *
 * Presented as a fast slide-up/down sheet (Reanimated + react-native-gesture-
 * handler, UI thread only): swipe DOWN anywhere on the sheet dismisses it —
 * the sheet tracks the finger 1:1, rubber-bands if dragged up past its
 * resting position, and either snaps back or slides fully offscreen once
 * released past ~25% of its height or on a fast downward flick. Inner
 * content (the ScrollView) still scrolls normally; the drag only takes over
 * once that content is scrolled to the top, exactly like an iOS page sheet.
 * Tapping the dimmed area above the sheet triggers the identical fast
 * slide-down. There is no separate close (X) button — Dev's own call: once
 * swipe/tap-to-dismiss exist, a dedicated close button is redundant chrome,
 * and it used to float over the "View store" pill. Android back and Escape
 * (web) still close it via the Modal's own onRequestClose.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import { SHEET_EASING, SHEET_OPEN_MS, SHEET_CLOSE_MS } from '@/constants/motion';

import PlanUpsellModal from '@/components/PlanUpsellModal';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { GROWTH_PLAN_ENFORCEMENT_ENABLED } from '@/lib/growthTools';
import { FONT, FS, RADIUS, SP, BREAKPOINT } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { getSetupState, completionPercent } from '@/lib/setupStore';
import { getSellerOrderBadgeCount } from '@/lib/sellerOrderBadge';
import { initFromStorage, subscribe as subscribeOrderBadge } from '@/lib/orderBadgeStore';
import { PressableScale, SheetHandle } from '@/components/BrandthreadUI';
import {
  ALL_ITEMS,
  type ControlCenterItem,
} from '@/lib/sellerControlCenter';

export { ALL_ITEMS, SECTIONS, DEFAULT_PINNED_IDS } from '@/lib/sellerControlCenter';

// ─── Grid ordering ────────────────────────────────────────────────────────────
// Dev's named order for the first 3 rows (the destinations a seller reaches
// for most), then every other previously-reachable route afterward in its
// existing catalog order — so nothing that used to be reachable from this
// menu is dropped, it just falls after the priority row.
const PRIORITY_IDS = [
  'add-product', 'orders', 'go-live', 'post-video',
  'products', 'discounts', 'analytics', 'payouts',
  'content', 'messages', 'boost', 'settings',
];
// 'help' is unlinked from the grid itself (same "kept reachable, just not
// from here" treatment this file already gives 'brand-memory' — see
// lib/sellerControlCenter.ts) and moved to a "?" icon in the header instead,
// next to "View store". Dev's own bug report: with it in the grid, Help &
// Support was the sole item in the final row, leaving a large empty area
// under it — 28 remaining items divides evenly into exactly 7 full rows of
// 4, so removing it (rather than reordering around it) is what actually
// closes that gap instead of just moving it elsewhere.
const GRID_EXCLUDED_IDS = ['help'];
const GRID_ITEMS: ControlCenterItem[] = [
  ...PRIORITY_IDS.map((id) => ALL_ITEMS.find((item) => item.id === id)).filter((i): i is ControlCenterItem => !!i),
  ...ALL_ITEMS.filter((item) => !PRIORITY_IDS.includes(item.id) && !GRID_EXCLUDED_IDS.includes(item.id)),
];
const GRID_COLUMNS = 4;
// Reserves a fixed 2-line-tall box for every grid label — see gridLabel's
// own style comment for why.
const GRID_LABEL_LINE_HEIGHT = 15;

/** Rubber-band resistance for dragging the sheet up past its resting
 *  position — a diminishing-returns curve (never a hard clamp) that
 *  asymptotically approaches -(dim*c) however far past rest the finger
 *  travels. `value` is always <= 0 here (translateY dragged negative). */
function rubberBandUp(value: number, dim = 100, c = 0.55) {
  'worklet';
  const x = -value;
  return -((x * dim * c) / (dim + c * x));
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SellerStudioRadialMenuProps {
  hideTrigger?: boolean;
  openRequestKey?: number;
}

export default function SellerStudioRadialMenu({
  hideTrigger = false,
  openRequestKey = 0,
}: SellerStudioRadialMenuProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isTablet = screenWidth >= BREAKPOINT.tablet;
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme, isTablet), [theme, isTablet]);
  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } = useSubscriptionPlan();
  const api = useApi();

  const { userId, isSignedIn } = useAuth();

  const sheetHeight = Math.min(screenHeight * 0.9, screenHeight - insets.top - 24);

  // Sheet transform + backdrop opacity, both UI-thread shared values —
  // translateY doubles as the "distance below resting position" the sheet
  // sits at, so 0 = fully open and `sheetHeight` = fully offscreen.
  const translateY = useSharedValue(sheetHeight);
  const backdropOpacity = useSharedValue(0);
  // Captured at the start of each drag so onUpdate computes an absolute
  // position from the gesture's cumulative translation, not a running delta.
  const dragStartY = useSharedValue(0);

  const [open, setOpen] = useState(false);
  const [upsellFeature, setUpsellFeature] = useState<string | null>(null);

  const [brandName, setBrandName] = useState<string | null>(null);
  const [setupPercent, setSetupPercent] = useState(0);
  const [orderCount, setOrderCount] = useState(() => getSellerOrderBadgeCount(userId));
  const [unreadMessages, setUnreadMessages] = useState(0);

  // ── Store header data + live badges — refreshed each time the sheet opens ──

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    getSetupState().then((state) => {
      if (cancelled) return;
      setSetupPercent(completionPercent(state));
    });

    api.auth.me().then((profile: any) => {
      if (cancelled) return;
      setBrandName(profile?.brandName ?? profile?.displayName ?? profile?.name ?? null);
    }).catch(() => {});

    api.conversations.list().then((list: any) => {
      if (cancelled) return;
      const total = (list as Array<{ unreadCount?: number; type?: string }>)
        .filter((c) => c.type !== 'buyer_to_buyer')
        .reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
      setUnreadMessages(total);
    }).catch(() => {});

    if (userId) {
      initFromStorage(userId).then(() => {
        if (!cancelled) setOrderCount(getSellerOrderBadgeCount(userId));
      });
    }

    return () => { cancelled = true; };
  }, [open, api, userId]);

  useEffect(() => {
    const unsub = subscribeOrderBadge(() => setOrderCount(getSellerOrderBadgeCount(userId)));
    return unsub;
  }, [userId]);

  useEffect(() => () => {
    cancelAnimation(translateY);
    cancelAnimation(backdropOpacity);
  }, [translateY, backdropOpacity]);

  // ── Open / close ────────────────────────────────────────────────────────────
  // A single fast timeline (never a spring — a spring's overshoot/settle
  // reads as a bounce, not the "swift and fast" slide Dev asked for) shared
  // by every way the sheet opens or closes: the initial expand, choosing an
  // item, tapping the backdrop, and the swipe gesture below. `pendingAfterRef`
  // carries a one-shot callback (e.g. "navigate after the sheet finishes
  // closing") through to `finishClose`, which only ever runs once the close
  // animation has actually completed.

  const pendingAfterRef = useRef<(() => void) | null>(null);

  const finishClose = useCallback(() => {
    setOpen(false);
    const after = pendingAfterRef.current;
    pendingAfterRef.current = null;
    after?.();
  }, []);

  const hapticDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const expand = useCallback(() => {
    setOpen(true);
    translateY.value = sheetHeight;
    backdropOpacity.value = 0;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    translateY.value = withTiming(0, { duration: SHEET_OPEN_MS, easing: SHEET_EASING });
    backdropOpacity.value = withTiming(1, { duration: SHEET_OPEN_MS, easing: SHEET_EASING });
  }, [translateY, backdropOpacity, sheetHeight]);

  useEffect(() => {
    if (openRequestKey > 0 && !open) expand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestKey]);

  const collapse = useCallback((after?: () => void) => {
    pendingAfterRef.current = after ?? null;
    backdropOpacity.value = withTiming(0, { duration: SHEET_CLOSE_MS, easing: SHEET_EASING });
    translateY.value = withTiming(sheetHeight, { duration: SHEET_CLOSE_MS, easing: SHEET_EASING }, (finished) => {
      if (finished) runOnJS(finishClose)();
    });
  }, [backdropOpacity, translateY, sheetHeight, finishClose]);

  // ── Swipe-to-dismiss (anywhere on the sheet) ───────────────────────────────
  // Wraps the ENTIRE sheet (header + search + the ScrollView), not just the
  // handle — react-native-gesture-handler's Pan gesture only takes over from
  // a nested native ScrollView once that ScrollView can't scroll further in
  // the gesture's direction (i.e. already at the top), so inner content
  // keeps scrolling normally and the drag only starts a dismiss once scrolled
  // to the top — the same composition every other sheet in this app
  // (ShopProductSheet, useSheetTransition) already relies on.

  const panGesture = useMemo(() => Gesture.Pan()
    .onStart(() => {
      dragStartY.value = translateY.value;
    })
    .onUpdate((e) => {
      const next = dragStartY.value + e.translationY;
      // Dragging down (next > 0) tracks the finger 1:1. Dragging up past the
      // sheet's resting position (next < 0) rubber-bands instead of hard
      // clamping to 0 — a diminishing-returns curve that asymptotically
      // approaches -55pt no matter how far past rest the finger travels.
      translateY.value = next >= 0 ? next : rubberBandUp(next);
    })
    .onEnd((e) => {
      const shouldClose = e.translationY > sheetHeight * 0.25 || e.velocityY > 800;
      if (!shouldClose) {
        translateY.value = withTiming(0, { duration: SHEET_OPEN_MS, easing: SHEET_EASING });
        return;
      }
      runOnJS(hapticDismiss)();
      // A flick carries its release velocity into the slide so a hard swipe
      // feels instant rather than waiting out the standard close duration —
      // never slower than SHEET_CLOSE_MS, never faster than a floor short
      // enough to still read as a slide rather than a jump-cut.
      const remaining = sheetHeight - translateY.value;
      const velocityMs = e.velocityY > 0 ? (remaining / e.velocityY) * 1000 : SHEET_CLOSE_MS;
      const duration = Math.min(SHEET_CLOSE_MS, Math.max(90, velocityMs));
      backdropOpacity.value = withTiming(0, { duration, easing: SHEET_EASING });
      translateY.value = withTiming(sheetHeight, { duration, easing: SHEET_EASING }, (finished) => {
        if (finished) runOnJS(finishClose)();
      });
    }), [sheetHeight, translateY, dragStartY, backdropOpacity, hapticDismiss, finishClose]);

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  // ── Navigation / gating ────────────────────────────────────────────────────

  const choose = useCallback((action: ControlCenterItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (
      GROWTH_PLAN_ENFORCEMENT_ENABLED &&
      action.growthOnly &&
      (planLoading || !!planError || !hasPlan('growth'))
    ) {
      if (planError) retryPlan();
      collapse(() => setUpsellFeature(action.label));
      return;
    }
    collapse(() => router.push(action.route as never));
  }, [planLoading, planError, hasPlan, retryPlan, collapse, router]);

  // ── Derived data ────────────────────────────────────────────────────────────

  const badgeCountFor = (item: ControlCenterItem): number | undefined => {
    if (item.badgeKey === 'orders') return orderCount > 0 ? orderCount : undefined;
    if (item.badgeKey === 'messages') return unreadMessages > 0 ? unreadMessages : undefined;
    return undefined;
  };

  const isLocked = (item: ControlCenterItem) =>
    GROWTH_PLAN_ENFORCEMENT_ENABLED && !!item.growthOnly && !planLoading && !planError && !hasPlan('growth');

  const storeIsLive = setupPercent >= 100;

  // ── Grid item renderer ──────────────────────────────────────────────────────
  // Plain icon + label, no tile or border behind either — per Dev's reskin of
  // Binance's Features sheet. Press feedback is opacity/scale only
  // (PressableScale), never a background-color change, since there's no
  // background to change.

  const renderGridItem = (item: ControlCenterItem) => {
    const badge = badgeCountFor(item);
    const locked = isLocked(item);
    return (
      <View key={item.id} style={styles.gridCell}>
        <PressableScale
          onPress={() => choose(item)}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          testID={`seller-control-center-item-${item.id}`}
          style={styles.gridItem}
        >
          <View style={styles.gridIconWrap}>
            <Feather name={item.icon as any} size={26} color={theme.text} />
            {badge !== undefined && (
              <View style={styles.gridBadge}>
                <Text style={styles.gridBadgeText}>{badge > 99 ? '99+' : badge}</Text>
              </View>
            )}
            {locked && (
              <View style={styles.gridLock}>
                <Feather name="lock" size={10} color={theme.text} />
              </View>
            )}
          </View>
          <Text style={styles.gridLabel} numberOfLines={2}>{item.shortLabel ?? item.label}</Text>
        </PressableScale>
      </View>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      {!hideTrigger && !open && (
        <Pressable
          testID="seller-studio-menu-open"
          accessibilityRole="button"
          accessibilityLabel="Open Studio tools"
          onPress={expand}
          style={({ pressed }) => [
            styles.toggle,
            { top: headerTopInset + SP.xl, backgroundColor: theme.accent, shadowColor: theme.shadowColor },
            pressed && styles.pressed,
          ]}
        >
          <Feather name="grid" size={22} color={theme.onAccent} />
        </Pressable>
      )}

      <Modal
        visible={open}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => collapse()}
      >
        {/* Backdrop */}
        <Animated.View
          testID="seller-studio-menu-backdrop"
          accessibilityLabel="Studio tools dark backdrop"
          style={[StyleSheet.absoluteFill, styles.backdrop, backdropAnimatedStyle]}
          pointerEvents="none"
        />
        <Pressable
          testID="seller-studio-menu-dismiss"
          accessibilityLabel="Dismiss Studio tools backdrop"
          onPress={() => { hapticDismiss(); collapse(); }}
          style={StyleSheet.absoluteFill}
        />

        {/* Sheet — the whole thing (not just the handle) carries the
            swipe-down-to-dismiss gesture; see panGesture's comment above for
            why this composes correctly with the ScrollView inside it. */}
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[
              styles.sheet,
              {
                height: sheetHeight,
                paddingBottom: Math.max(insets.bottom, 16),
              },
              sheetAnimatedStyle,
            ]}
          >
            <SheetHandle />

            {/* ── Store header ── */}
            <View style={styles.header}>
              <View style={styles.avatar}>
                <Text style={styles.avatarLetter}>{(brandName?.[0] ?? 'S').toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.storeName} numberOfLines={1}>{brandName ?? 'Your store'}</Text>
                <Pressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); collapse(() => router.push('/settings' as never)); }}
                  hitSlop={{ top: 4, bottom: 4, left: 0, right: 4 }}
                >
                  <Text style={[styles.statusPill, storeIsLive ? styles.statusLive : styles.statusSetup]}>
                    {storeIsLive ? 'Store live' : `${setupPercent}% set up`}
                  </Text>
                </Pressable>
              </View>
              {/* Help & Support: unlinked from the feature grid itself (see
                  GRID_EXCLUDED_IDS's own comment — it was the lone item in
                  an otherwise-full final row) and moved here instead, per
                  Dev's own suggestion, as a plain "?" next to View store. */}
              <PressableScale
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); collapse(() => router.push('/help' as never)); }}
                accessibilityRole="button"
                accessibilityLabel="Help & Support"
                testID="seller-control-center-item-help"
                style={styles.helpBtn}
              >
                <Feather name="help-circle" size={20} color={theme.text} />
              </PressableScale>
              <PressableScale
                onPress={() => collapse(() => router.push('/store-preview' as never))}
                accessibilityRole="button"
                accessibilityLabel="View store"
                style={styles.viewStoreBtn}
              >
                <Feather name="external-link" size={13} color={theme.onAccent} />
                <Text style={styles.viewStoreLabel}>View store</Text>
              </PressableScale>
            </View>

            {/* ── Feature grid — 4 columns, plain white line icons with a
                label under each, no tile or border. Everything previously
                reachable from this menu is always visible here; there is no
                search or pin-editing anymore, so nothing to filter. ── */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.grid}>
                {GRID_ITEMS.map((item) => renderGridItem(item))}
              </View>
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      </Modal>

      <PlanUpsellModal
        visible={upsellFeature !== null}
        featureName={upsellFeature ?? ''}
        requiredPlan="growth"
        onClose={() => setUpsellFeature(null)}
        onUpgrade={() => {
          setUpsellFeature(null);
          router.push('/subscription' as never);
        }}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: AppThemePreset, isTablet: boolean) => StyleSheet.create({
  toggle: {
    position: 'absolute',
    right: SP.md,
    zIndex: 1200,
    elevation: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.38,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  },
  toggleInner: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },

  backdrop: { backgroundColor: theme.background },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.card,
    borderTopLeftRadius: RADIUS.xxl,
    borderTopRightRadius: RADIUS.xxl,
    borderTopWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    maxWidth: isTablet ? 620 : undefined,
    alignSelf: isTablet ? 'center' : undefined,
    width: isTablet ? 620 : undefined,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.accentLight },
  storeName: { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text },
  statusPill: {
    marginTop: 2,
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    alignSelf: 'flex-start',
  },
  statusLive: { color: theme.success },
  statusSetup: { color: theme.accentLight },
  helpBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  viewStoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: theme.accent,
  },
  viewStoreLabel: { fontSize: FS.xs, fontFamily: FONT.bold, color: theme.onAccent },

  scrollContent: { paddingHorizontal: SP.sm, paddingBottom: SP.xxl },

  // ── Feature grid — 4 columns, no tile/border behind an item, just an icon
  // and a label. Each cell is a flat 25%-width slot so the grid re-flows
  // correctly at any sheet width (including the centered tablet width).
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { width: '25%', paddingVertical: SP.sm },
  gridItem: { alignItems: 'center', justifyContent: 'flex-start', gap: 6, paddingHorizontal: 4 },
  gridIconWrap: { alignItems: 'center', justifyContent: 'center' },
  // GRID_LABEL_LINE_HEIGHT * 2 reserves a fixed 2-line-tall box for every
  // label regardless of whether its own text is 1 or 2 lines — Dev's own bug
  // report: a 1-line label ("Boost") next to a 2-line one ("Add product")
  // used to leave the icon above it sitting at a different height than its
  // row neighbors, and the row itself a different height than the next row
  // down, like the Binance Features sheet reference this grid is modeled on
  // never has. `wordWrap`/`overflowWrap: 'normal'` (web only — React Native
  // Web's own default Text style hard-codes `wordWrap: 'break-word'` on any
  // multi-line Text, including this one, which is what let "Manufacturer
  // Hub" break mid-word as "Manufacture/r Hub" instead of wrapping only at
  // the space; native ignores this key entirely, so it's always safe to
  // include unconditionally rather than gating it behind Platform.OS).
  gridLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: theme.text,
    textAlign: 'center',
    lineHeight: GRID_LABEL_LINE_HEIGHT,
    height: GRID_LABEL_LINE_HEIGHT * 2,
    // `wordWrap` is the exact key react-native-web's own Text component
    // reads to decide overflow-wrap behavior (see its textOneLine/
    // textMultiLine internal styles) — already part of RN's TextStyle type,
    // just normally left at its default. No effect on native.
    wordWrap: 'normal',
  },
  gridBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridBadgeText: { fontSize: 9, fontFamily: FONT.bold, color: theme.onAccent },
  gridLock: {
    position: 'absolute',
    bottom: -4,
    right: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
