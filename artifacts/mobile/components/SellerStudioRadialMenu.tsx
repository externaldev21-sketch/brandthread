import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
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
import { GROWTH_PLAN_ENFORCEMENT_ENABLED, GROWTH_STUDIO_TOOLS } from '@/lib/growthTools';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  FIXED_SHORTCUTS,
  PICKER_DESTINATIONS,
  TOTAL_ANIMATED_ITEMS,
  clearCustomShortcut,
  loadCustomShortcut,
  saveCustomShortcut,
} from '@/lib/studioShortcuts';
import type { PickerDestination } from '@/lib/studioShortcuts';
import { SheetRise } from '@/components/motion/SheetRise';

// Re-export pure helpers for external consumers / tests that import from this path
export {
  PICKER_DESTINATIONS,
  shortcutStorageKey,
  loadCustomShortcut,
  saveCustomShortcut,
  clearCustomShortcut,
} from '@/lib/studioShortcuts';
export type { PickerDestination } from '@/lib/studioShortcuts';

// ─── Types ────────────────────────────────────────────────────────────────────

type MenuAction = {
  id: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route: string;
  /** Growth plan required to access this action */
  growthOnly: boolean;
};

// ─── Studio actions (existing six, Growth-gated) ─────────────────────────────

const GROWTH_ROUTES: Record<string, string> = {
  'design-studio':   '/design',
  'ai-photoshoot':   '/design-ai-photoshoot',
  'mockup-to-model': '/design-mockup-to-model',
  'remove-bg':       '/design-bg-removal',
  'ai-design':       '/design-text-to-design',
  'campaign-gen':    '/design-campaign',
};

const STUDIO_TOOL_IDS = [
  'design-studio',
  'mockup-to-model',
  'remove-bg',
  'ai-design',
  'campaign-gen',
  'ai-photoshoot',
] as const;

const STUDIO_ACTIONS: MenuAction[] = STUDIO_TOOL_IDS.map((id) => {
  const tool = GROWTH_STUDIO_TOOLS.find((c) => c.id === id);
  if (!tool) throw new Error(`Missing Studio tool definition: ${id}`);
  return {
    id: tool.id,
    label: tool.title,
    icon: tool.icon,
    route: GROWTH_ROUTES[tool.id],
    growthOnly: true,
  };
});

// ─── Layout constants ─────────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get('window').width;
const SHEET_WIDTH  = Math.min(SCREEN_WIDTH - 48, 360);
const ROW_HEIGHT   = 60;
const STAGGER_MS   = 32; // ms between each row animating in

// Tile layout: 2 cols × 2 rows inside the shortcut section
const TILE_GAP  = 8;
const TILE_W    = Math.floor((SHEET_WIDTH - TILE_GAP) / 2);
const TILE_H    = 80; // near-square short-rectangle; comfortable touch target

// Total animated items = studio (6) + shortcut tiles (4) — sourced from lib
const TOTAL_ITEMS = TOTAL_ANIMATED_ITEMS; // 10

// ─── Component ────────────────────────────────────────────────────────────────

interface SellerStudioRadialMenuProps {
  hideTrigger?: boolean;
  openRequestKey?: number;
}

