import React, { useState, useEffect, useRef } from 'react';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { loadDraftAnswers, generateStoreFromAnswers, applyGenerationResult, clearDraftAnswers } from '@/services/storeService';
import { StoreGenerationAnswers } from '@/services/storeTypes';

const GEN_STEPS = [
  { icon: 'eye',          label: 'Reading your brand identity',   duration: 800 },
  { icon: 'layout',       label: 'Building homepage',             duration: 700 },
  { icon: 'menu',         label: 'Designing navigation',          duration: 500 },
  { icon: 'grid',         label: 'Creating collections',          duration: 600 },
  { icon: 'shopping-bag', label: 'Styling product pages',         duration: 600 },
  { icon: 'smartphone',   label: 'Optimizing mobile',             duration: 500 },
  { icon: 'trending-up',  label: 'Adding conversion tools',       duration: 500 },
  { icon: 'video',        label: 'Connecting Seller content',     duration: 600 },
  { icon: 'check-circle', label: 'Finalizing your storefront',    duration: 800 },
] as const;

export default function StoreGeneratingScreen() {
  const { theme } = useAppTheme();
  const gen = makeStyles(theme);
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const spinAnim = useRef(new Animated.Value(0)).current;
  const stepFadeAnim = useRef(new Animated.Value(0)).current;
  const stepsCompleteRef = useRef(false);
  const serviceCompleteRef = useRef(false);
  const navigatedRef = useRef(false);

  // Spinner rotation loop
  useEffect(() => {
    const spinLoop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spinLoop.start();
    return () => spinLoop.stop();
  }, []);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Fade in step label
  useEffect(() => {
    stepFadeAnim.setValue(0);
    Animated.timing(stepFadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [currentStep]);

  const tryNavigate = () => {
    if (stepsCompleteRef.current && serviceCompleteRef.current && !navigatedRef.current) {
      navigatedRef.current = true;
      router.replace('/store-editor' as never);
    }
  };

  const runGeneration = async () => {
    setError(null);
    stepsCompleteRef.current = false;
    serviceCompleteRef.current = false;
    navigatedRef.current = false;
    setCurrentStep(0);
    setCompletedSteps([]);

    // Load answers — if the wizard's answers are missing, don't silently
    // substitute made-up defaults. Send the seller back to pick a style.
    let answers: StoreGenerationAnswers | null = null;
    try {
      const draft = await loadDraftAnswers();
      if (draft && draft.primaryStyle) answers = draft as StoreGenerationAnswers;
    } catch {
      answers = null;
    }
    if (!answers) {
      router.replace(('/store-generate?toast=' + encodeURIComponent("Let's pick your style first")) as never);
      return;
    }

    // Run service generation in parallel with animation
    const servicePromise = (async () => {
      try {
        const result = await generateStoreFromAnswers(answers);
        await applyGenerationResult(result);
        await clearDraftAnswers();
        serviceCompleteRef.current = true;
        tryNavigate();
      } catch (err) {
        setError('Generation failed. Please try again.');
      }
    })();

    // Run step animation loop
    const animPromise = (async () => {
      for (let i = 0; i < GEN_STEPS.length; i++) {
        setCurrentStep(i);
        await new Promise<void>(resolve => setTimeout(resolve, GEN_STEPS[i].duration));
        setCompletedSteps(prev => [...prev, i]);
      }
      stepsCompleteRef.current = true;
      tryNavigate();
    })();

    await Promise.all([servicePromise, animPromise]);
  };

  useEffect(() => {
    runGeneration();
  }, [retryCount]);

  const handleRetry = () => {
    setRetryCount(c => c + 1);
  };

  return (
    <View style={[gen.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <LinearGradient
        colors={[BG, SURFACE]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Back button — lets users cancel generation */}
      <TouchableOpacity
        onPress={() => router.back()}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.75}
        style={{ position: 'absolute', top: insets.top + 12, left: SP.md, width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
      >
        <Feather name="arrow-left" size={ICON.sm} color={FG} />
      </TouchableOpacity>

      <View style={gen.inner}>
        {/* Heading */}
        <Text style={gen.heading}>Building your storefront</Text>
        <Text style={gen.subheading}>This takes just a moment.</Text>

        {/* Spinner */}
        <View style={gen.spinnerWrap}>
          <Animated.View style={[gen.spinnerRing, { transform: [{ rotate: spin }] }]} />
          <View style={gen.spinnerIconCenter}>
            <Feather
              name={GEN_STEPS[Math.min(currentStep, GEN_STEPS.length - 1)].icon as any}
              size={ICON.lg}
              color={PURPLE}
            />
          </View>
        </View>

        {/* Current step label */}
        <Animated.Text style={[gen.currentStepLabel, { opacity: stepFadeAnim }]}>
          {GEN_STEPS[Math.min(currentStep, GEN_STEPS.length - 1)].label}
        </Animated.Text>

        {/* Step list */}
        <View style={gen.stepList}>
          {GEN_STEPS.map((genStep, idx) => {
            const isDone = completedSteps.includes(idx);
            const isCurrent = idx === currentStep && !isDone;
            const isUpcoming = !isDone && !isCurrent;

            return (
              <View key={idx} style={gen.stepRow}>
                <View style={gen.stepBullet}>
                  {isDone ? (
                    <Feather name="check" size={12} color={SUCCESS} />
                  ) : isCurrent ? (
                    <Animated.View style={[gen.activeDot, { opacity: stepFadeAnim }]} />
                  ) : (
                    <View style={gen.upcomingDot} />
                  )}
                </View>
                <Text style={[
                  gen.stepRowLabel,
                  isDone && gen.stepRowLabelDone,
                  isCurrent && gen.stepRowLabelCurrent,
                  isUpcoming && gen.stepRowLabelUpcoming,
                ]}>
                  {genStep.label}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Progress fraction */}
        <Text style={gen.progressText}>
          Step {Math.min(currentStep + 1, GEN_STEPS.length)} of {GEN_STEPS.length}
        </Text>

        {/* Error state */}
        {error && (
          <View style={gen.errorCard}>
            <Feather name="alert-circle" size={ICON.sm} color={RED} />
            <Text style={gen.errorText}>{error}</Text>
            <View
              style={gen.retryBtn}
              // TouchableOpacity would need import but we have View + pressable logic
            >
              <Text
                style={gen.retryText}
                onPress={handleRetry}
              >
                Try Again
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const PURPLE_DIM = theme.accentDim;
  const BORDER_ACTIVE = theme.accentLight;
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xl,
    gap: SP.md,
  },
  heading: {
    fontSize: 22,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  subheading: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    textAlign: 'center',
    marginBottom: SP.md,
  },
  // Spinner
  spinnerWrap: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.sm,
  },
  spinnerRing: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: PURPLE,
    borderTopColor: 'transparent',
  },
  spinnerIconCenter: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
  },
  currentStepLabel: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
    textAlign: 'center',
    marginBottom: SP.sm,
  },
  // Step list
  stepList: {
    width: '100%',
    gap: SP.xs,
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingVertical: SP.xs,
  },
  stepBullet: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PURPLE,
  },
  upcomingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: SUBTLE,
    borderWidth: 1,
    borderColor: BORDER,
  },
  stepRowLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    flex: 1,
  },
  stepRowLabelDone: {
    color: SUCCESS,
    fontFamily: FONT.medium,
  },
  stepRowLabelCurrent: {
    color: FG,
    fontFamily: FONT.semibold,
  },
  stepRowLabelUpcoming: {
    color: SUBTLE,
  },
  progressText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: SP.sm,
  },
  // Error
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    backgroundColor: RED_DIM,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: RED + '40',
    padding: SP.md,
    width: '100%',
    marginTop: SP.md,
  },
  errorText: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: RED,
  },
  retryBtn: {
    backgroundColor: RED + '30',
    borderRadius: RADIUS.sm,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  retryText: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: RED,
  },
  });
};
