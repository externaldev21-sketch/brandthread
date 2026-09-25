/**
 * Cinematic opener for onboarding — the very first screen a new user sees
 * after splash. A black canvas, one line of big type, and the signature
 * thread drawing itself edge to edge through the Brandthread mark.
 *
 * No network fetches or media assets: everything is vector or theme token,
 * so it renders instantly and correctly across all 12 themes.
 */
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Glow, ThreadDraw } from './ThreadLine';
import { PillButton, Reveal, StepHeadline } from './OnboardingUI';
import { MOTION, SPACE, TYPE, useOnboardingMotion } from './onboardingTokens';

const THREAD_DELAY = 250;
const HERO_HEIGHT = 200;
const LOGO_SIZE = 92;

export function WelcomeStep({
  onGetStarted,
  onSignIn,
}: {
  onGetStarted: () => void;
  onSignIn: () => void;
}) {
  const { theme } = useAppTheme();
  const { reduceMotion } = useOnboardingMotion();
  const insets = useSafeAreaInsets();
  const styles = createStyles(theme);

  // The mark resolves as the thread passes through its centre.
  const logo = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    logo.value = withDelay(
      THREAD_DELAY + MOTION.welcomeDrawMs * 0.36,
      withSpring(1, { damping: 15, stiffness: 120 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logo.value,
    transform: [{ scale: interpolate(logo.value, [0, 1], [0.86, 1]) }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: logo.value,
    transform: [{ scale: interpolate(logo.value, [0, 1], [0.5, 1]) }],
  }));

  const copyDelay = reduceMotion ? 0 : THREAD_DELAY + MOTION.welcomeDrawMs * 0.55;

  return (
    <View style={styles.root}>
      <LinearGradient
        pointerEvents="none"
        colors={[theme.heroGradient[theme.heroGradient.length - 1], theme.background]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.7 }}
        style={styles.topWash}
      />

      <View style={[styles.content, { paddingTop: insets.top + SPACE.md, paddingBottom: insets.bottom + SPACE.lg }]}>
        <Reveal>
          <Text style={[TYPE.eyebrow, { color: theme.muted }]}>BRANDTHREAD</Text>
        </Reveal>

        {/* Hero: the thread sews through the mark. */}
        <View style={styles.hero}>
          <ThreadDraw
            height={HERO_HEIGHT}
            color={theme.text}
            delay={THREAD_DELAY}
            style={styles.heroThread}
          />
          <Animated.View pointerEvents="none" style={[styles.heroGlow, glowStyle]}>
            <Glow size={LOGO_SIZE * 3} color={theme.text} intensity={0.13} />
          </Animated.View>
          <Animated.View style={logoStyle}>
            <BrandthreadLogo size={LOGO_SIZE} />
          </Animated.View>
        </View>

        <View style={styles.copy}>
          <StepHeadline size="display" delay={copyDelay}>
            Where brands{'\n'}find their{'\n'}people.
          </StepHeadline>
        </View>

        <Reveal delay={copyDelay} index={3} style={styles.ctas}>
          <PillButton
            testID="onboarding-welcome-get-started"
            accessibilityLabel="Get started"
            label="Get started"
            haptic={false}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onGetStarted(); }}
          />
          <PillButton
            testID="onboarding-welcome-sign-in"
            accessibilityLabel="I already have an account"
            label="I already have an account"
            variant="secondary"
            haptic={false}
            onPress={() => { Haptics.selectionAsync(); onSignIn(); }}
          />
        </Reveal>
      </View>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, overflow: 'hidden' },
  topWash: { position: 'absolute', top: 0, left: 0, right: 0, height: '60%', opacity: 0.9 },
  content: { flex: 1, paddingHorizontal: SPACE.lg },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: HERO_HEIGHT },
  // Full-bleed: cancel the content gutter so the thread runs edge to edge.
  heroThread: { position: 'absolute', left: -SPACE.lg, right: -SPACE.lg, top: '50%', marginTop: -HERO_HEIGHT / 2 },
  heroGlow: { position: 'absolute', width: LOGO_SIZE * 3, height: LOGO_SIZE * 3 },
  copy: { marginBottom: SPACE.xl },
  ctas: { width: '100%', gap: SPACE.sm },
});
