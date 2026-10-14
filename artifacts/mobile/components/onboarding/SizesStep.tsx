/**
 * Buyer onboarding — "Your sizes": tops, bottoms and shoes as square chips.
 * Tap a size to pick it, tap again to clear. Saved into buyer_preferences
 * after the account exists (lib/onboardingSurvey.ts), so My sizes and size
 * recommendations start filled in. Optional: NEXT reads SKIP until a size is
 * picked. (Outerwear stays in the saved shape but isn't asked here — it
 * repeats the tops scale.)
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SURVEY_SIZE_CATEGORIES, hasSurveyAnswers, toggleSize, type OnboardingSurvey } from '@/lib/onboardingSurvey';
import type { SizeCategory } from '@/lib/sizeRecommendation';
import { Body, Headline, ONB_TYPE, SquareButton, SquareChip, StepScreen, useKitTheme } from './kit';

export const ASKED_SIZE_CATEGORIES: SizeCategory[] = ['tops', 'bottoms', 'shoes'];

interface Props {
  counter: { current: number; total: number } | null;
  sizes: OnboardingSurvey['sizes'];
  onChange: (next: OnboardingSurvey['sizes']) => void;
  onNext: () => void;
}

export function SizesStep({ counter, sizes, onChange, onNext }: Props) {
  const theme = useKitTheme();
  const picked = hasSurveyAnswers({ sizes, likedBrandIds: [] });

  function pick(key: SizeCategory, value: string) {
    void Haptics.selectionAsync().catch(() => {});
    onChange(toggleSize(sizes, key, value));
  }

  return (
    <StepScreen
      counter={counter}
      testID="onboarding-sizes"
      footer={<SquareButton testID="onboarding-next" label={picked ? 'Next' : 'Skip'} onPress={onNext} />}
    >
      <Headline>Your sizes</Headline>
      <Body>We'll show what fits first.</Body>
      {SURVEY_SIZE_CATEGORIES.filter((c) => ASKED_SIZE_CATEGORIES.includes(c.key)).map(({ key, label, options }) => (
        <View key={key} style={styles.section}>
          <Text style={[ONB_TYPE.caps, { color: theme.muted, marginBottom: 12 }]}>{label.toUpperCase()}</Text>
          <View style={styles.grid}>
            {options.map((option) => (
              <SquareChip
                key={option}
                testID={`onboarding-size-${key}-${option}`}
                accessibilityLabel={`${label} size ${option}`}
                label={option}
                selected={sizes[key] === option}
                onPress={() => pick(key, option)}
                style={styles.cell}
              />
            ))}
          </View>
        </View>
      ))}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 28 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '31.6%' },
});
