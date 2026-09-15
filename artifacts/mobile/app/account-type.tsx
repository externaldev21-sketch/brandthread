import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { getOnAccentTextStyle, useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';

const BG     = '#0A0A0B';
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

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerText}>
           <Text style={styles.headline}>Are you a buyer{'\n'}or a seller?</Text>
          <Text style={styles.subtext}>
             Choose your path so we can personalize your first experience.
          </Text>
        </View>
      </View>

      {/* Cards */}
      <ScrollView
        contentContainerStyle={[styles.cards, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        {cards.map((c) => {
          const isSelected = selected === c.type;
          return (
            <TouchableOpacity
              key={c.type}
              testID={`onboarding-account-type-${c.type}`}
              accessibilityLabel={`${c.type === 'buyer' ? 'Buyer' : 'Seller'} account type`}
              activeOpacity={0.85}
              onPress={() => {
                onSelect(c.type);
                Haptics.selectionAsync();
              }}
            >
              <View style={[
                styles.card,
                isSelected && {
                  borderColor: c.accent,
                  borderWidth: 1.5,
                  shadowColor: c.accent,
                  shadowOpacity: 0.3,
                  shadowRadius: 16,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 10,
                },
              ]}>
                <LinearGradient
                  colors={[c.accent, `${c.accent}00`]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.cardAccent}
                />
                {/* Check badge */}
                {isSelected && (
                  <View style={[styles.checkBadge, { backgroundColor: c.accent }]}>
                    <Feather name="check" size={13} color={theme.onAccent} />
                  </View>
                )}

                {/* Icon + title */}
                <View style={styles.cardTop}>
                  <LinearGradient
                    colors={[`${c.accent}38`, `${c.accent}0D`]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.iconWrap}
                  >
                    <Feather name={c.icon} size={23} color={c.accent} />
                  </LinearGradient>
                  <View style={styles.cardTitleWrap}>
                    <Text style={[styles.cardKicker, { color: c.accent }]}>
                      {c.type === 'buyer' ? 'EXPLORE' : 'CREATE'}
                    </Text>
                    <Text style={styles.cardTitle}>{c.title}</Text>
                    <Text style={styles.cardDesc}>{c.description}</Text>
                  </View>
                </View>

                {/* Benefits */}
                <View style={styles.bullets}>
                  {c.bullets.map((b) => (
                    <View key={b} style={styles.bulletRow}>
                      <View style={[styles.bulletIcon, { borderColor: isSelected ? `${c.accent}B0` : 'rgba(255,255,255,0.2)' }]}>
                        <Feather name="check" size={10} color={isSelected ? c.accent : 'rgba(255,255,255,0.42)'} />
                      </View>
                      <Text style={styles.bulletText}>{b}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Footer CTA */}
      <LinearGradient
        colors={['rgba(7,7,15,0)', 'rgba(7,7,15,1)']}
        style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}
      >
        <TouchableOpacity
          testID="onboarding-account-type-continue"
          accessibilityLabel="Continue from account type"
          activeOpacity={0.88}
          onPress={onContinue}
          disabled={!selected || saving}
        >
          {selected ? (
            <LinearGradient
              colors={theme.primaryGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.continueBtn}
            >
              <Text style={[styles.continueBtnText, getOnAccentTextStyle(theme)]}>
                {saving ? 'Loading…' : 'Continue'}
              </Text>
            </LinearGradient>
          ) : (
            <View style={[styles.continueBtn, styles.continueBtnDisabled]}>
              <Text style={[styles.continueBtnText, { color: 'rgba(255,255,255,0.3)' }]}>
                Continue
              </Text>
            </View>
          )}
        </TouchableOpacity>
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
  root:  { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  headerText: { gap: 6 },
  headline: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.8,
    lineHeight: 38,
  },
  subtext: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 21,
  },

  cards: { paddingHorizontal: 20, paddingTop: 6, gap: 12 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.09)',
    padding: 18,
    overflow: 'hidden',
  },
  cardAccent: {
    position: 'absolute',
    top: 0,
    left: 18,
    width: 80,
    height: 2,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  checkBadge: {
    position: 'absolute',
    top: 14, right: 14,
    width: 24, height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTop: { flexDirection: 'row', gap: 12, marginBottom: 16, alignItems: 'flex-start' },
  iconWrap: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardTitleWrap: { flex: 1, paddingTop: 1 },
  cardKicker: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.8, marginBottom: 3 },
  cardTitle: { fontSize: 19, fontFamily: 'Inter_700Bold', color: '#FFFFFF', marginBottom: 4, letterSpacing: -0.3 },
  cardDesc:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.55)', lineHeight: 18 },

  bullets:   { gap: 9, paddingTop: 2 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  bulletIcon: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  bulletText:{ flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.68)' },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingTop: 28, paddingHorizontal: 20,
  },
  continueBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  continueBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  continueBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
});
