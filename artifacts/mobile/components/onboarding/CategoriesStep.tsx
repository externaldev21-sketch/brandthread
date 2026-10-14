/**
 * Seller onboarding — "What do you sell?": square chips, pick any. Saved as
 * the store's brand type (PATCH /api/auth/onboarding `brandType`), the same
 * free-text field discover already returns. Optional: SKIP until one is
 * picked.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Body, Headline, SquareButton, SquareChip, StepScreen } from './kit';

export const SELL_CATEGORIES = [
  'Tops', 'Bottoms', 'Outerwear',
  'Knitwear', 'Footwear', 'Headwear',
  'Bags', 'Accessories', 'Jewelry',
] as const;

/** The stored brand type: picked categories in display order, comma separated. */
export function brandTypeFor(categories: string[]): string {
  return SELL_CATEGORIES.filter((c) => categories.includes(c)).join(', ');
}

export function CategoriesStep({
  counter,
  categories,
  onChange,
  onNext,
  busy,
}: {
  counter: { current: number; total: number } | null;
  categories: string[];
  onChange: (next: string[]) => void;
  onNext: () => void;
  busy?: boolean;
}) {
  return (
    <StepScreen
      counter={counter}
      testID="onboarding-categories"
      footer={(
        <SquareButton
          testID="onboarding-next"
          label={categories.length > 0 ? 'Next' : 'Skip'}
          loading={busy}
          onPress={onNext}
        />
      )}
    >
      <Headline>What do you sell?</Headline>
      <Body>Pick all that apply. Buyers browse by these.</Body>
      <View style={styles.grid}>
        {SELL_CATEGORIES.map((c) => (
          <SquareChip
            key={c}
            testID={`onboarding-category-${c}`}
            label={c}
            selected={categories.includes(c)}
            style={styles.cell}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => {});
              onChange(categories.includes(c) ? categories.filter((v) => v !== c) : [...categories, c]);
            }}
          />
        ))}
      </View>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 28 },
  cell: { width: '31.6%' },
});
