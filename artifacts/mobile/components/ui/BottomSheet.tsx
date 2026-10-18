/**
 * Brandthread Design System — the shared sheet system.
 *
 * `useSheetTransition` is the ONE motion/dismissal engine every bottom sheet
 * in the app uses. Everything runs on the UI thread (Reanimated + Gesture
 * Handler):
 *
 *  - Open: a fast, firm spring (SHEET_SPRING, ~260ms, overshoot-clamped so
 *    it lands crisply with no wobble). Light haptic.
 *  - Drag: the sheet follows the finger. Dragging up past rest rubber-bands
 *    (iOS resistance curve). The backdrop's opacity is derived from the
 *    sheet's own position, so it fades in lockstep while dragging too.
 *  - Release: past ~25% of the sheet's height, or a downward flick, dismisses
 *    on the same spring carrying the finger's velocity. Otherwise it springs
 *    back to rest with a selection tick (the detent snap).
 *  - Close: light haptic, then `onClosed` fires exactly once, only after the
 *    close motion has finished. It never fires early, and never twice. (A
 *    swipe-dismiss used to fire it a second time when the parent then
 *    flipped `visible` false.)
 *
 * `<Sheet>` is the shared chrome built on the engine: a raised surface, a
 * grabber, a left-aligned title row with a circular close (or "Done"), a
 * scrollable body that never cuts content off, and an optional primary
 * action pinned above the home indicator that rides up with the keyboard.
 * `<BottomSheet>` is the same chrome without a title row, kept for existing
 * call sites that draw their own header.
 *
 * Bespoke sheets with their own layout (ShopProductSheet, ReportSheet,
 * SaveToCollectionSheet, …) keep calling `useSheetTransition` directly, so
 * they share the exact same motion and haptics.
 *
 * Web: RN Web's Modal already traps focus and closes on Escape (it calls
 * `onRequestClose`), so both come for free from the Modal wrapper.
 */
import React, { useRef } from 'react';
import { a11yModalProps } from '@/lib/a11y/modal';
import {
  ActivityIndicator, Dimensions, Modal, Platform, Pressable, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedScrollHandler, useAnimatedStyle } from 'react-native-reanimated';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useKeyboardHeight } from '@/components/ui/useKeyboardHeight';
import { PressableScale } from '@/components/BrandthreadUI';
import { radius } from '@/constants/radii';
import { FONT } from '@/lib/theme';
import { hapticLight, hapticMedium } from '@/lib/haptics';
import { SHEET_BACKDROP_OPACITY } from '@/constants/motion';
import { useSheetTransition } from '@/components/ui/useSheetTransition';
import { useIsWebShell, WEB_SHELL_MAX_WIDTH } from '@/components/web/WebAppShell';
import { sheetSurfaceColor } from '@/lib/sheetSurface';

// ─── Look ─────────────────────────────────────────────────────────────────────

/** Top corner radius of every shared sheet (12–16pt per the sheet spec). */
export const SHEET_RADIUS = 16;
/** Horizontal padding for sheet content: title row, body and pinned action. */
export const SHEET_GUTTER = 20;
/** Height of the pinned primary action. */
export const SHEET_ACTION_HEIGHT = 50;

export { sheetSurfaceColor };

export { useSheetTransition, type SheetTransition, type SheetDetent, SHEET_HALF_FRACTION } from '@/components/ui/useSheetTransition';

// ─── Chrome ───────────────────────────────────────────────────────────────────

export interface SheetAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** `secondary` is a quiet filled button (e.g. "Cancel" under a primary). */
  variant?: 'primary' | 'secondary' | 'destructive';
  accessibilityLabel?: string;
  testID?: string;
}

import { Icon as PlainSheetCloseIcon } from './Icon';

