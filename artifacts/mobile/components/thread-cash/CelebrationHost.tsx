/**
 * "Thread Cash received" toast, shown whenever the current user RECEIVES
 * Thread Cash (a chat payment lands, a blast/gift is received, or the daily
 * active-time reward claims). Mounted once at the app root; anywhere in the
 * app calls `celebrateThreadCash({ amount, from })` via the
 * `useCelebrateThreadCash()` hook.
 *
 * Small and notification-shaped, anchored under the notch — never a
 * full-screen takeover: a compact pill (bill icon + amount + sender) fades
 * in, holds, then slides back up, with a success haptic. Item 148: the bill
 * + confetti burst that used to play with it is gone; the toast is the
 * signal, and the seller swipe glow stays the app's only "wow" effect.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '@/contexts/AppThemeContext';

import { FONT, FS, SP, RADIUS } from '@/lib/theme';

import { formatMoney as formatCents } from '@/lib/format';

import { ThreadCashBillIcon } from './ThreadCashBill';

export type CelebrateThreadCashPayload = {
  /** Cents received. */
  amount: number;
  /** Display name of who it came from, or a source label (e.g. "Daily reward"). */
  from: string;
};

type CelebrationEvent = CelebrateThreadCashPayload & { id: number };

type CelebrationContextValue = {
  celebrateThreadCash: (payload: CelebrateThreadCashPayload) => void;
};

const CelebrationContext = createContext<CelebrationContextValue | null>(null);

export function useCelebrateThreadCash(): (payload: CelebrateThreadCashPayload) => void {
  const ctx = useContext(CelebrationContext);
  if (!ctx) {
    // Never crash the caller (e.g. a realtime event handler mounted outside
    // the provider in a unit test) — just no-op the celebration.
    return () => {};
  }
  return ctx.celebrateThreadCash;
}

/**
 * Same safe-area approach as components/layout/TabPageHeader.tsx: on a real
 * device (or a preview frame that actually emulates one) `insets.top`
 * already clears the notch/Dynamic Island, so a small +6 is enough. Outside
 * that — the plain 390x844 web preview — react-native-safe-area-context's
 * web implementation reads 0 for `insets.top`, which put the toast and the
 * burst's origin right at the very top edge, behind where a real Dynamic
 * Island sits; `Math.max(insets.top, 54)` keeps them clear of it there too.
 */
function topInset(insetsTop: number): number {
  return Platform.OS === 'web' ? Math.max(insetsTop, 54) : insetsTop + 6;
}

const TOAST_HOLD_MS = 1400;

function BurstToast({ event, onDone }: { event: CelebrationEvent; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const scale = useSharedValue(0.96);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

  React.useEffect(() => {
    // Plain ease-in, no overshoot: the toast arriving is the information.
    scale.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
    const timer = setTimeout(() => {
      translateY.value = withTiming(-40, { duration: 260, easing: Easing.in(Easing.cubic) });
      opacity.value = withTiming(0, { duration: 220 }, (finished) => {
        if (finished) runOnJS(onDone)();
      });
    }, TOAST_HOLD_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.toast,
        style,
        { top: topInset(insets.top), backgroundColor: theme.card, borderColor: theme.border },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Received ${formatCents(event.amount)} Thread Cash from ${event.from}`}
    >
      <ThreadCashBillIcon size={22} />
      <Text style={[styles.toastText, { color: theme.text }]} numberOfLines={1}>
        +{formatCents(event.amount)} Thread Cash{' '}
        <Text style={{ color: theme.muted, fontFamily: FONT.regular }}>from {event.from}</Text>
      </Text>
    </Animated.View>
  );
}

export function CelebrationHost({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<CelebrationEvent | null>(null);
  const reduceMotionRef = useRef(false);
  const idRef = useRef(0);

  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => { if (alive) reduceMotionRef.current = !!value; })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value: boolean) => {
      reduceMotionRef.current = !!value;
    });
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  const celebrateThreadCash = useCallback((payload: CelebrateThreadCashPayload) => {
    const event: CelebrationEvent = { ...payload, id: ++idRef.current };
    setToast(event);
    // Item 148: the toast says money arrived; the bill + confetti burst that
    // used to play with it was decoration and is gone (the seller swipe glow
    // is the app's only "wow" effect).
  }, []);

  const value = useMemo(() => ({ celebrateThreadCash }), [celebrateThreadCash]);

  return (
    <CelebrationContext.Provider value={value}>
      {children}
      {toast && <BurstToast event={toast} onDone={() => setToast(null)} />}
    </CelebrationContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 9999,
    elevation: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    maxWidth: '92%',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  toastText: { fontSize: FS.sm, fontFamily: FONT.semibold },
});
