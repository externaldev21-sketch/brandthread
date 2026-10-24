/**
 * The one good-news toast (lib/toast.ts `showToast`): a black card with a
 * silver hairline border, check icon + a few words, bottom of the screen
 * above the tab bars, gone after ~2.5s or on tap. Mounted once in
 * app/_layout.tsx; never blocks touches outside the card.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { Icon } from '@/components/ui/Icon';
import { CREATE_CANVAS, FONT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';
import { dismissToast, subscribeToasts, type ToastRequest } from '@/lib/toast';

const TOAST_MS = 2200;
const TOAST_MS_PER_CHAR = 20;
/** Clears both tab bars (buyer pill and seller bar). */
const TOAST_BOTTOM_CLEARANCE = 96;

export function ToastHost() {
  const [toast, setToast] = useState<ToastRequest | null>(null);
  useEffect(() => subscribeToasts(setToast), []);
  if (!toast) return null;
  return <ToastCard key={toast.id} toast={toast} />;
}

function ToastCard({ toast }: { toast: ToastRequest }) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const native = Platform.OS !== 'web';
  const label = toast.message ? `${toast.title}. ${toast.message}` : toast.title;

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(label);
    Animated.timing(anim, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: native }).start(() => dismissToast(toast.id));
    }, TOAST_MS + label.length * TOAST_MS_PER_CHAR);
    return () => clearTimeout(timer);
  }, [anim, label, native, toast.id]);

  const body = (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.wrap,
          {
            bottom: insets.bottom + TOAST_BOTTOM_CLEARANCE,
            opacity: anim,
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          },
        ]}
      >
        <Pressable
          onPress={() => dismissToast(toast.id)}
          accessibilityRole="alert"
          accessibilityLabel={label}
          accessibilityHint="Dismisses this message"
          style={styles.card}
          testID="toast"
        >
          <Icon name="check-circle" size={18} color={CREATE_CANVAS.silver} />
          <View style={styles.copy}>
            <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
              {toast.title}
            </Text>
            {toast.message ? (
              <Text style={styles.message} numberOfLines={2} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
                {toast.message}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );

  return Platform.OS === 'ios' ? <FullWindowOverlay>{body}</FullWindowOverlay> : body;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: SPACING.md, right: SPACING.md, alignItems: 'center' },
  card: {
    width: '100%',
    maxWidth: 480,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderRadius: RADII.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: CREATE_CANVAS.silver,
    backgroundColor: CREATE_CANVAS.black,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 20, fontFamily: FONT.semibold, color: CREATE_CANVAS.white },
  message: { fontSize: 13, lineHeight: 18, fontFamily: FONT.regular, color: CREATE_CANVAS.silver, marginTop: 1 },
});