export interface SheetProps {
  visible: boolean;
  /** Called on backdrop tap, close button, Escape (web), back (Android), and
   *  after a swipe-dismiss finishes. Set your `visible` false here. */
  onClose: () => void;
  /** Left-aligned title. Omit for a chrome-free sheet (grabber only). */
  title?: string;
  /** Opt-in centered title; existing sheets retain their left-aligned header. */
  centerTitle?: boolean;
  /** What sits at the right of the title row. Defaults to a circular close
   *  button when there's a title. `done` shows a "Done" text button. */
  headerRight?: 'close' | 'plain-close' | 'done' | 'none' | React.ReactNode;
  /** Optional left slot in the title row (e.g. a back chevron). */
  headerLeft?: React.ReactNode;
  /** "Done" press; defaults to `onClose`. */
  onDone?: () => void;
  /** Pinned under the body, above the home indicator / keyboard. */
  primaryAction?: SheetAction;
  secondaryAction?: SheetAction;
  /** Custom pinned footer (rendered instead of the actions above). */
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /** Body scrolls when taller than the sheet's max height (default true). */
  scrollable?: boolean;
  /** Pads the body by SHEET_GUTTER horizontally (default true). */
  padded?: boolean;
  /** Tallest the sheet may get, as a fraction of the window (default 0.92). */
  maxHeightRatio?: number;
  /** Rise with the keyboard (default true). */
  avoidKeyboard?: boolean;
  testID?: string;
  reduceMotion?: boolean | null;
  accessibilityLabel?: string;
  /** Extra style for the body content container. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Preserve a screen's approved surface without replacing the shared engine. */
  surfaceStyle?: StyleProp<ViewStyle>;
  showGrabber?: boolean;
  /** Preserve the filter sheet's half/full snap points on the shared engine. */
  detents?: boolean;
}

export function SheetButton({ label, onPress, disabled, loading, variant = 'primary', accessibilityLabel, testID }: SheetAction) {
  const { theme } = useAppTheme();
  const filled = variant === 'primary';
  const bg = filled ? theme.accent : `${theme.text}14`;
  const fg = filled ? theme.onAccent : variant === 'destructive' ? theme.error : theme.text;
  const inactive = !!disabled || !!loading;
  return (
    <PressableScale
      onPress={() => {
        if (inactive) return;
        if (filled) hapticMedium(); else hapticLight();
        onPress();
      }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      testID={testID}
      style={[styles.action, { backgroundColor: bg }, disabled && !loading && styles.actionDisabled]}
    >
      {loading
        ? <ActivityIndicator color={fg} />
        : <Text style={[styles.actionLabel, { color: fg }]} numberOfLines={1}>{label}</Text>}
    </PressableScale>
  );
}

export function SheetCloseButton({ onPress, label = 'Close' }: { onPress: () => void; label?: string }) {
  const { theme } = useAppTheme();
  return (
    <PressableScale
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 7, bottom: 7, left: 7, right: 7 }}
      noMinHeight
      style={[styles.closeCircle, { backgroundColor: `${theme.text}1F` }]}
      testID="sheet-close"
    >
      <Icon name="x" size={16} color={theme.text} />
    </PressableScale>
  );
}

export function SheetGrabber() {
  const { theme } = useAppTheme();
  return (
    <View style={styles.grabberWrap} pointerEvents="none">
      <View style={[styles.grabber, { backgroundColor: `${theme.text}66` }]} />
    </View>
  );
}

