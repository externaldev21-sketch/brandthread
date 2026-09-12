import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';

const BG       = '#07070F';
export default function SplashScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const logoScale   = useRef(new Animated.Value(0.5)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const ctaOpacity  = useRef(new Animated.Value(0)).current;
  const continuing  = useRef(false);

  const continueForward = () => {
    if (continuing.current) return;
    continuing.current = true;
    AsyncStorage.setItem('splash_seen', 'true')
      .catch(() => {})
      .finally(() => router.replace('/onboarding' as never));
  };

  useEffect(() => {
    Animated.parallel([
      Animated.spring(logoScale,    { toValue: 1,   damping: 14, stiffness: 100, useNativeDriver: true }),
      Animated.timing(logoOpacity,  { toValue: 1,   duration: 400,  useNativeDriver: true }),
    ]).start(() => {
      // Tagline fades in after logo settles
      Animated.parallel([
        Animated.timing(textOpacity, { toValue: 1, duration: 450, useNativeDriver: true }),
        Animated.timing(ctaOpacity, { toValue: 1, duration: 500, delay: 500, useNativeDriver: true }),
      ]).start();
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.brandBlock}>
        {/* Logo mark */}
        <Animated.View style={[styles.logoWrap, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
          <BrandthreadLogo size={136} />
        </Animated.View>

        {/* Wordmark + tagline */}
        <Animated.View style={[styles.textWrap, { opacity: textOpacity }]}>
          <Text style={styles.wordmark}>BRANDTHREAD</Text>
          <Text style={styles.tagline}>Build it. Wear it. Scale it.</Text>
        </Animated.View>
      </View>

      {/* The only way forward is an explicit tap. */}
      <Animated.View style={[styles.ctaWrap, { bottom: insets.bottom + 28, opacity: ctaOpacity }]}>
        <TouchableOpacity
          style={styles.cta}
          activeOpacity={0.86}
          onPress={continueForward}
        >
          <Text style={styles.ctaText}>Get started</Text>
        </TouchableOpacity>
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
  brandBlock: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: { alignItems: 'center', marginBottom: 40 },
  textWrap: { alignItems: 'center', gap: 10 },
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
  ctaWrap: {
    position: 'absolute',
    left: 24,
    right: 24,
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
