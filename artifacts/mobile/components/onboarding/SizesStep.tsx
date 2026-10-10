/**
 * Buyer onboarding — optional "Your sizes" step (between Style and Brands).
 * Renders the size sections only; the title, subtitle and buttons come from
 * the shared onboarding StepScreen so every step lines up.
 * Tap a size to pick it, tap again to clear. Choices are held in onboarding
 * state and saved into buyer_preferences after auth (lib/onboardingSurvey.ts),
 * so My sizes and size recommendations start pre-filled. Layout follows
 * Depop's "Interests and sizes": a section heading per category with chips.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SURVEY_SIZE_CATEGORIES, toggleSize, type OnboardingSurvey } from '@/lib/onboardingSurvey';
import type { SizeCategory } from '@/lib/sizeRecommendation';
import { SPACE } from './onboardingTokens';
import { FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';
import { radius } from '@/constants/radii';

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
    <View>
      {SURVEY_SIZE_CATEGORIES.map(({ key, label, options }, i) => (
        <View key={key} style={i === 0 ? undefined : styles.section}>
          <Text style={styles.sectionTitle}>{label}</Text>
          <View style={styles.grid}>
            {options.map((option) => {
              const selected = sizes[key] === option;
              return (
                <View key={option} style={styles.cell}>
                <Pressable
                  testID={`onboarding-size-${key}-${option}`}
                  style={[styles.chip, selected && { borderColor: theme.text }]}
                  accessibilityRole="radio"
                  accessibilityLabel={`${label} size ${option}`}
                  accessibilityState={{ selected }}
                  onPress={() => pick(key, option)}
                >
                  <Text style={[styles.chipText, selected && { color: theme.text }]}>{option}</Text>
                </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  section: { marginTop: SPACE.lg },
  sectionTitle: { ...TEXT.headline, color: theme.text, marginBottom: SPACE.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs },
  cell: { width: '31.5%' },
  chip: {
    width: '100%', minHeight: 44, borderRadius: radius.md, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: FILL_ELEVATED, borderWidth: 1, borderColor: 'transparent',
  },
  chipText: { fontSize: 15, fontFamily: FONT.medium, color: theme.muted, fontVariant: ['tabular-nums'] },
});