export function Sheet({
  visible, onClose, title, centerTitle = false, headerRight, headerLeft, onDone, primaryAction, secondaryAction, footer,
  children, scrollable = true, padded = true, maxHeightRatio = 0.92, avoidKeyboard = true,
  testID, reduceMotion, accessibilityLabel, contentContainerStyle, detents = false, surfaceStyle, showGrabber = true,
}: SheetProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  // Modal portals straight to <body> on web, outside WebAppShell's centred
  // column, so the sheet itself is capped and centred there. The backdrop
  // still dims the whole viewport.
  const isWebShell = useIsWebShell();
  const fullHeight = sheetFullHeight(insets.top);
  const {
    modalVisible, sheetStyle, backdropStyle, panGesture, onSheetLayout, scrollOffset, bodyOverflows,
    contentScrollEnabled, footerStyle,
  } = useSheetTransition(visible, onClose, { reduceMotion, detents: detents ? { fullHeight } : undefined });

  // Native: the whole sheet is draggable, coordinated with the body's own
  // scroll (the sheet only moves while the body is at its top). Web: the
  // grabber + title row is the drag handle, so touch-scrolling the body on a
  // phone browser is never hijacked.
  const isWeb = Platform.OS === 'web';
  const nativeScroll = Gesture.Native();
  if (!isWeb && scrollable) panGesture.simultaneousWithExternalGesture(nativeScroll);
  const viewportH = useRef(0);
  const contentH = useRef(0);
  const syncOverflow = () => bodyOverflows.set(contentH.current > viewportH.current + 1);

  const keyboard = useKeyboardHeight();
  const restingBottom = Math.max(insets.bottom, 16);
  // Pinned content sits on the keyboard (8pt gap) while it's up, and above
  // the home indicator when it's down — tracked per frame, no jump.
  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: avoidKeyboard ? Math.max(restingBottom, -keyboard.value + 8) : restingBottom,
  }));
  const onScroll = useAnimatedScrollHandler(e => { scrollOffset.set(e.contentOffset.y); });

  const right = headerRight ?? (title ? 'close' : 'none');
  const rightNode = right === 'plain-close'
    ? (
      <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"
        style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
        <PlainSheetCloseIcon name="x" size={20} color={theme.text} />
      </PressableScale>
    )
    : right === 'close'
    ? <SheetCloseButton onPress={onClose} />
    : right === 'done'
      ? (
        <PressableScale
          onPress={() => { hapticLight(); (onDone ?? onClose)(); }}
          accessibilityRole="button"
          accessibilityLabel="Done"
          testID="sheet-done"
        >
          <Text style={[styles.doneLabel, { color: theme.text }]}>Done</Text>
        </PressableScale>
      )
      : right === 'none' ? null : right;
  const wrapSheetDrag = (node: React.ReactElement) => (isWeb ? node : <GestureDetector gesture={panGesture}>{node}</GestureDetector>);
  const wrapHandleDrag = (node: React.ReactElement) => (isWeb ? <GestureDetector gesture={panGesture}>{node}</GestureDetector> : node);
  const hasHeader = !!title || !!headerLeft || !!rightNode;
  const hasFooter = !!footer || !!primaryAction || !!secondaryAction;

  const scroll = scrollable ? (
    <Animated.ScrollView
      scrollEnabled={contentScrollEnabled}
      onScroll={onScroll}
      onLayout={e => { viewportH.current = e.nativeEvent.layout.height; syncOverflow(); }}
      onContentSizeChange={(_w, h) => { contentH.current = h; syncOverflow(); }}
      scrollEventThrottle={16}
      bounces={false}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={[styles.bodyScroll, detents && { flex: 1 }]}
      contentContainerStyle={[padded && styles.padded, !hasFooter && styles.bodyEnd, contentContainerStyle]}
    >
      {children}
    </Animated.ScrollView>
  ) : null;
  const body = scroll ? (
    isWeb ? scroll : <GestureDetector gesture={nativeScroll}>{scroll}</GestureDetector>
  ) : (
    <View style={[styles.bodyStatic, padded && styles.padded, !hasFooter && styles.bodyEnd, contentContainerStyle]}>
      {children}
    </View>
  );

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
      testID={testID}
    >
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={[StyleSheet.absoluteFill, styles.backdrop]}
            onPress={onClose}
          />
        </Animated.View>
        {wrapSheetDrag(
          <Animated.View
            {...a11yModalProps()}
            accessibilityLabel={accessibilityLabel ?? title}
            onLayout={onSheetLayout}
            style={[
              styles.sheet,
              isWebShell && styles.sheetWebShell,
              { backgroundColor: sheetSurfaceColor(theme), maxHeight: `${Math.round(maxHeightRatio * 100)}%` },
              detents && { height: fullHeight, maxHeight: fullHeight },
              sheetStyle,
              surfaceStyle,
            ]}
          >
            <Animated.View style={[styles.sheetInner, detents && { flex: 1 }, keyboardStyle]}>
              {wrapHandleDrag(
                <View>
                  {showGrabber ? <SheetGrabber /> : null}
                  {hasHeader ? (
                    <View style={styles.header}>
                      {headerLeft ? <View style={styles.headerLeft}>{headerLeft}</View> : null}
                      {centerTitle && !headerLeft && rightNode ? <View style={{ width: 40 }} /> : null}
                      <Text
                        style={[styles.title, { color: theme.text }, centerTitle && { textAlign: 'center' }]}
                        numberOfLines={1}
                        accessibilityRole="header"
                      >
                        {title ?? ''}
                      </Text>
                      {rightNode ? <View style={styles.headerRight}>{rightNode}</View> : null}
                    </View>
                  ) : null}
                </View>,
              )}
              {body}
              {hasFooter ? (
                <Animated.View style={[styles.footer, detents && footerStyle]}>
                  {footer ?? (
                    <>
                      {primaryAction ? <SheetButton {...primaryAction} /> : null}
                      {secondaryAction ? <SheetButton variant="secondary" {...secondaryAction} /> : null}
                    </>
                  )}
                </Animated.View>
              ) : null}
            </Animated.View>
          </Animated.View>,
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

// ─── Back-compat chrome ───────────────────────────────────────────────────────

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  testID?: string;
  reduceMotion?: boolean | null;
  detents?: boolean;
  footer?: React.ReactNode;
}

/**
 * The shared sheet chrome without a title row — for existing call sites that
 * draw their own header inside the body. New sheets use `<Sheet title=…>`.
 */
export function BottomSheet({ visible, onClose, children, testID, reduceMotion, detents, footer }: BottomSheetProps) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      testID={testID}
      reduceMotion={reduceMotion}
      detents={detents}
      footer={footer}
      padded={false}
      headerRight="none"
      maxHeightRatio={0.88}
    >
      {children}
    </Sheet>
  );
}

