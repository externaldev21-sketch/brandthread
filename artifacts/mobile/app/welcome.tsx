import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Dimensions, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const { width: W } = Dimensions.get('window');

const BG     = '#07070F';
const PURPLE = '#8B5CF6';
const CYAN   = '#22D3EE';

const FEATURE_CARDS = [
  { icon: 'star' as const, label: 'Design', sub: 'AI-powered tools' },
  { icon: 'settings' as const, label: 'Manufacture', sub: 'Global network' },
  { icon: 'shopping-bag' as const, label: 'Sell', sub: 'Your storefront' },
  { icon: 'trending-up' as const, label: 'Scale', sub: 'Built-in analytics' },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const heroAnim  = useRef(new Animated.Value(0)).current;
  const cardsAnim = useRef(new Animated.Value(0)).current;
  const btnsAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(120, [
      Animated.spring(heroAnim,  { toValue: 1, damping: 18, stiffness: 100, useNativeDriver: true }),
      Animated.spring(cardsAnim, { toValue: 1, damping: 18, stiffness: 100, useNativeDriver: true }),
      Animated.spring(btnsAnim,  { toValue: 1, damping: 18, stiffness: 100, useNativeDriver: true }),
    ]).start();
  }, []);

  const fadeUp = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }],
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 28 }]}>
      <StatusBar barStyle="light-content" />
      {/* Back button — visible when navigated here from within the app */}
      <TouchableOpacity
        onPress={() => router.back()}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.75}
        style={{ position: 'absolute', top: insets.top + 12, left: 20, width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
      >
        <Feather name="arrow-left" size={18} color="#ffffff" />
      </TouchableOpacity>

      {/* Ambient glow */}
      <View style={styles.glowTop} />
      <View style={styles.glowMid} />

      {/* Logo */}
      <View style={styles.logoRow}>
        <BrandthreadLogo size={38} />
        <Text style={styles.logoText}>BRANDTHREAD</Text>
      </View>

      {/* Hero headline */}
      <Animated.View style={[styles.heroBlock, fadeUp(heroAnim)]}>
        <Text style={styles.headline}>Your entire{'\n'}fashion world,{'\n'}in one place.</Text>
        <Text style={styles.subtext}>
          Discover the next brand or build a million-dollar clothing company from your phone.
        </Text>
      </Animated.View>

      {/* Feature cards — 2×2 grid */}
      <Animated.View style={[styles.cardsGrid, fadeUp(cardsAnim)]}>
        {FEATURE_CARDS.map((f) => (
          <View key={f.label} style={styles.featureCard}>
            <Feather name={f.icon} size={20} color={PURPLE} />
            <Text style={styles.featureLabel}>{f.label}</Text>
            <Text style={styles.featureSub}>{f.sub}</Text>
          </View>
        ))}
      </Animated.View>

      <View style={{ flex: 1 }} />

      {/* Buttons */}
      <Animated.View style={[styles.btns, fadeUp(btnsAnim)]}>
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push('/account-type' as never);
          }}
        >
          <LinearGradient
            colors={[PURPLE, CYAN]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.primaryBtn}
          >
            <Text style={styles.primaryBtnText}>Get started</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          activeOpacity={0.85}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/sign-in' as never);
          }}
        >
          <Text style={styles.secondaryBtnText}>Sign in</Text>
        </TouchableOpacity>

        <Text style={styles.legalText}>
          By continuing, you agree to Brandthread's{' '}
          <Text style={styles.legalLink}>Terms</Text>
          {' and '}
          <Text style={styles.legalLink}>Privacy Policy</Text>.
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 24,
  },

  glowTop: {
    position: 'absolute',
    top: -80,
    left: W * 0.05,
    width: W * 0.9,
    height: 260,
    borderRadius: 200,
    backgroundColor: '#8B5CF615',
  },
  glowMid: {
    position: 'absolute',
    top: 200,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#22D3EE0A',
  },

  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 48,
  },
  logoText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 2.5,
  },

  heroBlock:  { marginBottom: 36 },
  headline: {
    fontSize: 40,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: -1.2,
    lineHeight: 46,
    marginBottom: 16,
  },
  subtext: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#FFFFFF70',
    lineHeight: 23,
  },

  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  featureCard: {
    width: (W - 48 - 10) / 2,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    gap: 4,
  },
  featureIcon:  { fontSize: 20, marginBottom: 4 },
  featureLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  featureSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#FFFFFF55' },

  btns: { gap: 12 },
  primaryBtn: {
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: 'center',
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  secondaryBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  secondaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  legalText: {
    textAlign: 'center',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#FFFFFF40',
    lineHeight: 18,
    marginTop: 4,
  },
  legalLink: { color: '#FFFFFF70' },
});
