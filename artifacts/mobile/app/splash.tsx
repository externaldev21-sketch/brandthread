import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';

const { width: W } = Dimensions.get('window');

export default function SplashScreen() {
  const router = useRouter();

  const logoScale  = useRef(new Animated.Value(0.6)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const glowScale  = useRef(new Animated.Value(0.3)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Logo reveal
    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, damping: 14, stiffness: 100, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(glowOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(glowScale, { toValue: 1.4, damping: 20, stiffness: 60, useNativeDriver: true }),
    ]).start(() => {
      // Tagline fades in
      Animated.timing(textOpacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    });

    // Navigate after 2.4s
    const timer = setTimeout(async () => {
      await AsyncStorage.setItem('splash_seen', 'true');
      router.replace('/welcome' as never);
    }, 2400);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#060A06', '#0A140A', '#060A06']}
        style={StyleSheet.absoluteFill}
      />

      {/* Glow behind logo */}
      <Animated.View style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />

      {/* Logo mark */}
      <Animated.View style={[styles.logoWrap, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
        <View style={styles.logoSquare}>
          <Text style={styles.logoLetter}>B</Text>
        </View>
      </Animated.View>

      {/* Wordmark + tagline */}
      <Animated.View style={[styles.textWrap, { opacity: textOpacity }]}>
        <Text style={styles.wordmark}>BRANDTHREAD</Text>
        <Text style={styles.tagline}>Your brand, your rules.</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#060A06',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: '#00C85318',
  },
  logoWrap: { alignItems: 'center', marginBottom: 32 },
  logoSquare: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: '#00C853',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00C853',
    shadowOpacity: 0.7,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 20,
  },
  logoLetter: {
    fontSize: 52,
    fontFamily: 'Inter_700Bold',
    color: '#FFF',
  },
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
    color: '#FFFFFF50',
    letterSpacing: 0.3,
  },
});