export function sheetFullHeight(topInset: number): number {
  return Math.round(Dimensions.get('window').height - Math.max(topInset, 20) - 10);
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: `rgba(0,0,0,${SHEET_BACKDROP_OPACITY})` },
  sheet: {
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    overflow: 'hidden',
    width: '100%',
  },
  sheetInner: { flexShrink: 1 },
  sheetWebShell: {
    maxWidth: WEB_SHELL_MAX_WIDTH,
    alignSelf: 'center',
  },
  grabberWrap: { alignItems: 'center', paddingTop: 6, paddingBottom: 4 },
  grabber: { width: 36, height: 5, borderRadius: 2.5 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: SHEET_GUTTER,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 12,
  },
  headerLeft: { marginLeft: -4 },
  headerRight: { marginRight: -2 },
  title: {
    flex: 1,
    fontFamily: FONT.semibold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  doneLabel: { fontFamily: FONT.semibold, fontSize: 17, lineHeight: 22 },
  closeCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyScroll: { flexGrow: 0, flexShrink: 1 },
  bodyStatic: { flexShrink: 1 },
  padded: { paddingHorizontal: SHEET_GUTTER },
  bodyEnd: { paddingBottom: 8 },
  footer: { paddingHorizontal: SHEET_GUTTER, paddingTop: 12, gap: 8 },
  action: {
    height: SHEET_ACTION_HEIGHT,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  actionDisabled: { opacity: 0.4 },
  actionLabel: { fontFamily: FONT.semibold, fontSize: 17, lineHeight: 22 },
});
