/**
 * Signature native launch intro. The original thread draw, logo trails,
 * light sweep and wordmark remain available on the motion path.
 * The existing launch policy uses the plain-logo Reduce Motion path.
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
  useSharedValue,
  withRepeat,
  withTiming,
  withSpring,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { DEFAULT_THEME, peekPersistedTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { consumeFirstLaunch } from '@/lib/introSplash';
import { hapticLight } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
const LAUNCH_BACKGROUND = '#000000'; // theme-exempt: brand launch plane stays opaque before account theme restoration

const LOGO_BOX = 132;
const SWEEP_WIDTH = LOGO_BOX * 0.9;
const WORDMARK = 'BRANDTHREAD';
const AnimatedPath = Animated.createAnimatedComponent(Path);

type Phase = 'pending' | 'draw' | 'enter' | 'shine' | 'hold' | 'wordmark' | 'reveal' | 'done';
const THREAD_PATH = 'M6,58 C34,10 50,96 78,50 C98,18 108,74 132,42 C144,26 152,40 166,32';
const THREAD_PATH_LENGTH = 420;

type AppIntroSplashProps = {
  ready: boolean;
  children: React.ReactNode;
};

// On web there's no native splash to hand off from, so render straight
// through. Kept as a wrapper so the hooks below stay unconditional.
export default function AppIntroSplash({ ready, children }: AppIntroSplashProps) {
  if (Platform.OS === 'web') return <>{children}</>;
  return <AnimatedAppIntroSplash ready={ready}>{children}</AnimatedAppIntroSplash>;
}

function AnimatedAppIntroSplash({ ready, children }: AppIntroSplashProps) {
  // Items 147 + 148: the launch screen is the mark on black and nothing
  // else — the same frame as the native splash, held until the app is ready,
  // then a plain fade.
  const reducedMotion = true;
  const [phase, setPhase] = useState<Phase>('pending');
  const [isFirstLaunch, setIsFirstLaunch] = useState(false);
  // Restored while the native splash still covers the screen, so it never
  // reads as a flash. Kept so the persisted theme is warmed before handoff.
  const [theme, setTheme] = useState<AppThemePreset>(DEFAULT_THEME);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // Paint the native splash's exact logo frame before hiding that splash.
  const logoScale = useSharedValue(reducedMotion ? 1 : 0.6);
  const logoOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const drawProgress = useSharedValue(0);
  const drawOpacity = useSharedValue(1);
  const sweepProgress = useSharedValue(0);
  const wordmarkProgress = useSharedValue(0);
  const wordmarkFade = useSharedValue(1);
  const pulse = useSharedValue(0);
  const holding = useSharedValue(0);
  const overlayOpacity = useSharedValue(1);

  const finishIntro = () => setPhase('done');

  const startReveal = () => {
    setPhase('reveal');
    holding.value = 0;
    cancelAnimation(pulse);
    wordmarkFade.value = withTiming(0, { duration: reducedMotion ? 0 : 140 });
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
    holding.value = 1;
    setPhase('hold');
  };

  const startWordmark = () => {
    setPhase('wordmark');
    wordmarkProgress.value = withTiming(
      1,
      { duration: 320, easing: Easing.out(Easing.cubic) },
      (finished) => { if (finished) runOnJS(startReveal)(); },
    );
  };

  const startHoldOrWordmark = () => {
    if (readyRef.current) {
      startWordmark();
      return;
    }
    holding.value = 1;
    setPhase('hold');
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true);
  };

  const startShine = () => {
    setPhase('shine');
    sweepProgress.value = withTiming(
      1,
      { duration: 380, easing: Easing.out(Easing.cubic) },
      (finished) => { if (finished) runOnJS(startHoldOrWordmark)(); },
    );
  };

  const startEnter = () => {
    setPhase('enter');
    logoOpacity.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) });
    logoScale.value = withSpring(1, { damping: 13, stiffness: 190, mass: 0.9 }, (finished) => {
      if (finished) {
        runOnJS(hapticLight)();
        runOnJS(startShine)();
      }
    });
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

  useEffect(() => {
    let active = true;
    void (async () => {
      const [firstLaunch, persistedTheme] = await Promise.all([
        consumeFirstLaunch(AsyncStorage),
        peekPersistedTheme(AsyncStorage),
      ]);
      if (!active) return;
      setIsFirstLaunch(firstLaunch);
      setTheme(persistedTheme);
      await SplashScreen.hideAsync().catch(() => {});
      if (!active) return;

      if (reducedMotion) {
        setPhase('enter');
        // Shown at once: the native splash already painted this exact frame,
        // so hiding it is an invisible swap (no fade-in blink).
        logoOpacity.value = 1;
        logoScale.value = 1;
        wordmarkProgress.value = 1;
        startHoldOrReveal();
        return;
      }
      if (firstLaunch) startDraw();
      else startEnter();
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Holding on the settled logo: continue as soon as the app becomes ready.
  useEffect(() => {
    if (!ready || phase !== 'hold') return;
    if (reducedMotion) startReveal();
    else startWordmark();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, phase]);

  const logoStyle = useAnimatedStyle(() => {
    const pulseScale = interpolate(pulse.value, [0, 1], [1, 1.015]);
    const scale = holding.value ? logoScale.value * pulseScale : logoScale.value;
    return { opacity: logoOpacity.value, transform: [{ scale }] };
  });
  const echoNear = useAnimatedStyle(() => ({
    opacity: interpolate(logoScale.value, [0.6, 0.85, 1], [0, 0.4, 0], Extrapolation.CLAMP),
    transform: [{ scale: logoScale.value * 1.18 }],
  }));
  const echoFar = useAnimatedStyle(() => ({
    opacity: interpolate(logoScale.value, [0.6, 0.85, 1], [0, 0.22, 0], Extrapolation.CLAMP),
    transform: [{ scale: logoScale.value * 1.34 }],
  }));
  const drawStyle = useAnimatedStyle(() => ({ opacity: drawOpacity.value }));
  const threadAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: interpolate(drawProgress.value, [0, 1], [THREAD_PATH_LENGTH, 0]),
  }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(sweepProgress.value, [0, 1], [-LOGO_BOX, LOGO_BOX]) },
      { rotate: '18deg' },
    ],
    opacity: interpolate(sweepProgress.value, [0, 0.15, 0.85, 1], [0, 0.55, 0.55, 0]),
  }));

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  return (
    <View style={StyleSheet.absoluteFill}>
      {children}
      {phase !== 'done' && (
      <Animated.View
        // Always black, like the native splash — not the persisted theme tint.
        style={[styles.overlay, { backgroundColor: LAUNCH_BACKGROUND }, overlayStyle]}
        pointerEvents="auto"
      >
        {isFirstLaunch && !reducedMotion && (
          <Animated.View style={[styles.threadWrap, drawStyle]}>
            <Svg width={LOGO_BOX} height={LOGO_BOX * 0.6} viewBox="0 0 172 108">
              <AnimatedPath
                d={THREAD_PATH}
                stroke={theme.accentLight}
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
          <Animated.View style={[styles.streak, echoFar]}>
            <BrandthreadLogo size={LOGO_BOX} opacity={0.5} />
          </Animated.View>
          <Animated.View style={[styles.streak, echoNear]}>
            <BrandthreadLogo size={LOGO_BOX} opacity={0.5} />
          </Animated.View>
          <Animated.View style={logoStyle}>
            <BrandthreadLogo size={LOGO_BOX} />
          </Animated.View>
          {(phase === 'shine' || phase === 'hold' || phase === 'wordmark' || phase === 'reveal') &&
            !reducedMotion && (
              <Animated.View
                style={[styles.sweepClip, { width: LOGO_BOX, height: LOGO_BOX }]}
                pointerEvents="none"
              >
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
        {!reducedMotion && (
          <View style={styles.wordmarkRow} pointerEvents="none">
            {WORDMARK.split('').map((char, index) => (
              <WordmarkLetter
                key={`${char}-${index}`}
                char={char}
                index={index}
                total={WORDMARK.length}
                progress={wordmarkProgress}
                fade={wordmarkFade}
                color={theme.text}
              />
            ))}
          </View>
        )}
      </Animated.View>
      )}
    </View>
  );
}

function WordmarkLetter({ char, index, total, progress, fade, color }: {
  char: string;
  index: number;
  total: number;
  progress: SharedValue<number>;
  fade: SharedValue<number>;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const start = (index / total) * 0.6;
    const end = start + 0.4;
    const revealed = interpolate(progress.value, [start, end], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: revealed * fade.value,
      transform: [{ translateY: interpolate(revealed, [0, 1], [6, 0]) }],
    };
  });
  return (
    <Animated.Text style={[styles.wordmarkChar, { color }, style]}>{char === ' ' ? ' ' : char}</Animated.Text>
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
  streak: { position: 'absolute' },
  threadWrap: {
    position: 'absolute',
    top: '38%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sweepClip: { position: 'absolute', overflow: 'hidden' },
  sweepBeam: {
    position: 'absolute',
    top: -LOGO_BOX * 0.5,
    left: -LOGO_BOX * 0.5,
    width: SWEEP_WIDTH,
    height: LOGO_BOX * 2,
  },
  wordmarkRow: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: LOGO_BOX / 2 + 16,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  wordmarkChar: { fontFamily: FONT.semibold, fontSize: 13 },
});
