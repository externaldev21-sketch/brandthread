/**
 * Thread Explainer — shown once to new buyers after onboarding completion.
 *
 * - Full-screen, routable, safe on refresh.
 * - Uses user-scoped AsyncStorage key so completed first-time buyers skip it.
 * - One dominant full-width CTA navigates to the buyer feed.
 * - Explains Thread interactions using Brandthread concepts.
 * - Sellers are never sent here; only buyer flow routes here.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { ONBOARDING_OWNER_KEY } from './_layout';
import {
  BG,
  BORDER,
  CARD,
  FG,
  GRAD_DARK_FADE,
  GRAD_HERO,
  MUTED,
} from '@/lib/theme';

const EXPLAINER_SEEN_PREFIX = 'thread_explainer_seen:';
const { width: SW } = Dimensions.get('window');

function explainerSeenKey(userId: string): string {
  return `${EXPLAINER_SEEN_PREFIX}${userId}`;
}

const THREAD_FEATURES = [
  {
    icon: 'play-circle' as const,
    title: 'The Thread',
    body: "Your personal brand feed. Scroll through drops, campaigns and behind-the-scenes from brands you follow — and ones you haven't discovered yet.",
  },
  {
    icon: 'heart' as const,
    title: 'Like & Save',
    body: 'Double-tap to like a post. Tap the bookmark to save it to your collection. Brands see your love and surface more of what fits your style.',
  },
  {
    icon: 'shopping-bag' as const,
    title: 'Buy in one tap',
    body: "Products are tagged directly in posts. Tap a product to see details, add to cart, and check out — all without leaving the Thread.",
  },
  {
    icon: 'message-circle' as const,
    title: 'Talk to brands',
    body: "Comment on posts or open a direct message to ask about sizing, availability, or custom orders. Independent brands are real people who reply.",
  },
  {
    icon: 'repeat' as const,
    title: 'Repost drops',
    body: "Share posts from brands you love to your own feed. Your friends see your picks, and brands discover new audiences.",
  },
];

export default function ThreadExplainerScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn, userId } = useAuth();

  const [checked, setChecked] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const slideY  = useRef(new Animated.Value(24)).current;

  // Check if the signed-in buyer has already seen this explainer.
  // If so, redirect them immediately to the buyer feed.
  useEffect(() => {
    if (!isSignedIn || !userId) {
      // Not signed in — redirect to onboarding
      router.replace('/onboarding' as never);
      return;
    }

    AsyncStorage.multiGet([explainerSeenKey(userId), ONBOARDING_OWNER_KEY, 'user_role'])
      .then((values) => {
        const seen = values.find(([key]) => key === explainerSeenKey(userId))?.[1];
        const ownerId = values.find(([key]) => key === ONBOARDING_OWNER_KEY)?.[1];
        const role = values.find(([key]) => key === 'user_role')?.[1];
        if (ownerId !== userId || role !== 'buyer') {
          router.replace(role === 'seller' ? '/(tabs)/' as never : '/onboarding' as never);
          return;
        }
        if (seen === 'true') {
          // Already seen — go straight to feed
          router.replace('/(buyer)/' as never);
        } else {
          setChecked(true);
          // Animate in
          Animated.parallel([
            Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
            Animated.spring(slideY, { toValue: 0, damping: 18, stiffness: 110, useNativeDriver: true }),
          ]).start();
        }
      })
      .catch(() => {
        // Storage error — show the explainer anyway
        setChecked(true);
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.spring(slideY, { toValue: 0, damping: 18, stiffness: 110, useNativeDriver: true }),
        ]).start();
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userId]);

  async function handleEnterThread() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (userId) {
      await AsyncStorage.setItem(explainerSeenKey(userId), 'true').catch(() => {});
    }
    router.replace('/(buyer)/' as never);
  }

  if (!checked) {
    // Blank while checking AsyncStorage — avoids flash
    return <View style={{ flex: 1, backgroundColor: BG }} />;
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      {/* Background gradient */}
      <LinearGradient
        colors={GRAD_HERO}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity, transform: [{ translateY: slideY }] }}>
          {/* Logo mark */}
          <View style={styles.logoWrap}>
            <BrandthreadLogo size={48} />
          </View>

          {/* Hero headline */}
          <Text style={styles.headline}>Welcome to{'\n'}the Thread.</Text>
          <Text style={styles.sub}>
            Brandthread's feed is where independent brands post, drop, and sell — and where you discover them first.
          </Text>

          {/* Feature cards */}
          <View style={styles.features}>
            {THREAD_FEATURES.map((feature, i) => (
              <View key={feature.title} style={styles.featureCard}>
                <View style={[styles.featureIconWrap, { backgroundColor: theme.accentDim, borderColor: theme.accentDim }]}>
                  <Feather name={feature.icon} size={22} color={theme.accentLight} />
                </View>
                <View style={styles.featureContent}>
                  <Text style={styles.featureTitle}>{feature.title}</Text>
                  <Text style={styles.featureBody}>{feature.body}</Text>
                </View>
              </View>
            ))}
          </View>

        </Animated.View>
      </ScrollView>

      {/* Sticky full-width CTA */}
      <Animated.View
        style={[
          styles.ctaWrap,
          { paddingBottom: insets.bottom + 16, opacity },
        ]}
      >
        <LinearGradient
            colors={GRAD_DARK_FADE}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={handleEnterThread}
          style={styles.ctaBtn}
        >
          <LinearGradient
            colors={theme.primaryGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ctaBtnInner}
          >
            <Text style={[styles.ctaBtnText, getOnAccentTextStyle(theme)]}>Enter the Thread</Text>
            <Feather name="arrow-right" size={18} color={theme.onAccent} />
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  logoWrap: {
    marginBottom: 28,
  },
  headline: {
    fontSize: 40,
    fontFamily: 'Inter_700Bold',
    color: FG,
    letterSpacing: -1.5,
    lineHeight: 46,
    marginBottom: 12,
  },
  sub: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: MUTED,
    lineHeight: 24,
    marginBottom: 32,
  },
  features: {
    gap: 12,
    marginBottom: 24,
  },
  featureCard: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    padding: 16,
    alignItems: 'flex-start',
  },
  featureIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  featureContent: {
    flex: 1,
    paddingTop: 2,
  },
  featureTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: FG,
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  featureBody: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: MUTED,
    lineHeight: 19,
  },
  ctaWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  ctaBtn: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  ctaBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: 16,
  },
  ctaBtnText: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: FG,
  },
});
