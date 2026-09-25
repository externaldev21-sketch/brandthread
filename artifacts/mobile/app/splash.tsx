import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { ThreadDraw } from '@/components/onboarding/ThreadLine';
import { useAppTheme } from '@/contexts/AppThemeContext';

export default function SplashScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();

  const logoScale   = useRef(new Animated.Value(0.86)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const continuing  = useRef(false);

  const continueForward = () => {
    if (continuing.current) return;
    continuing.current = true;
    AsyncStorage.setItem('splash_seen', 'true')
      .catch(() => {})
      .finally(() => router.replace('/onboarding' as never));
  };

  useEffect(() => {
    // Keep the launch transition restrained: a short fade and gentle scale,
    // matching the static native splash before continuing into onboarding.
    Animated.parallel([
      Animated.spring(logoScale,    { toValue: 1, damping: 18, stiffness: 120, useNativeDriver: true }),
      Animated.timing(logoOpacity,  { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    const autoAdvance = setTimeout(continueForward, 2500);
    return () => clearTimeout(autoAdvance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {/* The onboarding thread starts here: it sews through the mark and
          carries on into the Welcome screen. Decorative only. */}
      <ThreadDraw height={180} color={theme.text} delay={200} duration={1600} style={styles.thread} />
      <Animated.View style={[styles.logoWrap, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
        <BrandthreadLogo size={150} tintColor={theme.accentLight} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thread: { position: 'absolute', left: 0, right: 0, top: '50%', marginTop: -90 },
  logoWrap: { alignItems: 'center', justifyContent: 'center' },
});
