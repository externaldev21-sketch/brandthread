import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';

const { width: W } = Dimensions.get('window');

const BG       = '#07070F';
export default function SplashScreen() {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const logoScale   = useRef(new Animated.Value(0.5)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const ctaOpacity  = useRef(new Animated.Value(0)).current;
  const glowScale   = useRef(new Animated.Value(0.2)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const ringScale   = useRef(new Animated.Value(0.6)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  const advancing   = useRef(false);

  const continueForward = () => {
    if (advancing.current) return;
    advancing.current = true;
    AsyncStorage.setItem('splash_seen', 'true')
      .catch(() => {})
      .finally(() => router.replace('/account-type' as never));
  };

  useEffect(() => {
    // Glow + ring + logo all come in together
    Animated.parallel([
      Animated.timing(glowOpacity,  { toValue: 1,   duration: 600,  useNativeDriver: true }),
      Animated.spring(glowScale,    { toValue: 1.6, damping: 20, stiffness: 60,  useNativeDriver: true }),
      Animated.timing(ringOpacity,  { toValue: 0.35, duration: 700, useNativeDriver: true }),
      Animated.spring(ringScale,    { toValue: 1.2, damping: 18, stiffness: 70,  useNativeDriver: true }),
      Animated.spring(logoScale,    { toValue: 1,   damping: 14, stiffness: 100, useNativeDriver: true }),
      Animated.timing(logoOpacity,  { toValue: 1,   duration: 400,  useNativeDriver: true }),
    ]).start(() => {
      // Tagline fades in after logo settles
      Animated.parallel([
        Animated.timing(textOpacity, { toValue: 1, duration: 450, useNativeDriver: true }),
        Animated.timing(ctaOpacity, { toValue: 1, duration: 500, delay: 500, useNativeDriver: true }),
      ]).start();
    });

    const timer = setTimeout(continueForward, 2600);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[BG, theme.accentDim, BG]}
        style={StyleSheet.absoluteFill}
      />

      {/* Soft purple glow */}
      <Animated.View style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />

      {/* Outer ring */}
      <Animated.View style={[styles.ring, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />

      {/* Logo mark */}
      <Animated.View style={[styles.logoWrap, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
        <BrandthreadLogo size={110} showGlow glowColor={theme.shadowColor} />
      </Animated.View>

      {/* Wordmark + tagline */}
      <Animated.View style={[styles.textWrap, { opacity: textOpacity }]}>
        <Text style={styles.wordmark}>BRANDTHREAD</Text>
        <Text style={styles.tagline}>Build it. Wear it. Scale it.</Text>
      </Animated.View>

      {/* Optional early exit; the automatic advance keeps this moment frictionless. */}
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

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: theme.accentDim,
  },
  ring: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  logoWrap: { alignItems: 'center', marginBottom: 36 },
  textWrap: { alignItems: 'center', gap: 8 },
  wordmark: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 4,
  },
  tagline: {
    fontSize: 14,
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
