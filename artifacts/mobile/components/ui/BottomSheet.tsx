/**
 * Brandthread Design System — BottomSheet (Phase 1)
 *
 * Grabber handle, spring animation (SHEET_SPRING), dimmed backdrop, and
 * keyboard-aware content. A generic primitive for anything simpler than the
 * bespoke sheets already in the app (ShopProductSheet, SaveToCollectionSheet,
 * ThreadShareSheet) — those keep their own implementations for now.
 *
 * Layout/interaction reference only: UNIQLO "Added to cart" sheet.
 */
import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { identityOrNone } from '@/lib/animationUtils';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { RADII } from '@/constants/radii';
import { SPACING } from '@/constants/spacing';
import { FADE_MS, SHEET_SPRING } from '@/constants/motion';
import { useIsWebShell, WEB_SHELL_MAX_WIDTH } from '@/components/web/WebAppShell';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  testID?: string;
}

export function BottomSheet({ visible, onClose, children, testID }: BottomSheetProps) {
  const palette = useColors();
  const insets = useSafeAreaInsets();
  // Modal portals straight to <body> on web, outside WebAppShell's centered
  // column, so an un-capped sheet would stretch edge-to-edge across a wide
  // desktop window instead of reading as a card. The backdrop still dims the
  // whole viewport (correct); only the sheet itself is capped and centered.
  const isWebShell = useIsWebShell();
  const translateY = useSharedValue(400);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      backdropOpacity.set(withTiming(1, { duration: FADE_MS, easing: Easing.out(Easing.cubic) }));
      translateY.set(withSpring(0, SHEET_SPRING));
    } else {
      backdropOpacity.set(withTiming(0, { duration: FADE_MS }));
      translateY.set(withTiming(400, { duration: FADE_MS }));
    }
  }, [visible, backdropOpacity, translateY]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));
  // `identityOrNone` drops the `transform` key entirely once the sheet is
  // fully open (translateY back at 0) instead of leaving an identity
  // `[{ translateY: 0 }]` — on web that would otherwise permanently force
  // this View onto its own compositing layer, softening the sheet's text if
  // that layer doesn't land on a whole device pixel. See lib/animationUtils.ts.
  const sheetStyle = useAnimatedStyle(() => ({ transform: identityOrNone([{ translateY: translateY.value }]) }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} testID={testID}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={StyleSheet.absoluteFill}
            onPress={onClose}
          >
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
          </Pressable>
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            isWebShell && styles.sheetWebShell,
            {
              backgroundColor: palette.card,
              borderColor: palette.border,
              paddingBottom: Math.max(insets.bottom, SPACING.md),
            },
            sheetStyle,
          ]}
        >
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: palette.mutedForeground }]} />
          </View>
          <KeyboardAwareScrollViewCompat keyboardShouldPersistTaps="handled" bottomOffset={24}>
            {children}
          </KeyboardAwareScrollViewCompat>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RADII.sheet,
    borderTopRightRadius: RADII.sheet,
    borderWidth: 1,
    maxHeight: '88%',
  },
  sheetWebShell: {
    width: '100%',
    maxWidth: WEB_SHELL_MAX_WIDTH,
    alignSelf: 'center',
  },
  handleWrap: { alignItems: 'center', paddingTop: SPACING.xs, paddingBottom: SPACING.xxs },
  handle: { width: 36, height: 4, borderRadius: RADII.pill, opacity: 0.3 },
});
