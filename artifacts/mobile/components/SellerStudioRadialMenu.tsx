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
 * Presented as a tall spring-rise sheet (not the old centered fade), with a
 * swipe-down-to-dismiss drag on the handle/header, haptics on every tap, and
 * full theming via useAppTheme() so all 12 brand themes apply through tokens.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';

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

const PIN_TILE_SIZE = 84;
const PIN_TILE_GAP = 10;

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
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isTablet = screenWidth >= BREAKPOINT.tablet;
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme, isTablet), [theme, isTablet]);
  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } = useSubscriptionPlan();
  const api = useApi();

  const { userId, isSignedIn } = useAuth();

  // Backdrop + close-button progress (kept — device contract taps by label).
  const progress = useRef(new Animated.Value(0)).current;
  // Sheet rise + drag-to-dismiss.
  const sheetY = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const sheetHeight = Math.min(screenHeight * 0.9, screenHeight - insets.top - 24);
  // Close (X) button floats in the dimmed backdrop, clear ABOVE the sheet's
  // top edge, so it never overlaps the sheet header's "View store" button.
  // Was previously pinned to `insets.top + SP.xl` regardless of sheet
  // height, which put it on top of the header row on most phone sizes.
  const sheetTop = screenHeight - sheetHeight;
  const closeButtonTop = Math.max(insets.top + SP.md, sheetTop - 52 - SP.md);

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
    progress.stopAnimation();
    sheetY.stopAnimation();
    dragY.stopAnimation();
  }, [progress, sheetY, dragY]);

  // ── Open / close ────────────────────────────────────────────────────────────

  const expand = useCallback(() => {
    setOpen(true);
    setEditMode(false);
    setQuery('');
    progress.setValue(0);
    sheetY.setValue(sheetHeight);
    dragY.setValue(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    requestAnimationFrame(() => {
      Animated.spring(progress, {
        toValue: 1,
        damping: 22,
        stiffness: 220,
        mass: 0.6,
        useNativeDriver: true,
      }).start();
      Animated.spring(sheetY, {
        toValue: 0,
        damping: 20,
        stiffness: 180,
        mass: 0.7,
        useNativeDriver: true,
      }).start();
    });
  }, [progress, sheetY, dragY, sheetHeight]);

  useEffect(() => {
    if (openRequestKey > 0 && !open) expand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestKey]);

  const collapse = useCallback((after?: () => void) => {
    Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    Animated.timing(sheetY, { toValue: sheetHeight, duration: 200, useNativeDriver: true }).start(() => {
      setOpen(false);
      after?.();
    });
  }, [progress, sheetY, sheetHeight]);

  // ── Drag-to-dismiss (handle + header) ─────────────────────────────────────

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) dragY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 100 || g.vy > 0.8) {
          collapse();
        } else {
          Animated.spring(dragY, { toValue: 0, damping: 18, stiffness: 220, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, { toValue: 0, damping: 18, stiffness: 220, useNativeDriver: true }).start();
      },
    }),
  ).current;

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

  const renderItemRow = (item: ControlCenterItem, opts?: { showSection?: string }) => {
    const badge = badgeCountFor(item);
    const locked = isLocked(item);
    return (
      <PressableScale
        key={item.id}
        onPress={() => choose(item)}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        testID={`seller-control-center-item-${item.id}`}
        style={styles.row}
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
            { top: insets.top + SP.xl, backgroundColor: theme.accent, shadowColor: theme.shadowColor },
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
          style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}
          pointerEvents="none"
        />
        <Pressable
          testID="seller-studio-menu-dismiss"
          accessibilityLabel="Dismiss Studio tools backdrop"
          onPress={() => collapse()}
          style={StyleSheet.absoluteFill}
        />

        {/* Sheet */}
        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [
                { translateY: Animated.add(sheetY, dragY) },
              ],
            },
          ]}
        >
          <View {...panResponder.panHandlers}>
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
                {results.map((item) => {
                  const section = SECTIONS.find((s) => s.items.some((i) => i.id === item.id));
                  return renderItemRow(item, { showSection: section?.title });
                })}
              </View>
            ) : (
              <>
                {/* ── Pinned row ── */}
                <View style={styles.pinnedHeaderRow}>
                  <Text style={styles.sectionHeading}>Pinned</Text>
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

                <View style={styles.sectionSpacer} />

                {/* ── Grouped sections ── */}
                {SECTIONS.map((section) => (
                  <View key={section.key} style={styles.section}>
                    <View style={styles.sectionTitleRow}>
                      <Feather name={section.icon as any} size={12} color={theme.subtle} />
                      <Text style={styles.sectionHeading}>{section.title.toUpperCase()}</Text>
                    </View>
                    {section.items.map((item) => renderItemRow(item))}
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </Animated.View>

        {/* Close button */}
        <Animated.View
          style={[
            styles.toggle,
            {
              top: closeButtonTop,
              backgroundColor: theme.accent,
              shadowColor: theme.shadowColor,
              opacity: progress,
              transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
            },
          ]}
          pointerEvents={open ? 'auto' : 'none'}
        >
          <Pressable
            testID="seller-studio-menu-close"
            accessibilityRole="button"
            accessibilityLabel="Close Studio tools"
            onPress={() => collapse()}
            style={styles.toggleInner}
          >
            <Feather name="x" size={22} color={theme.onAccent} />
          </Pressable>
        </Animated.View>
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

  scrollContent: { paddingHorizontal: SP.md, paddingBottom: SP.xxl, gap: 2 },

  pinnedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SP.sm,
  },
  editLink: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.accentLight },

  saveFailedNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginBottom: SP.xs },

  pinnedRow: { gap: PIN_TILE_GAP, paddingBottom: SP.sm, paddingRight: SP.xs },

  pinTile: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.cardElevated,
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

  sectionSpacer: { height: SP.md },

  section: { marginBottom: SP.md },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  sectionHeading: {
    color: theme.subtle,
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    letterSpacing: 1,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingVertical: 11,
    paddingHorizontal: SP.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
    marginBottom: 6,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: theme.accentDim,
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
