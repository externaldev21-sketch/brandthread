/**
 * Launch hand-off — sits on top of the native splash (expo-splash-screen)
 * for one cold start, then gets out of the way.
 *
 *  1. Renders the same static logo/background as the native splash, so
 *     `SplashScreen.hideAsync()` (fired on mount) is an invisible swap.
 *  2. Holds that frame while fonts and the session load — no pulse, no
 *     spinner.
 *  3. Fades out in 200ms once the app is ready.
 *
 * The earlier version shot the logo in with a spring, motion-streak copies,
 * a light sweep, a thread draw and a letter-by-letter wordmark; all of that
 * is gone (Grailed and SSENSE launch on a still mark).
 *
 * The app tree (`children`) mounts immediately underneath so data loading
 * always runs in parallel, never after it.
 */

import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { DEFAULT_THEME, peekPersistedTheme, type AppThemePreset } from '@/contexts/AppThemeContext';

const LOGO_BOX = 132;

type AppIntroSplashProps = {
  ready: boolean;
  children: React.ReactNode;
};

// The native splash is a mobile cold-start concern; on web there's nothing to
// hand off from, so render straight through.
export default function AppIntroSplash({ ready, children }: AppIntroSplashProps) {
  if (Platform.OS === 'web') return <>{children}</>;
  return <NativeIntroSplash ready={ready}>{children}</NativeIntroSplash>;
}

function NativeIntroSplash({ ready, children }: AppIntroSplashProps) {
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(false);
  // The native splash still covers the screen while this resolves, so the
  // theme swap is never visible.
  const [theme, setTheme] = useState<AppThemePreset>(DEFAULT_THEME);
  const overlayOpacity = useSharedValue(1);

  useEffect(() => {
    let active = true;
    void (async () => {
      const persistedTheme = await peekPersistedTheme(AsyncStorage);
      if (!active) return;
      setTheme(persistedTheme);
      setShown(true);
      await SplashScreen.hideAsync().catch(() => {});
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready || !shown) return;
    overlayOpacity.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(setDone)(true);
    });
  }, [ready, shown, overlayOpacity]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  if (done) return <>{children}</>;

  return (
    <View style={StyleSheet.absoluteFill}>
      {children}
      <Animated.View
        style={[styles.overlay, { backgroundColor: theme.background }, overlayStyle]}
        pointerEvents="auto"
      >
        <BrandthreadLogo size={LOGO_BOX} tintColor={theme.accentLight} />
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
});