export default function SellerStudioRadialMenu({
  hideTrigger = false,
  openRequestKey = 0,
}: SellerStudioRadialMenuProps) {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } =
    useSubscriptionPlan();

  // Clerk auth for per-user persistence
  const { userId, isSignedIn } = useAuth();

  // One progress value drives backdrop + close-button.
  const progress  = useRef(new Animated.Value(0)).current;
  // One animated value per item (studio rows + 4 shortcut tiles).
  const itemAnims = useRef(
    Array.from({ length: TOTAL_ITEMS }, () => new Animated.Value(0)),
  ).current;

  const [open, setOpen]               = useState(false);
  const [upsellFeature, setUpsellFeature] = useState<string | null>(null);

  // Custom 4th shortcut (null = show "Add Shortcut")
  const [customShortcut, setCustomShortcut] = useState<PickerDestination | null>(null);
  // Tracks which userId we loaded for — avoids flashing prior account's selection
  const loadedForUserIdRef = useRef<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Load / reload on account change ──────────────────────────────────────

  useEffect(() => {
    if (!isSignedIn || !userId) {
      // Signed out — clear in-memory shortcut immediately (no flash)
      if (loadedForUserIdRef.current !== null) {
        loadedForUserIdRef.current = null;
        setCustomShortcut(null);
      }
      return;
    }
    if (loadedForUserIdRef.current === userId) return; // already loaded for this user

    // Clear previous user's shortcut before loading new one
    setCustomShortcut(null);
    loadedForUserIdRef.current = userId;

    loadCustomShortcut(userId).then((dest) => {
      // Guard: user may have signed out or switched again during the async load
      if (loadedForUserIdRef.current !== userId) return;
      setCustomShortcut(dest);
    });
  }, [isSignedIn, userId]);

  useEffect(() => () => {
    progress.stopAnimation();
    itemAnims.forEach((a) => a.stopAnimation());
  }, [progress, itemAnims]);

  // ── Open ──────────────────────────────────────────────────────────────────

  const expand = useCallback(() => {
    setOpen(true);
    progress.setValue(0);
    itemAnims.forEach((a) => a.setValue(0));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    requestAnimationFrame(() => {
      Animated.spring(progress, {
        toValue: 1,
        damping: 22,
        stiffness: 220,
        mass: 0.6,
        useNativeDriver: true,
      }).start();

      itemAnims.forEach((anim, i) => {
        Animated.spring(anim, {
          toValue: 1,
          damping: 20,
          stiffness: 200,
          mass: 0.55,
          delay: i * STAGGER_MS,
          useNativeDriver: true,
        }).start();
      });
    });
  }, [progress, itemAnims]);

  useEffect(() => {
    if (openRequestKey > 0 && !open) expand();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestKey]);

  // ── Close ─────────────────────────────────────────────────────────────────

  const collapse = useCallback((after?: () => void) => {
    [...itemAnims].reverse().forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: 0,
        duration: 90,
        delay: i * 18,
        useNativeDriver: true,
      }).start();
    });
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setOpen(false);
      after?.();
    });
  }, [progress, itemAnims]);

  // ── Choose (studio rows) ───────────────────────────────────────────────────

  const choose = useCallback((action: MenuAction) => {
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

  // ── Shortcut tile press (navigate) ────────────────────────────────────────

  const pressShortcut = useCallback((dest: PickerDestination) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    collapse(() => router.push(dest.route as never));
  }, [collapse, router]);

  // ── Picker select ─────────────────────────────────────────────────────────

  const handlePickerSelect = useCallback(async (dest: PickerDestination | null) => {
    setPickerOpen(false);
    setSaveFailed(false);
    if (!userId || !isSignedIn) {
      // Not signed in — ephemeral session, allow in-memory selection without persisting
      setCustomShortcut(dest);
      return;
    }
    if (dest === null) {
      // Clear
      const ok = await clearCustomShortcut(userId);
      if (ok) {
        setCustomShortcut(null);
      } else {
        // Storage failure — keep current selection, allow retry via reopen
        setSaveFailed(true);
      }
      return;
    }
    // Optimistically update UI
    setCustomShortcut(dest);
    const ok = await saveCustomShortcut(userId, dest);
    if (!ok) {
      // Revert to prevent false saved state
      setCustomShortcut(null);
      setSaveFailed(true);
    }
  }, [userId, isSignedIn]);

  // ── Row renderer (studio section) ─────────────────────────────────────────

  const renderRow = (action: MenuAction, globalIndex: number) => {
    const anim = itemAnims[globalIndex];
    const opacity    = anim;
    const translateY = anim.interpolate({
      inputRange: [0, 1],
      outputRange: [20 + globalIndex * 4, 0],
    });
    const scale = anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.9, 1],
    });

    return (
      <Animated.View
        key={action.id}
        style={[
          styles.rowWrap,
          { width: SHEET_WIDTH, opacity, transform: [{ translateY }, { scale }] },
        ]}
      >
        <Pressable
          testID={`seller-studio-action-${action.id}`}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => choose(action)}
          style={({ pressed }) => [
            styles.actionRow,
            pressed && styles.actionRowPressed,
          ]}
        >
           <View style={styles.actionIcon}>
            <Feather name={action.icon} size={20} color={theme.accentLight} />
          </View>
          <Text style={styles.actionLabel} numberOfLines={1}>
            {action.label}
          </Text>
           <Feather name="chevron-right" size={16} color={theme.muted} />
        </Pressable>
      </Animated.View>
    );
  };

  // ── Shortcut tile renderer ────────────────────────────────────────────────

  const renderShortcutTile = (
    tileIndex: number, // 0–3 within the 4-tile grid
    icon: keyof typeof Feather.glyphMap,
    label: string,
    onPress: () => void,
    testID: string,
    editControl?: React.ReactNode,
  ) => {
    const globalIndex = STUDIO_ACTIONS.length + tileIndex;
    const anim = itemAnims[globalIndex];
    const opacity    = anim;
    const translateY = anim.interpolate({
      inputRange: [0, 1],
      outputRange: [16, 0],
    });
    const scale = anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.92, 1],
    });

    return (
      <Animated.View
        key={testID}
        style={[
          styles.tileCellWrap,
          { opacity, transform: [{ translateY }, { scale }] },
        ]}
      >
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={onPress}
          style={({ pressed }) => [
            styles.tile,
            pressed && styles.tilePressed,
          ]}
        >
          <Feather name={icon} size={22} color={theme.accentLight} style={styles.tileIcon} />
          <Text style={styles.tileLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>
            {label}
          </Text>
        </Pressable>
        {editControl}
      </Animated.View>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Lightning-bolt trigger — hidden while modal is open */}
      {!hideTrigger && !open && (
        <Pressable
          testID="seller-studio-menu-open"
          accessibilityRole="button"
          accessibilityLabel="Open Studio tools"
          onPress={expand}
          style={({ pressed }) => [
            styles.toggle,
            {
              top: insets.top + SP.xl,
              backgroundColor: theme.accent,
              shadowColor: theme.shadowColor,
            },
            pressed && styles.pressed,
          ]}
        >
          <Feather name="zap" size={22} color={theme.onAccent} />
        </Pressable>
      )}

      <Modal
        visible={open}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => collapse()}
      >
        {/* Solid dark backdrop */}
        <Animated.View
          testID="seller-studio-menu-backdrop"
          accessibilityLabel="Studio tools dark backdrop"
          style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}
          pointerEvents="none"
        />

        {/* Full-screen tap-to-dismiss */}
        <Pressable
          testID="seller-studio-menu-dismiss"
          accessibilityLabel="Dismiss Studio tools backdrop"
          onPress={() => collapse()}
          style={StyleSheet.absoluteFill}
        />

        {/* ── Scrollable centered content ── */}
        <View
          style={[
            styles.outerWrap,
            {
              paddingTop: insets.top + 88,
              paddingBottom: Math.max(insets.bottom + 32, 48),
            },
          ]}
          pointerEvents="box-none"
        >
          <ScrollView
            style={{
              width: SHEET_WIDTH,
              maxHeight: Math.max(320, screenHeight - insets.top - insets.bottom - 136),
            }}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            scrollEnabled
            alwaysBounceVertical={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Section: Main menu ── */}
            <Text style={styles.sectionHeading}>Main menu</Text>

            {STUDIO_ACTIONS.map((action, i) => renderRow(action, i))}

            {/* ── Spacer between sections ── */}
            <View style={styles.sectionSpacer} />

            {/* ── Section: Shortcuts ── */}
            <Text style={styles.sectionHeading}>Shortcuts</Text>

            {/* Storage failure notice — unobtrusive, inline */}
            {saveFailed && (
              <Text style={styles.saveFailedNote} testID="shortcut-save-failed-note">
                Couldn't save shortcut — tap to retry
              </Text>
            )}

            {/* 2×2 tile grid */}
            <View style={styles.tileGrid} testID="shortcut-tile-grid">

              {/* Tile 1: Create Post */}
              {renderShortcutTile(
                0,
                FIXED_SHORTCUTS[0].icon as keyof typeof Feather.glyphMap,
                FIXED_SHORTCUTS[0].label,
                () => pressShortcut({
                  id: FIXED_SHORTCUTS[0].id,
                  label: FIXED_SHORTCUTS[0].label,
                  icon: FIXED_SHORTCUTS[0].icon,
                  route: FIXED_SHORTCUTS[0].route,
                }),
                `seller-studio-shortcut-${FIXED_SHORTCUTS[0].id}`,
              )}

              {/* Tile 2: Boost */}
              {renderShortcutTile(
                1,
                FIXED_SHORTCUTS[1].icon as keyof typeof Feather.glyphMap,
                FIXED_SHORTCUTS[1].label,
                () => pressShortcut({
                  id: FIXED_SHORTCUTS[1].id,
                  label: FIXED_SHORTCUTS[1].label,
                  icon: FIXED_SHORTCUTS[1].icon,
                  route: FIXED_SHORTCUTS[1].route,
                }),
                `seller-studio-shortcut-${FIXED_SHORTCUTS[1].id}`,
              )}

              {/* Tile 3: New Product */}
              {renderShortcutTile(
                2,
                FIXED_SHORTCUTS[2].icon as keyof typeof Feather.glyphMap,
                FIXED_SHORTCUTS[2].label,
                () => pressShortcut({
                  id: FIXED_SHORTCUTS[2].id,
                  label: FIXED_SHORTCUTS[2].label,
                  icon: FIXED_SHORTCUTS[2].icon,
                  route: FIXED_SHORTCUTS[2].route,
                }),
                `seller-studio-shortcut-${FIXED_SHORTCUTS[2].id}`,
              )}

              {/* Tile 4: Custom or Add Shortcut */}
              {customShortcut
                ? renderShortcutTile(
                    3,
                    customShortcut.icon as keyof typeof Feather.glyphMap,
                    customShortcut.label,
                    () => pressShortcut(customShortcut),
                    'seller-studio-shortcut-custom',
                    // Discoverable edit control — small badge in top-right corner
                    <Pressable
                      testID="seller-studio-shortcut-edit"
                      accessibilityRole="button"
                      accessibilityLabel="Change shortcut"
                      onPress={(e) => {
                        e.stopPropagation?.();
                        Haptics.selectionAsync().catch(() => {});
                        setPickerOpen(true);
                      }}
                      style={styles.editBadge}
                      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                    >
                       <Feather name="edit-2" size={11} color={theme.text} />
                    </Pressable>,
                  )
                : renderShortcutTile(
                    3,
                    'plus',
                    'Add Shortcut',
                    () => {
                      Haptics.selectionAsync().catch(() => {});
                      setPickerOpen(true);
                    },
                    'seller-studio-shortcut-add',
                  )}
            </View>

          </ScrollView>
        </View>

        {/* Close button at the trigger position */}
        <Animated.View
          style={[
            styles.toggle,
            {
              top: insets.top + SP.xl,
              backgroundColor: theme.accent,
              shadowColor: theme.shadowColor,
              opacity: progress,
              transform: [
                {
                  scale: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            },
          ]}
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

      {/* ── Shortcut Picker Sheet ── */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          style={styles.pickerBackdrop}
          onPress={() => setPickerOpen(false)}
          testID="shortcut-picker-backdrop"
        />
        <SheetRise
          style={[
            styles.pickerSheet,
            { paddingBottom: Math.max(insets.bottom + 8, 24) },
          ]}
          testID="shortcut-picker-sheet"
        >
          {/* Handle */}
          <View style={styles.pickerHandle} />

          <Text style={styles.pickerHeading}>Choose a shortcut</Text>

          <ScrollView
            showsVerticalScrollIndicator={false}
            alwaysBounceVertical={false}
            contentContainerStyle={styles.pickerList}
          >
            {PICKER_DESTINATIONS.map((dest) => (
              <Pressable
                key={dest.id}
                testID={`shortcut-picker-option-${dest.id}`}
                accessibilityRole="button"
                accessibilityLabel={dest.label}
                onPress={() => handlePickerSelect(dest)}
                style={({ pressed }) => [
                  styles.pickerRow,
                  pressed && styles.pickerRowPressed,
                  customShortcut?.id === dest.id && styles.pickerRowSelected,
                ]}
              >
                <View style={styles.pickerIcon}>
                  <Feather name={dest.icon as keyof typeof Feather.glyphMap} size={18} color={theme.accentLight} />
                </View>
                <View style={styles.pickerTextWrap}>
                  <Text style={styles.pickerLabel}>{dest.label}</Text>
                  {dest.description ? (
                    <Text style={styles.pickerDesc} numberOfLines={1}>{dest.description}</Text>
                  ) : null}
                </View>
                {customShortcut?.id === dest.id && (
                  <Feather name="check" size={16} color={theme.accentLight} />
                )}
              </Pressable>
            ))}

            {/* Clear option — only shown when a custom shortcut is set */}
            {customShortcut && (
              <Pressable
                testID="shortcut-picker-clear"
                accessibilityRole="button"
                accessibilityLabel="Clear shortcut"
                onPress={() => handlePickerSelect(null)}
                style={({ pressed }) => [
                  styles.pickerRow,
                  styles.pickerRowClear,
                  pressed && styles.pickerRowPressed,
                ]}
              >
                <View style={styles.pickerIcon}>
                  <Feather name="x-circle" size={18} color={theme.muted} />
                </View>
                <View style={styles.pickerTextWrap}>
                  <Text style={styles.pickerLabel}>Clear shortcut</Text>
                </View>
              </Pressable>
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

const makeStyles = (theme: { background: string; border: string; card: string; cardElevated: string; text: string; muted: string; subtle: string }) => StyleSheet.create({
  // Lightning-bolt / close toggle
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
  toggleInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },

  // Backdrop: 0.88 black
  backdrop: {
    backgroundColor: theme.background,
  },

  // Outer wrapper centers the scroll list on screen
  outerWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  listContent: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: SP.lg,
  },

  // Section heading — uppercase label above each group
  sectionHeading: {
    width: SHEET_WIDTH,
    color: theme.text,
    fontFamily: FONT.bold,
    fontSize: FS.sm,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
    paddingHorizontal: 4,
  },

  // Gap between the two sections
  sectionSpacer: {
    height: SP.lg,
  },

  rowWrap: {
    // width set inline per SHEET_WIDTH
  },

  actionRow: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.sm,
    gap: SP.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
  },
  actionRowPressed: {
    backgroundColor: theme.cardElevated,
    transform: [{ scale: 0.98 }],
  },

  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionLabel: {
    flex: 1,
    color: theme.text,
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    letterSpacing: -0.1,
  },

  // ── Shortcut tile grid ────────────────────────────────────────────────────

  tileGrid: {
    width: SHEET_WIDTH,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TILE_GAP,
  },

  tileCellWrap: {
    width: TILE_W,
    height: TILE_H,
    position: 'relative',
  },

  tile: {
    flex: 1,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.sm,
    paddingVertical: SP.sm,
    gap: SP.xs,
  },
  tilePressed: {
    backgroundColor: theme.cardElevated,
    transform: [{ scale: 0.96 }],
  },
  tileIcon: {
    // margin managed by gap above
  },
  tileLabel: {
    color: theme.text,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    textAlign: 'center',
    letterSpacing: -0.1,
  },

  // Edit badge — small chip in the top-right corner of the custom tile
  editBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.cardElevated,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  // Save failure note
  saveFailedNote: {
    width: SHEET_WIDTH,
    color: theme.subtle,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    textAlign: 'center',
    marginBottom: SP.xs,
    paddingHorizontal: 4,
  },

  // ── Picker sheet ──────────────────────────────────────────────────────────

  pickerBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.background,
    opacity: 0.72,
  },

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

  pickerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.border,
    alignSelf: 'center',
    marginBottom: SP.md,
  },

  pickerHeading: {
    color: theme.text,
    fontFamily: FONT.bold,
    fontSize: FS.base,
    letterSpacing: -0.2,
    textAlign: 'center',
    marginBottom: SP.sm,
    paddingHorizontal: SP.md,
  },

  pickerList: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.md,
    gap: 4,
  },

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
  pickerRowPressed: {
    backgroundColor: theme.cardElevated,
  },
  pickerRowSelected: {
    borderColor: theme.border,
    backgroundColor: theme.cardElevated,
  },
  pickerRowClear: {
    marginTop: SP.sm,
    borderColor: theme.border,
  },

  pickerIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  pickerTextWrap: {
    flex: 1,
    gap: 2,
  },

  pickerLabel: {
    color: theme.text,
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    letterSpacing: -0.1,
  },

  pickerDesc: {
    color: theme.muted,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
  },
});
