/**
 * SellerStudioRadialMenu — Seller Control Center
 *
 * The sheet opened from the tab bar's Studio button (accessibilityLabel
 * "Open Studio tools"). Despite the file's historical name (kept so the tab
 * bar's import and the native device-interaction contract test don't need to
 * change), this is the seller's condensed "control center": a store header,
 * instant search, an editable row of pinned shortcuts, and compact grouped
 * sections covering every seller destination.
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
import { SearchBar, PressableScale, SheetHandle } from '@/components/BrandthreadUI';
import { SheetRise } from '@/components/motion/SheetRise';
import {
  ALL_ITEMS,
  DEFAULT_PINNED_IDS,
  MAX_PINNED,
  SECTIONS,
  findItem,
  loadPinnedIds,
  movePinned,
  pinItem,
  savePinnedIds,
  searchItems,
  unpinItem,
  type ControlCenterItem,
} from '@/lib/sellerControlCenter';

export { ALL_ITEMS, SECTIONS, DEFAULT_PINNED_IDS } from '@/lib/sellerControlCenter';

// ─── Layout constants ─────────────────────────────────────────────────────────

// Sized so the default 4 pinned tiles fit fully inside a 390pt-wide phone
// screen (minus the sheet's SP.md side padding) without the last tile being
// clipped at the edge — the row still scrolls horizontally for up to
// MAX_PINNED tiles, but the common 4-tile case needs no scrolling at all.
const PIN_TILE_SIZE = 78;
const PIN_TILE_GAP = 8;

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

  const [pinnedIds, setPinnedIds] = useState<string[]>(DEFAULT_PINNED_IDS);
  const loadedForUserIdRef = useRef<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [query, setQuery] = useState('');

  const [brandName, setBrandName] = useState<string | null>(null);
  const [setupPercent, setSetupPercent] = useState(0);
  const [orderCount, setOrderCount] = useState(() => getSellerOrderBadgeCount(userId));
  const [unreadMessages, setUnreadMessages] = useState(0);

  // ── Load pinned shortcuts on account change ───────────────────────────────

  useEffect(() => {
    if (!isSignedIn || !userId) {
      if (loadedForUserIdRef.current !== null) {
        loadedForUserIdRef.current = null;
        setPinnedIds(DEFAULT_PINNED_IDS);
      }
      return;
    }
    if (loadedForUserIdRef.current === userId) return;

    setPinnedIds(DEFAULT_PINNED_IDS);
    loadedForUserIdRef.current = userId;

    loadPinnedIds(userId).then((ids) => {
      if (loadedForUserIdRef.current !== userId) return;
      setPinnedIds(ids);
    });
  }, [isSignedIn, userId]);

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
    setEditMode(false);
    setQuery('');
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

  // ── Pin editing ─────────────────────────────────────────────────────────────

  const persistPins = useCallback(async (next: string[]) => {
    setPinnedIds(next);
    if (!userId || !isSignedIn) return;
    setSaveFailed(false);
    const ok = await savePinnedIds(userId, next);
    if (!ok) setSaveFailed(true);
  }, [userId, isSignedIn]);

  const enterEditMode = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setEditMode(true);
  }, []);

  const handleUnpin = useCallback((id: string) => {
    Haptics.selectionAsync().catch(() => {});
    void persistPins(unpinItem(pinnedIds, id));
  }, [pinnedIds, persistPins]);

  const handleMove = useCallback((index: number, direction: 'left' | 'right') => {
    Haptics.selectionAsync().catch(() => {});
    void persistPins(movePinned(pinnedIds, index, direction));
  }, [pinnedIds, persistPins]);

  const handlePin = useCallback((id: string) => {
    Haptics.selectionAsync().catch(() => {});
    void persistPins(pinItem(pinnedIds, id));
    setAddPickerOpen(false);
  }, [pinnedIds, persistPins]);

  // ── Derived data ────────────────────────────────────────────────────────────

  const pinnedItems = pinnedIds.map(findItem).filter((i): i is ControlCenterItem => !!i);
  const results = searchItems(query);
  const isSearching = query.trim().length > 0;
  const pinnableItems = ALL_ITEMS.filter((item) => !pinnedIds.includes(item.id));

  const badgeCountFor = (item: ControlCenterItem): number | undefined => {
    if (item.badgeKey === 'orders') return orderCount > 0 ? orderCount : undefined;
    if (item.badgeKey === 'messages') return unreadMessages > 0 ? unreadMessages : undefined;
    return undefined;
  };

  const isLocked = (item: ControlCenterItem) =>
    GROWTH_PLAN_ENFORCEMENT_ENABLED && !!item.growthOnly && !planLoading && !planError && !hasPlan('growth');

  const storeIsLive = setupPercent >= 100;

  // ── Row / tile renderers ────────────────────────────────────────────────────

  const renderPinTile = (item: ControlCenterItem, index: number) => {
    const badge = badgeCountFor(item);
    return (
      <View key={item.id} style={{ width: PIN_TILE_SIZE }}>
        <PressableScale
          onPress={() => (editMode ? undefined : choose(item))}
          onLongPress={enterEditMode}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          testID={`seller-control-center-pin-${item.id}`}
          style={[styles.pinTile, { width: PIN_TILE_SIZE, height: PIN_TILE_SIZE }]}
        >
          <Feather name={item.icon as any} size={26} color={theme.accentLight} />
          <Text style={styles.pinLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
            {item.label}
          </Text>
          {badge !== undefined && (
            <View style={styles.pinBadge}>
              <Text style={styles.pinBadgeText}>{badge > 99 ? '99+' : badge}</Text>
            </View>
          )}
        </PressableScale>

        {editMode && (
          <>
            <Pressable
              testID={`seller-control-center-unpin-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Unpin ${item.label}`}
              onPress={() => handleUnpin(item.id)}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              style={styles.removeBadge}
            >
              <Feather name="x" size={12} color={theme.text} />
            </Pressable>
            <View style={styles.reorderRow}>
              <Pressable
                disabled={index === 0}
                accessibilityRole="button"
                accessibilityLabel={`Move ${item.label} left`}
                onPress={() => handleMove(index, 'left')}
                hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                style={[styles.reorderBtn, index === 0 && styles.reorderBtnDisabled]}
              >
                <Feather name="chevron-left" size={13} color={theme.text} />
              </Pressable>
              <Pressable
                disabled={index === pinnedItems.length - 1}
                accessibilityRole="button"
                accessibilityLabel={`Move ${item.label} right`}
                onPress={() => handleMove(index, 'right')}
                hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                style={[styles.reorderBtn, index === pinnedItems.length - 1 && styles.reorderBtnDisabled]}
              >
                <Feather name="chevron-right" size={13} color={theme.text} />
              </Pressable>
            </View>
          </>
        )}
      </View>
    );
  };

  const renderItemRow = (item: ControlCenterItem, opts?: { showSection?: string; isLast?: boolean }) => {
    const badge = badgeCountFor(item);
    const locked = isLocked(item);
    return (
      <PressableScale
        key={item.id}
        onPress={() => choose(item)}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        testID={`seller-control-center-item-${item.id}`}
        style={[styles.row, !opts?.isLast && styles.rowDivider]}
      >
        <View style={styles.rowIcon}>
          <Feather name={item.icon as any} size={19} color={theme.accentLight} />
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowLabelLine}>
            <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
            {locked && <Feather name="lock" size={11} color={theme.subtle} style={{ marginLeft: 6 }} />}
          </View>
          {opts?.showSection ? (
            <Text style={styles.rowDesc} numberOfLines={1}>{opts.showSection}</Text>
          ) : item.description ? (
            <Text style={styles.rowDesc} numberOfLines={1}>{item.description}</Text>
          ) : null}
        </View>
        {badge !== undefined && (
          <View style={styles.rowBadge}>
            <Text style={styles.rowBadgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        )}
        <Feather name="chevron-right" size={16} color={theme.muted} />
      </PressableScale>
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

            {/* ── Search ── */}
            <View style={styles.searchWrap}>
              <SearchBar value={query} onChange={setQuery} placeholder="Search tools and settings…" />
            </View>

            <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {isSearching ? (
              <View>
                <Text style={styles.sectionHeading}>
                  {results.length > 0 ? `${results.length} result${results.length === 1 ? '' : 's'}` : 'No matches'}
                </Text>
                {results.length > 0 && (
                  <View style={styles.sectionCard}>
                    {results.map((item, i) => {
                      const section = SECTIONS.find((s) => s.items.some((i2) => i2.id === item.id));
                      return renderItemRow(item, { showSection: section?.title, isLast: i === results.length - 1 });
                    })}
                  </View>
                )}
              </View>
            ) : (
              <>
                {/* ── Pinned panel — its own elevated card so the quick-action
                    tiles read as a distinct "shortcuts" surface instead of
                    floating loose on the same plane as the list below. ── */}
                <View style={styles.pinnedPanel}>
                  <View style={styles.pinnedHeaderRow}>
                    <Text style={styles.pinnedHeading}>Pinned shortcuts</Text>
                    <Pressable
                      testID="seller-control-center-edit-pins"
                      accessibilityRole="button"
                      accessibilityLabel={editMode ? 'Done editing pinned shortcuts' : 'Edit pinned shortcuts'}
                      onPress={() => setEditMode((v) => !v)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.editLink}>{editMode ? 'Done' : 'Edit'}</Text>
                    </Pressable>
                  </View>

                  {saveFailed && (
                    <Text style={styles.saveFailedNote}>Couldn't save — check your connection</Text>
                  )}

                  <ScrollView
                    horizontal
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.pinnedRow}
                    testID="seller-control-center-pinned-row"
                  >
                    {pinnedItems.map((item, i) => renderPinTile(item, i))}

                    {editMode && pinnedItems.length < MAX_PINNED && (
                      <Pressable
                        testID="seller-control-center-add-pin"
                        accessibilityRole="button"
                        accessibilityLabel="Add a pinned shortcut"
                        onPress={() => setAddPickerOpen(true)}
                        style={[styles.pinTile, styles.pinTileAdd, { width: PIN_TILE_SIZE, height: PIN_TILE_SIZE }]}
                      >
                        <Feather name="plus" size={22} color={theme.muted} />
                      </Pressable>
                    )}
                  </ScrollView>
                </View>

                <View style={styles.sectionSpacer} />

                {/* ── Grouped sections ──
                    Rendered as one grouped card per section (hairline
                    dividers between rows, no per-row border) instead of a
                    stack of identical bordered boxes — the previous layout
                    read as one long repeating list with no hierarchy.
                    An item already shown as a Pinned tile above is left out
                    of its section's list here — otherwise "Add product" /
                    "Orders" / etc. render twice on the same screen, once
                    pinned and once in the list below. */}
                {SECTIONS.map((section) => {
                  const listItems = section.items.filter((item) => !pinnedIds.includes(item.id));
                  if (listItems.length === 0) return null;
                  return (
                    <View key={section.key} style={styles.section}>
                      <View style={styles.sectionTitleRow}>
                        <Feather name={section.icon as any} size={12} color={theme.subtle} />
                        <Text style={styles.sectionHeading}>{section.title.toUpperCase()}</Text>
                      </View>
                      <View style={styles.sectionCard}>
                        {listItems.map((item, i) => renderItemRow(item, { isLast: i === listItems.length - 1 }))}
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </ScrollView>
          </Animated.View>
        </GestureDetector>
      </Modal>

      {/* ── Add-a-pin picker ── */}
      <Modal
        visible={addPickerOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setAddPickerOpen(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setAddPickerOpen(false)} testID="pin-picker-backdrop" />
        <SheetRise style={[styles.pickerSheet, { paddingBottom: Math.max(insets.bottom + 8, 24) }]} testID="pin-picker-sheet">
          <View style={styles.pickerHandle} />
          <Text style={styles.pickerHeading}>Add a pinned shortcut</Text>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.pickerList}>
            {pinnableItems.map((dest) => (
              <Pressable
                key={dest.id}
                testID={`pin-picker-option-${dest.id}`}
                accessibilityRole="button"
                accessibilityLabel={dest.label}
                onPress={() => handlePin(dest.id)}
                style={({ pressed }) => [styles.pickerRow, pressed && styles.pickerRowPressed]}
              >
                <View style={styles.pickerIcon}>
                  <Feather name={dest.icon as any} size={18} color={theme.accentLight} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.pickerLabel}>{dest.label}</Text>
                  {dest.description ? <Text style={styles.pickerDesc} numberOfLines={1}>{dest.description}</Text> : null}
                </View>
              </Pressable>
            ))}
            {pinnableItems.length === 0 && (
              <Text style={styles.pickerDesc}>Everything is already pinned.</Text>
            )}
          </ScrollView>
        </SheetRise>
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

  searchWrap: { paddingHorizontal: SP.md, paddingBottom: SP.sm },

  scrollContent: { paddingHorizontal: SP.md, paddingBottom: SP.xxl, gap: SP.sm },

  // Elevated panel that frames the pinned row as its own "quick actions"
  // surface, distinct from the plain list sections below it.
  pinnedPanel: {
    backgroundColor: theme.cardElevated,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: SP.md,
  },
  pinnedHeading: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.sm, letterSpacing: -0.1 },

  pinnedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SP.sm,
  },
  editLink: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.accentLight },

  saveFailedNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginBottom: SP.xs },

  // paddingRight gives the last tile (e.g. Payouts) full clearance from the
  // sheet edge instead of sitting flush against it once scrolled all the way.
  pinnedRow: { gap: PIN_TILE_GAP, paddingRight: SP.lg },

  pinTile: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: theme.border,
    // Sits on the pinnedPanel's cardElevated surface, so the tile itself
    // uses the base card color to stay visually distinct rather than
    // blending into its own container.
    backgroundColor: theme.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },
  pinTileAdd: { borderStyle: 'dashed' },
  pinLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.text, textAlign: 'center' },
  pinBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBadgeText: { fontSize: 10, fontFamily: FONT.bold, color: theme.onAccent },

  removeBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.error,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  reorderRow: {
    position: 'absolute',
    bottom: -14,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  reorderBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.cardElevated,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reorderBtnDisabled: { opacity: 0.35 },

  sectionSpacer: { height: SP.sm },

  section: { marginBottom: SP.lg },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SP.sm, paddingHorizontal: 2 },
  sectionHeading: {
    color: theme.subtle,
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    letterSpacing: 1,
  },

  // One grouped card per section — hairline dividers between rows instead of
  // a stack of individually-bordered boxes, so sections read as cohesive
  // groups rather than a long repeating list that all looks the same.
  sectionCard: {
    backgroundColor: theme.card,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingVertical: 12,
    paddingHorizontal: SP.sm,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  // Black fill + thin silver outline — same treatment as the add-pin
  // picker's own icon tile (pickerIcon, below) — never a translucent-accent
  // "grey square" fill, which in the monochrome (black/white/silver) theme
  // rendered as a washed-out grey tile instead of matching the rest of the
  // app's black/silver surfaces.
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowLabelLine: { flexDirection: 'row', alignItems: 'center' },
  rowLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  rowDesc: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 1 },
  rowBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBadgeText: { fontSize: 11, fontFamily: FONT.bold, color: theme.onAccent },

  // ── Add-pin picker sheet ──
  pickerBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: theme.background, opacity: 0.72 },
  pickerSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.card,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1,
    borderColor: theme.border,
    paddingTop: SP.sm,
    maxHeight: '80%',
  },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: 'center', marginBottom: SP.md },
  pickerHeading: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.base, textAlign: 'center', marginBottom: SP.sm, paddingHorizontal: SP.md },
  pickerList: { paddingHorizontal: SP.md, paddingBottom: SP.md, gap: 4 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SP.sm,
    paddingHorizontal: SP.sm,
    borderRadius: RADIUS.md,
    gap: SP.sm,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
  },
  pickerRowPressed: { backgroundColor: theme.cardElevated },
  pickerIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerLabel: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  pickerDesc: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs },
});
