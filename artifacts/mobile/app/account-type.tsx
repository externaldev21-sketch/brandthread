import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Button } from '@/components/ui';
import { ChoiceCard, type ChoiceOption } from '@/components/onboarding/steps/SellerSteps';
import { useColors } from '@/hooks/useColors';
import { FILL_ELEVATED, TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';

/**
 * The first onboarding question: buyer or seller. Same card pattern as the
 * seller questions (Shopify's onboarding): radio, icon, title, one line.
 * Buyer and seller accounts are separate; a person can hold both.
 */
const OPTIONS: (ChoiceOption & { value: AccountType })[] = [
  {
    value: 'buyer',
    icon: 'shopping-bag',
    label: "I'm here to shop",
    description: 'Discover brands, watch content and buy from the Thread.',
  },
  {
    value: 'seller',
    icon: 'scissors',
    label: "I'm building a brand",
    description: 'Design, make, sell and run your brand in one workspace.',
  },
];

export type AccountType = 'buyer' | 'seller';

export function AccountTypeStep({
  selected,
  onSelect,
  onContinue,
  saving = false,
}: {
  selected: AccountType | null;
  onSelect: (type: AccountType) => void;
  onContinue: () => void;
  saving?: boolean;
  /** Kept for callers; the step always renders inside the onboarding shell. */
  embedded?: boolean;
}) {
  const palette = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>Are you a buyer or a seller?</Text>
        <Text style={[styles.subtitle, { color: palette.mutedForeground }]}>
          Buyer and seller accounts are separate. You can have both.
        </Text>
        <View style={styles.cards}>
          {OPTIONS.map((option) => (
            <ChoiceCard
              key={option.value}
              testID={`onboarding-account-type-${option.value}`}
              option={option}
              multi={false}
              selected={selected === option.value}
              onPress={() => { Haptics.selectionAsync(); onSelect(option.value); }}
            />
          ))}
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, SPACING.md) }]}>
        <Button
          testID="onboarding-account-type-continue"
          accessibilityLabel="Continue from account type"
          label="Next"
          onPress={onContinue}
          disabled={!selected || saving}
          loading={!!selected && saving}
          fullWidth
          style={!selected ? styles.disabledFill : undefined}
        />
      </View>
    </View>
  );
}

export default function AccountTypeScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/onboarding' as never);
  }, [router]);

  return <View style={{ flex: 1, backgroundColor: 'transparent' }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingTop: SPACING.sm, paddingBottom: SPACING.xl },
  title: { ...TEXT.title1 },
  subtitle: { ...TEXT.subhead, marginTop: SPACING.sm },
  cards: { gap: SPACING.sm, marginTop: SPACING.xl },
  footer: { paddingTop: SPACING.xs },
  disabledFill: { backgroundColor: FILL_ELEVATED },
});
