/**
 * Signature launch intro — plays once per cold start, on top of the native
 * splash screen (expo-splash-screen), before handing off to the app below.
 *
 * Sequencing:
 *  1. Renders the same static logo/background as the native splash so
 *     `SplashScreen.hideAsync()` (fired on mount) is an invisible swap.
 *  2. Shoots the logo in from depth with a motion-streak trail, lands with
 *     a spring + haptic tick, then a light sweeps across it.
 *  3. First-ever launch after install gets a longer thread-line draw before
 *     the shoot-in; every later cold start skips straight to it.
 *  4. If `ready` isn't true yet when the entrance finishes, holds on the
 *     landed frame with a slow pulse until it is, then reveals the app by
 *     zooming through the mark.
 *  5. Reduce Motion collapses all of the above to a plain fade in/out.
 *
 * The app tree (`children`) mounts immediately underneath so data loading
 * always runs in parallel with the animation, never after it.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { DEFAULT_THEME } from '@/contexts/AppThemeContext';
import { consumeFirstLaunch } from '@/lib/introSplash';

const LOGO_BOX = 132;
const SWEEP_WIDTH = LOGO_BOX * 0.9;
const AnimatedPath = Animated.createAnimatedComponent(Path);

type Phase = 'pending' | 'draw' | 'enter' | 'sweep' | 'hold' | 'reveal' | 'done';

// A single flowing stroke — a stitched "thread" flourish, not a trace of the
// raster logo (we don't have vector path data for it). It draws once, then
// cross-fades into the real logo for the shoot-in.
const THREAD_PATH = 'M6,58 C34,10 50,96 78,50 C98,18 108,74 132,42 C144,26 152,40 166,32';
const THREAD_PATH_LENGTH = 420;

type AppIntroSplashProps = {
  ready: boolean;
  children: React.ReactNode;
};

// The native splash and this whole sequence are a mobile cold-start concern;
// on web there's no native splash to hand off from, so just render straight
// through. Kept as a wrapper (rather than an early return inside the real
// component) so the hooks below stay unconditional.
export default function AppIntroSplash({ ready, children }: AppIntroSplashProps) {
  if (Platform.OS === 'web') return <>{children}</>;
  return <AnimatedAppIntroSplash ready={ready}>{children}</AnimatedAppIntroSplash>;
}

function AnimatedAppIntroSplash({ ready, children }: AppIntroSplashProps) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('pending');
  const [isFirstLaunch, setIsFirstLaunch] = useState(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const logoScale = useSharedValue(0.22);
  const logoOpacity = useSharedValue(0);
  const drawProgress = useSharedValue(0);
  const drawOpacity = useSharedValue(1);
  const sweepProgress = useSharedValue(0);
  const pulse = useSharedValue(0);
  const overlayOpacity = useSharedValue(1);

  const finishIntro = () => setPhase('done');

  const startReveal = () => {
    setPhase('reveal');
    cancelAnimation(pulse);
    logoScale.value = withTiming(reducedMotion ? 1 : 3.4, {
      duration: reducedMotion ? 0 : 260,
      easing: Easing.in(Easing.cubic),
    });
    overlayOpacity.value = withTiming(
      0,
      { duration: reducedMotion ? 260 : 240, easing: Easing.out(Easing.quad) },
      (finished) => {
        if (finished) runOnJS(finishIntro)();
      },
    );
  };

  const startHoldOrReveal = () => {
    if (readyRef.current) {
      startReveal();
      return;
    }
    setPhase('hold');
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true);
  };

  const startSweep = () => {
    setPhase('sweep');
    sweepProgress.value = withTiming(
      1,
      { duration: 380, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(startHoldOrReveal)();
      },
    );
  };

  const triggerLandingHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };

  const startEnter = () => {
    setPhase('enter');
    logoOpacity.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) });
    logoScale.value = withSpring(
      1,
      { damping: 14, stiffness: 170, mass: 0.9 },
      (finished) => {
        if (finished) {
          runOnJS(triggerLandingHaptic)();
          runOnJS(startSweep)();
        }
      },
    );
  };

  const startDraw = () => {
    setPhase('draw');
    drawProgress.value = withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) {
        drawOpacity.value = withTiming(0, { duration: 140 });
        runOnJS(startEnter)();
      }
    });
  };

  // Resolve variant + reveal the native splash's held frame to this
  // component, then kick off the sequence.
  useEffect(() => {
    let active = true;
    void (async () => {
      const firstLaunch = await consumeFirstLaunch(AsyncStorage);
      if (!active) return;
      setIsFirstLaunch(firstLaunch);
      await SplashScreen.hideAsync().catch(() => {});
      if (!active) return;

      if (reducedMotion) {
        setPhase('enter');
        logoOpacity.value = withTiming(1, { duration: 300 });
        logoScale.value = 1;
        // The hold/reveal below still respects `ready`; just skip the theatrics.
        startHoldOrReveal();
        return;
      }

      if (firstLaunch) {
        startDraw();
      } else {
        startEnter();
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the entrance finished and we're just holding on the landed logo,
  // reveal as soon as the app becomes ready.
  useEffect(() => {
    if (ready && phase === 'hold') startReveal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, phase]);

  const logoStyle = useAnimatedStyle(() => {
    const pulseScale = interpolate(pulse.value, [0, 1], [1, 1.015]);
    const scale = phase === 'hold' ? logoScale.value * pulseScale : logoScale.value;
    return {
      opacity: logoOpacity.value,
      transform: [{ scale }],
    };
  });

  const streakStyle = useAnimatedStyle(() => {
    const streakOpacity = interpolate(logoScale.value, [0.22, 0.55, 1], [0, 0.35, 0], Extrapolation.CLAMP);
    return {
      opacity: streakOpacity,
      transform: [{ scale: logoScale.value * 1.35 }],
    };
  });

  const drawStyle = useAnimatedStyle(() => ({ opacity: drawOpacity.value }));
  const threadAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: interpolate(drawProgress.value, [0, 1], [THREAD_PATH_LENGTH, 0]),
  }));

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          sweepProgress.value,
          [0, 1],
          [-LOGO_BOX, LOGO_BOX],
        ),
      },
      { rotate: '18deg' },
    ],
    opacity: interpolate(sweepProgress.value, [0, 0.15, 0.85, 1], [0, 0.55, 0.55, 0]),
  }));

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  if (phase === 'done') return <>{children}</>;

  return (
    <View style={StyleSheet.absoluteFill}>
      {children}
      <Animated.View
        style={[styles.overlay, { backgroundColor: DEFAULT_THEME.background }, overlayStyle]}
        pointerEvents="auto"
      >
        {isFirstLaunch && !reducedMotion && (
          <Animated.View style={[styles.threadWrap, drawStyle]}>
            <Svg width={LOGO_BOX} height={LOGO_BOX * 0.6} viewBox="0 0 172 108">
              <AnimatedPath
                d={THREAD_PATH}
                stroke={DEFAULT_THEME.accentLight}
                strokeWidth={3}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={THREAD_PATH_LENGTH}
                animatedProps={threadAnimatedProps}
              />
            </Svg>
          </Animated.View>
        )}

        <View style={styles.logoBox}>
          <Animated.View style={[styles.streak, streakStyle]}>
            <BrandthreadLogo size={LOGO_BOX} tintColor={DEFAULT_THEME.accentLight} opacity={0.5} />
          </Animated.View>
          <Animated.View style={logoStyle}>
            <BrandthreadLogo size={LOGO_BOX} tintColor={DEFAULT_THEME.accentLight} />
          </Animated.View>
          {(phase === 'sweep' || phase === 'hold' || phase === 'reveal') && !reducedMotion && (
            <Animated.View style={[styles.sweepClip, { width: LOGO_BOX, height: LOGO_BOX }]} pointerEvents="none">
              <Animated.View style={[styles.sweepBeam, sweepStyle]}>
                <LinearGradient
                  colors={['#FFFFFF00', '#FFFFFF66', '#FFFFFF00']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </Animated.View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBox: {
    width: LOGO_BOX,
    height: LOGO_BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streak: {
    position: 'absolute',
  },
  threadWrap: {
    position: 'absolute',
    top: '38%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sweepClip: {
    position: 'absolute',
    overflow: 'hidden',
  },
  sweepBeam: {
    position: 'absolute',
    top: -LOGO_BOX * 0.5,
    left: -LOGO_BOX * 0.5,
    width: SWEEP_WIDTH,
    height: LOGO_BOX * 2,
  },
});
