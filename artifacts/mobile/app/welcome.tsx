import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Dimensions, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

const { width: W, height: H } = Dimensions.get('window');

const FEATURES = [
  { icon: '🎨', label: 'AI design tools' },
  { icon: '🏭', label: 'Manufacturer network' },
  { icon: '📦', label: 'Drop management' },
  { icon: '🛍️', label: 'Buyer marketplace' },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const logoAnim   = useRef(new Animated.Value(0)).current;
  const heroAnim   = useRef(new Animated.Value(0)).current;
  const pillsAnim  = useRef(new Animated.Value(0)).current;
  const btnsAnim   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(120, [
      Animated.spring(logoAnim,  { toValue: 1, damping: 18, stiffness: 120, useNativeDriver: true }),
      Animated.spring(heroAnim,  { toValue: 1, damping: 18, stiffness: 120, useNativeDriver: true }),
      Animated.spring(pillsAnim, { toValue: 1, damping: 18, stiffness: 120, useNativeDriver: true }),
      Animated.spring(btnsAnim,  { toValue: 1, damping: 18, stiffness: 120, useNativeDriver: true }),
    ]).start();
  }, []);

  const fadeSlide = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
  });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#0A0A0A', '#0F1A0F', '#0A0A0A']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Glow accent */}
      <View style={styles.glowTop} />

      <View style={[styles.inner, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}>

        {/* Logo */}
        <Animated.View style={[styles.logoRow, fadeSlide(logoAnim)]}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoLetter}>B</Text>
          </View>
          <Text style={styles.logoText}>BRANDTHREAD</Text>
        </Animated.View>

        {/* Hero copy */}
        <Animated.View style={[styles.heroBlock, fadeSlide(heroAnim)]}>
          <Text style={styles.heroHeadline}>{'Your brand,\nyour rules.'}</Text>
          <Text style={styles.heroSub}>
            Buy, build, and launch clothing brands — all from one place.
          </Text>
        </Animated.View>

        {/* Feature pills */}
        <Animated.View style={[styles.pillsRow, fadeSlide(pillsAnim)]}>
          {FEATURES.map((f) => (
            <View key={f.label} style={styles.pill}>
              <Text style={styles.pillIcon}>{f.icon}</Text>
              <Text style={styles.pillLabel}>{f.label}</Text>
            </View>
          ))}
        </Animated.View>

        <View style={{ flex: 1 }} />

        {/* Buttons */}
        <Animated.View style={[styles.btns, fadeSlide(btnsAnim)]}>
          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push('/sign-in?initialMode=sign-up' as never);
            }}
          >
            <Text style={styles.primaryBtnText}>Create my account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            activeOpacity={0.85}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/sign-in?initialMode=sign-in' as never);
            }}
          >
            <Text style={styles.secondaryBtnText}>Sign in</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => router.push('/sign-in?initialMode=sign-in' as never)}
          >
            <Text style={styles.oauthHint}>Continue with Apple or Google →</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: '#0A0A0A' },
  inner:        { flex: 1, paddingHorizontal: 28 },
  glowTop: {
    position: 'absolute', top: -120, left: W * 0.1,
    width: W * 0.8, height: 300,
    borderRadius: 200,
    backgroundColor: '#00C85320',
  },

  logoRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 60 },
  logoCircle: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#00C853',
    alignItems: 'center', justifyContent: 'center',
  },
  logoLetter: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#FFF' },
  logoText:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: 2.5 },

  heroBlock:     { marginBottom: 40 },
  heroHeadline:  {
    fontSize: 48, fontFamily: 'Inter_700Bold', color: '#FFFFFF',
    letterSpacing: -1.5, lineHeight: 54, marginBottom: 16,
  },
  heroSub: {
    fontSize: 16, fontFamily: 'Inter_400Regular', color: '#FFFFFF80',
    lineHeight: 24,
  },

  pillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFFFFF10', borderRadius: 100,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#FFFFFF15',
  },
  pillIcon:  { fontSize: 14 },
  pillLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#FFFFFFBB' },

  btns:       { gap: 12 },
  primaryBtn: {
    backgroundColor: '#00C853', borderRadius: 16,
    paddingVertical: 17, alignItems: 'center',
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#021208' },

  secondaryBtn: {
    borderRadius: 16, paddingVertical: 16, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#FFFFFF30',
  },
  secondaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  oauthHint: {
    textAlign: 'center', fontSize: 13,
    fontFamily: 'Inter_400Regular', color: '#FFFFFF50',
    marginTop: 4,
  },
});
