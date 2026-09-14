import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';

const BG       = '#0A0A0B';
export default function SplashScreen() {
  const router = useRouter();

  const logoScale   = useRef(new Animated.Value(0.5)).current;
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
    // Animate logo in, then auto-advance after ~2.5s
    Animated.parallel([
      Animated.spring(logoScale,    { toValue: 1,   damping: 14, stiffness: 100, useNativeDriver: true }),
      Animated.timing(logoOpacity,  { toValue: 1,   duration: 400,  useNativeDriver: true }),
    ]).start();

    const autoAdvance = setTimeout(continueForward, 2500);
    return () => clearTimeout(autoAdvance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.logoWrap, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
        <BrandthreadLogo size={136} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: { alignItems: 'center' },
  wordmark: {
    fontSize: 19,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 5,
  },
  tagline: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: '#FFFFFF55',
    letterSpacing: 0.3,
  },
  cta: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FFFFFF28',
    backgroundColor: '#FFFFFF0A',
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});
