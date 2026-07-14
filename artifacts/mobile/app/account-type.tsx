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
  icon: string;
  title: string;
  description: string;
  bullets: string[];
  accent: string;
}[] = [
  {
    type: 'buyer',
    icon: '🛍',
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
    icon: '✦',
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

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => { Haptics.selectionAsync(); router.back(); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="chevron-left" size={22} color="rgba(255,255,255,0.5)" />
        </TouchableOpacity>
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
                {/* Check badge */}
                {isSelected && (
                  <View style={[styles.checkBadge, { backgroundColor: c.accent }]}>
                    <Feather name="check" size={13} color="#FFF" />
                  </View>
                )}

                {/* Icon + title */}
                <View style={styles.cardTop}>
                  <View style={[styles.iconWrap, { backgroundColor: c.accent + '18' }]}>
                    <Text style={styles.cardIcon}>{c.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{c.title}</Text>
                    <Text style={styles.cardDesc}>{c.description}</Text>
                  </View>
                </View>

                {/* Bullets */}
                <View style={styles.bullets}>
                  {c.bullets.map((b) => (
                    <View key={b} style={styles.bulletRow}>
                      <View style={[styles.bullet, { backgroundColor: isSelected ? c.accent : 'rgba(255,255,255,0.25)' }]} />
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
        <Text style={styles.footerNote}>You can change this later in Settings.</Text>

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

  header: { paddingHorizontal: 20, paddingBottom: 16 },
  backBtn: { width: 40, height: 40, justifyContent: 'center', marginBottom: 8 },
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
  },
  checkBadge: {
    position: 'absolute',
    top: 16, right: 16,
    width: 26, height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTop: { flexDirection: 'row', gap: 14, marginBottom: 16, alignItems: 'flex-start' },
  iconWrap: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardIcon:  { fontSize: 22 },
  cardTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#FFFFFF', marginBottom: 4 },
  cardDesc:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.55)', lineHeight: 18 },

  bullets:   { gap: 8 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bullet:    { width: 5, height: 5, borderRadius: 3 },
  bulletText:{ fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.6)' },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingTop: 32, paddingHorizontal: 20,
  },
  footerNote: {
    textAlign: 'center',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.3)',
    marginBottom: 12,
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
