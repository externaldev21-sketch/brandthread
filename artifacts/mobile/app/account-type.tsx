import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { PillButton, PressableScale, Reveal, StepHeadline, StepSub, StitchAccent } from '@/components/onboarding/OnboardingUI';
import { RADIUS, SPACE, TYPE } from '@/components/onboarding/onboardingTokens';

const getCards = (theme: AppThemePreset): {
  type: AccountType;
  icon: 'shopping-bag' | 'star';
  title: string;
  description: string;
  bullets: string[];
  accent: string;
}[] => [
  {
    type: 'buyer',
    icon: 'shopping-bag',
    title: "I'm here to shop",
    description: 'Discover brands, watch content and buy products directly from the Thread.',
    bullets: [
      'Discover emerging brands',
      'Shop exclusive drops',
      'Save & follow collections',
      'Track your orders',
    ],
    accent: theme.accent,
  },
  {
    type: 'seller',
    icon: 'star',
    title: "I'm building a brand",
    description:
      'Design, manufacture, launch, sell and manage everything in one workspace.',
    bullets: [
      'AI-powered design studio',
      'Global manufacturer network',
      'Launch your storefront',
      'Analytics & growth tools',
    ],
    accent: theme.secondary,
  },
];

export type AccountType = 'buyer' | 'seller';

export function AccountTypeStep({
  selected,
  onSelect,
  onContinue,
  saving = false,
  embedded = false,
}: {
  selected: AccountType | null;
  onSelect: (type: AccountType) => void;
  onContinue: () => void;
  saving?: boolean;
  embedded?: boolean;
}) {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const cards = React.useMemo(() => getCards(theme), [theme]);
  const insets  = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: embedded ? 0 : insets.top }]}>
      <StatusBar barStyle="light-content" />

      {/* Header — one question, left-aligned */}
      <View style={styles.header}>
        <StepHeadline>Are you a buyer{'\n'}or a seller?</StepHeadline>
        <StepSub>Choose your path so we can personalize your first experience.</StepSub>
      </View>

      {/* Cards */}
      <ScrollView
        contentContainerStyle={[styles.cards, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        {cards.map((c, index) => {
          const isSelected = selected === c.type;
          return (
            <Reveal key={c.type} index={index + 2}>
              <PressableScale
                testID={`onboarding-account-type-${c.type}`}
                accessibilityLabel={`${c.type === 'buyer' ? 'Buyer' : 'Seller'} account type`}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  onSelect(c.type);
                  Haptics.selectionAsync();
                }}
                style={[
                  styles.card,
                  isSelected && { borderColor: theme.text, borderWidth: 1 },
                ]}
              >
                <StitchAccent active={isSelected} color={theme.text} style={styles.cardStitch} />

                {/* Icon + title + radio */}
                <View style={styles.cardTop}>
                  <View style={[styles.iconWrap, isSelected && { borderColor: theme.text }]}>
                    <Feather name={c.icon} size={20} color={isSelected ? theme.text : theme.muted} />
                  </View>
                  <View style={styles.cardTitleWrap}>
                    <Text style={[styles.cardKicker, { color: isSelected ? theme.text : theme.subtle }]}>
                      {c.type === 'buyer' ? 'Explore' : 'Create'}
                    </Text>
                    <Text style={styles.cardTitle}>{c.title}</Text>
                  </View>
                  <View style={[styles.radio, isSelected && { borderColor: theme.text }]}>
                    {isSelected ? <View style={[styles.radioDot, { backgroundColor: theme.text }]} /> : null}
                  </View>
                </View>
                <Text style={styles.cardDesc}>{c.description}</Text>

                {/* Benefits */}
                <View style={styles.bullets}>
                  {c.bullets.map((b) => (
                    <View key={b} style={styles.bulletRow}>
                      <Feather name="check" size={12} color={isSelected ? theme.text : theme.subtle} />
                      <Text style={[styles.bulletText, isSelected && { color: theme.text }]}>{b}</Text>
                    </View>
                  ))}
                </View>
              </PressableScale>
            </Reveal>
          );
        })}
      </ScrollView>

      {/* Sticky footer CTA — disabled until a path is chosen */}
      <LinearGradient
        colors={[`${theme.background}00`, theme.background, theme.background]}
        locations={[0, 0.45, 1]}
        style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}
      >
        <PillButton
          testID="onboarding-account-type-continue"
          accessibilityLabel="Continue from account type"
          label={selected && saving ? 'Loading…' : 'Continue'}
          onPress={onContinue}
          disabled={!selected || saving}
          haptic={false}
        />
      </LinearGradient>
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

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  root:  { flex: 1, backgroundColor: theme.background },
  header: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.lg, paddingBottom: SPACE.lg },

  cards: { paddingHorizontal: SPACE.lg, gap: SPACE.sm },
  card: {
    backgroundColor: theme.card,
    borderRadius: RADIUS.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: SPACE.md + 2,
    overflow: 'hidden',
  },
  cardStitch: { position: 'absolute', top: 10, left: SPACE.md + 2 },
  cardTop: { flexDirection: 'row', gap: SPACE.sm, alignItems: 'center', marginBottom: SPACE.xs },
  iconWrap: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardTitleWrap: { flex: 1 },
  cardKicker: { ...TYPE.eyebrow, marginBottom: 2 },
  cardTitle: { fontSize: 20, lineHeight: 24, fontFamily: 'Inter_700Bold', color: theme.text, letterSpacing: -0.4 },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  cardDesc:  { ...TYPE.body, color: theme.muted, marginBottom: SPACE.sm },

  bullets:   { flexDirection: 'row', flexWrap: 'wrap', rowGap: SPACE.xs, columnGap: SPACE.md },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '46%' },
  bulletText:{ flex: 1, ...TYPE.label, color: theme.muted },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingTop: SPACE.xxl, paddingHorizontal: SPACE.lg,
  },
});
