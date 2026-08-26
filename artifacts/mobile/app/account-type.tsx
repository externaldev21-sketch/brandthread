import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_KEY } from './_layout';

type AccountType = 'buyer' | 'seller';

const BG     = '#07070F';
const PURPLE = '#8B5CF6';
const CYAN   = '#22D3EE';

const CARDS: {
  type: AccountType;
  icon: 'shopping-bag' | 'star';
  title: string;
  description: string;
  bullets: string[];
  accent: string;
}[] = [
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
    accent: PURPLE,
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
    accent: CYAN,
  },
];

export default function AccountTypeScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  const [selected, setSelected] = useState<AccountType | null>(null);
  const [saving, setSaving]     = useState(false);

  const handleContinue = async () => {
    if (!selected || saving) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await AsyncStorage.multiSet([
      ['user_role', selected],
      [ONBOARDING_KEY, 'false'],
    ]);
    router.replace('/onboarding' as never);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      {/* Ambient glow */}
      <View style={styles.glow} />
      <View style={styles.glowSecondary} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.headline}>How will you use{'\n'}Brandthread?</Text>
          <Text style={styles.subtext}>
            You can explore both sides later. We'll personalize your first experience now.
          </Text>
        </View>
      </View>

      {/* Cards */}
      <ScrollView
        contentContainerStyle={[styles.cards, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        {CARDS.map((c) => {
          const isSelected = selected === c.type;
          return (
            <TouchableOpacity
              key={c.type}
              activeOpacity={0.85}
              onPress={() => {
                setSelected(c.type);
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
                    <Feather name="check" size={13} color="#FFF" />
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
          activeOpacity={0.88}
          onPress={handleContinue}
          disabled={!selected || saving}
        >
          {selected ? (
            <LinearGradient
              colors={[PURPLE, CYAN]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.continueBtn}
            >
              <Text style={styles.continueBtnText}>
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

const styles = StyleSheet.create({
  root:  { flex: 1, backgroundColor: BG },
  glow: {
    position: 'absolute', top: -60, left: '10%',
    width: '80%', height: 220, borderRadius: 150,
    backgroundColor: '#8B5CF612',
  },
  glowSecondary: {
    position: 'absolute', top: 260, right: -100,
    width: 240, height: 240, borderRadius: 140,
    backgroundColor: '#22D3EE0A',
  },

  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerText: { gap: 8 },
  headline: {
    fontSize: 34,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.8,
    lineHeight: 40,
  },
  subtext: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 21,
  },

  cards: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    padding: 20,
    overflow: 'hidden',
  },
  cardAccent: {
    position: 'absolute',
    top: 0,
    left: 20,
    width: 92,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  checkBadge: {
    position: 'absolute',
    top: 16, right: 16,
    width: 26, height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTop: { flexDirection: 'row', gap: 14, marginBottom: 18, alignItems: 'flex-start' },
  iconWrap: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardTitleWrap: { flex: 1, paddingTop: 1 },
  cardKicker: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.8, marginBottom: 4 },
  cardTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#FFFFFF', marginBottom: 5, letterSpacing: -0.3 },
  cardDesc:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.55)', lineHeight: 18 },

  bullets:   { gap: 10, paddingTop: 2 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulletIcon: {
    width: 19, height: 19, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  bulletText:{ flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.68)' },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingTop: 32, paddingHorizontal: 20,
  },
  continueBtn: {
    borderRadius: 16,
    paddingVertical: 17,
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
