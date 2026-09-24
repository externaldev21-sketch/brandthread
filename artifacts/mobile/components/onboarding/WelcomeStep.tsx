/**
 * Cinematic opener for onboarding — the very first screen a new user sees
 * after splash. No external network fetches: the "collage" is built purely
 * from theme gradient tokens plus the app logo, so it renders instantly and
 * correctly across all 12 themes without bundling video assets.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';

export function WelcomeStep({
  onGetStarted,
  onSignIn,
}: {
  onGetStarted: () => void;
  onSignIn: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(theme);
  const onAccentTextStyle = getOnAccentTextStyle(theme);

  const fade = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.85)).current;
  const panA = useRef(new Animated.Value(0)).current;
  const panB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, damping: 14, stiffness: 90, useNativeDriver: true }),
    ]).start();

    // Slow, looping "pan" of two large gradient blobs to simulate a
    // gently-moving collage without any video/image asset pipeline.
    const loop = (value: Animated.Value, duration: number, delay = 0) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, { toValue: 1, duration, delay, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration, useNativeDriver: true }),
        ]),
      );
    loop(panA, 9000).start();
    loop(panB, 12000, 1200).start();
  }, []);

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={theme.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={[
            styles.blob,
            styles.blobA,
            {
              backgroundColor: theme.accent,
              transform: [
                { translateX: panA.interpolate({ inputRange: [0, 1], outputRange: [-40, 40] }) },
                { translateY: panA.interpolate({ inputRange: [0, 1], outputRange: [-20, 30] }) },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.blob,
            styles.blobB,
            {
              backgroundColor: theme.secondary,
              transform: [
                { translateX: panB.interpolate({ inputRange: [0, 1], outputRange: [30, -30] }) },
                { translateY: panB.interpolate({ inputRange: [0, 1], outputRange: [40, -10] }) },
              ],
            },
          ]}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.28)' }]} />
      </View>

      <Animated.View style={[styles.content, { opacity: fade, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 28 }]}>
        <Animated.View style={{ transform: [{ scale: logoScale }] }}>
          <BrandthreadLogo size={56} />
        </Animated.View>

        <View style={styles.copyWrap}>
          <Text style={styles.headline}>Where brands{'\n'}find their people.</Text>
        </View>

        <View style={styles.ctas}>
          <TouchableOpacity
            testID="onboarding-welcome-get-started"
            accessibilityLabel="Get started"
            activeOpacity={0.88}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onGetStarted(); }}
          >
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBtn}>
              <Text style={[styles.primaryBtnText, onAccentTextStyle]}>Get started</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            testID="onboarding-welcome-sign-in"
            accessibilityLabel="I already have an account"
            style={styles.secondaryBtn}
            activeOpacity={0.75}
            onPress={() => { Haptics.selectionAsync(); onSignIn(); }}
          >
            <Text style={styles.secondaryBtnText}>I already have an account</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, overflow: 'hidden' },
  blob: { position: 'absolute', width: 420, height: 420, borderRadius: 210, opacity: 0.35 },
  blobA: { top: -120, left: -100 },
  blobB: { bottom: -140, right: -120 },
  content: { flex: 1, justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 28 },
  copyWrap: { marginTop: 'auto', marginBottom: 32 },
  headline: {
    fontSize: 40,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: -1.2,
    lineHeight: 46,
  },
  ctas: { width: '100%', gap: 10 },
  primaryBtn: { borderRadius: 14, paddingVertical: 17, alignItems: 'center' },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  secondaryBtn: { paddingVertical: 14, alignItems: 'center' },
  secondaryBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: 'rgba(255,255,255,0.9)' },
});
