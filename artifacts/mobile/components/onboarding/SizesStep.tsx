/**
 * Buyer onboarding — optional "Your sizes" step (between Style and Brands).
 * Tap a size to pick it, tap again to clear. Choices are held in onboarding
 * state and saved into buyer_preferences after auth (lib/onboardingSurvey.ts),
 * so My sizes and size recommendations start pre-filled. Layout follows
 * Depop's "Interests and sizes": a section heading per category with chips.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SURVEY_SIZE_CATEGORIES, toggleSize, type OnboardingSurvey } from '@/lib/onboardingSurvey';
import type { SizeCategory } from '@/lib/sizeRecommendation';
import { PressableScale, Reveal, StepHeadline, StepSub } from './OnboardingUI';
import { RADIUS, SPACE, TYPE } from './onboardingTokens';

interface Props {
  sizes: OnboardingSurvey['sizes'];
  onChange: (next: OnboardingSurvey['sizes']) => void;
}

export function SizesStep({ sizes, onChange }: Props) {
  const { theme } = useAppTheme();
  const styles = createStyles(theme);

  function pick(key: SizeCategory, value: string) {
    Haptics.selectionAsync();
    onChange(toggleSize(sizes, key, value));
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <StepHeadline>What sizes{'\n'}do you wear?</StepHeadline>
      <StepSub>We will show the size that fits when you shop. Skip it and add sizes later.</StepSub>
      {SURVEY_SIZE_CATEGORIES.map(({ key, label, options }, i) => (
        <Reveal key={key} index={i + 2} style={styles.section}>
          <Text style={styles.sectionTitle}>{label}</Text>
          <View style={styles.grid}>
            {options.map((option) => {
              const selected = sizes[key] === option;
              return (
                <PressableScale
                  key={option}
                  testID={`onboarding-size-${key}-${option}`}
                  style={[styles.chip, selected && { backgroundColor: theme.accentDim, borderColor: theme.text, borderWidth: 1 }]}
                  accessibilityRole="radio"
                  accessibilityLabel={`${label} size ${option}`}
                  accessibilityState={{ selected }}
                  onPress={() => pick(key, option)}
                >
                  <Text style={[styles.chipText, selected && { color: theme.text }]}>{option}</Text>
                  {selected && <Feather name="check" size={13} color={theme.text} />}
                </PressableScale>
              );
            })}
          </View>
        </Reveal>
      ))}
    </ScrollView>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  scroll: { flexGrow: 1, paddingTop: SPACE.xs, paddingBottom: SPACE.xxl },
  section: { marginTop: SPACE.lg },
  sectionTitle: { ...TYPE.label, color: theme.text, fontFamily: 'Inter_600SemiBold', marginBottom: SPACE.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs },
  chip: {
    width: '31.5%', minHeight: 44, borderRadius: RADIUS.pill, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  chipText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: theme.muted },
});
