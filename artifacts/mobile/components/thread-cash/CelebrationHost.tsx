/**
 * Global "money burst" celebration, played whenever the current user
 * RECEIVES Thread Cash (a chat payment lands, a blast/gift is received, or
 * the daily active-time reward claims). Mounted once at the app root;
 * anywhere in the app calls `celebrateThreadCash({ amount, from })` via the
 * `useCelebrateThreadCash()` hook.
 *
 * Small and notification-shaped, anchored under the notch — never a
 * full-screen takeover. A burst of little Thread Cash bills + green
 * metallic confetti flips and flutters in 3D, falls with gravity, and fades
 * by ~2s; a compact pill toast (coin + amount + sender) overshoots in,
 * holds, then slides back up. Runs entirely on the UI thread via reanimated
 * worklets so it stays smooth alongside whatever else is on screen, and
 * never intercepts touches.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { ThreadCashCoin, THREAD_CASH_GREEN_DEEP, THREAD_CASH_GREEN_MID } from './ThreadCashBill';

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

const PARTICLE_COUNT = 48;
const BURST_DURATION_MS = 2000;
const TOAST_HOLD_MS = 1400;

type ParticleKind = 'bill' | 'square' | 'ribbon';

type ParticleSpec = {
  kind: ParticleKind;
  size: number;
  color: string;
  angle: number; // launch direction, radians
  speed: number; // px/s-ish outward impulse
  spinX: number;
  spinY: number;
  spinZ: number;
  driftX: number;
  delay: number;
};

const CONFETTI_COLORS = [THREAD_CASH_GREEN_DEEP, THREAD_CASH_GREEN_MID, '#8FE39B', '#155C22', '#2FA33F'];

function buildParticles(seed: number): ParticleSpec[] {
  const particles: ParticleSpec[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Deterministic-ish pseudo-random spread using the index + seed so each
    // burst still looks organic without pulling in a random-number dep.
    const r = (n: number) => {
      const x = Math.sin(seed * 999 + i * 37.13 + n * 7.77) * 10000;
      return x - Math.floor(x);
    };
    const kindRoll = r(1);
    const kind: ParticleKind = kindRoll < 0.32 ? 'bill' : kindRoll < 0.68 ? 'square' : 'ribbon';
    const angle = (-Math.PI / 2) + (r(2) - 0.5) * Math.PI * 1.15; // mostly upward/outward
    particles.push({
      kind,
      size: kind === 'bill' ? 18 + r(3) * 22 : 6 + r(3) * 8,
      color: CONFETTI_COLORS[Math.floor(r(4) * CONFETTI_COLORS.length)],
      angle,
      speed: 160 + r(5) * 220,
      spinX: (r(6) - 0.5) * 900,
      spinY: (r(7) - 0.5) * 900,
      spinZ: (r(8) - 0.5) * 720,
      driftX: (r(9) - 0.5) * 90,
      delay: r(10) * 90,
    });
  }
  return particles;
}

function Particle({ spec }: { spec: ParticleSpec }) {
  const progress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = withDelay(
      spec.delay,
      withTiming(1, { duration: BURST_DURATION_MS - spec.delay, easing: Easing.out(Easing.cubic) }),
    );
    return () => cancelAnimation(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => {
    const t = progress.value;
    // Outward ballistic launch, then gravity pulls it down; horizontal drift
    // layered on top so pieces flutter rather than fly in a straight line.
    const outX = Math.cos(spec.angle) * spec.speed * t;
    const outY = Math.sin(spec.angle) * spec.speed * t;
    const gravity = 520 * t * t;
    const drift = Math.sin(t * Math.PI * 2.2) * spec.driftX * t;
    const translateX = outX + drift;
    const translateY = outY + gravity;
    const opacity = t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) / 0.25);
    const scale = t < 0.12 ? t / 0.12 : 1;

    return {
      opacity,
      transform: [
        { translateX },
        { translateY },
        { scale },
        { perspective: 400 },
        { rotateX: `${spec.spinX * t}deg` },
        { rotateY: `${spec.spinY * t}deg` },
        { rotateZ: `${spec.spinZ * t}deg` },
      ],
    };
  });

  if (spec.kind === 'bill') {
    return (
      <Animated.View style={[styles.particle, style]}>
        <MiniBill size={spec.size} />
      </Animated.View>
    );
  }
  if (spec.kind === 'ribbon') {
    return (
      <Animated.View
        style={[
          styles.particle,
          style,
          { width: spec.size * 0.45, height: spec.size * 2.2, borderRadius: spec.size * 0.25, backgroundColor: spec.color },
        ]}
      />
    );
  }
  return (
    <Animated.View
      style={[styles.particle, style, { width: spec.size, height: spec.size, backgroundColor: spec.color, borderRadius: 2 }]}
    />
  );
}

/** A tiny flat rendering of the bill, cheap enough for ~15 on screen at once. */
function MiniBill({ size }: { size: number }) {
  const w = size;
  const h = size * (255 / 600);
  return (
    <View
      style={{
        width: w,
        height: h,
        borderRadius: 3,
        backgroundColor: THREAD_CASH_GREEN_MID,
        borderWidth: 1,
        borderColor: THREAD_CASH_GREEN_DEEP,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: h * 0.5, height: h * 0.5, borderRadius: h * 0.25, backgroundColor: THREAD_CASH_GREEN_DEEP }} />
    </View>
  );
}

function BurstToast({ event, onDone }: { event: CelebrationEvent; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const scale = useSharedValue(0.5);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

  React.useEffect(() => {
    scale.value = withSequence(
      withSpring(1.08, { damping: 9, stiffness: 260 }),
      withSpring(1, { damping: 14, stiffness: 260 }),
    );
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
        { top: insets.top + 6, backgroundColor: theme.card, borderColor: theme.border },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Received ${formatCents(event.amount)} Thread Cash from ${event.from}`}
    >
      <ThreadCashCoin size={22} />
      <Text style={[styles.toastText, { color: theme.text }]} numberOfLines={1}>
        +{formatCents(event.amount)} Thread Cash{' '}
        <Text style={{ color: theme.muted, fontFamily: FONT.regular }}>from {event.from}</Text>
      </Text>
    </Animated.View>
  );
}

function BurstLayer({ event, onDone }: { event: CelebrationEvent; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const particles = useMemo(() => buildParticles(event.id), [event.id]);

  React.useEffect(() => {
    const timer = setTimeout(onDone, BURST_DURATION_MS + 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlay]}>
      <View style={[styles.origin, { top: insets.top + 24 }]}>
        {particles.map((spec, i) => (
          <Particle key={i} spec={spec} />
        ))}
      </View>
    </View>
  );
}

export function CelebrationHost({ children }: { children: React.ReactNode }) {
  const [burst, setBurst] = useState<CelebrationEvent | null>(null);
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
    if (!reduceMotionRef.current) {
      setBurst(event);
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  }, []);

  const value = useMemo(() => ({ celebrateThreadCash }), [celebrateThreadCash]);

  return (
    <CelebrationContext.Provider value={value}>
      {children}
      {burst && <BurstLayer event={burst} onDone={() => setBurst(null)} />}
      {toast && <BurstToast event={toast} onDone={() => setToast(null)} />}
    </CelebrationContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 9998, elevation: 9998 },
  origin: { position: 'absolute', left: '50%', width: 1, height: 1, alignItems: 'center' },
  particle: { position: 'absolute' },
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
