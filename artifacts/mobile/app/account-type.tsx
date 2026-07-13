import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, useColorScheme,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_KEY } from './_layout';

type AccountType = 'buyer' | 'seller';

const CARDS: {
  type: AccountType;
  emoji: string;
  title: string;
  description: string;
  features: string[];
  accent: string;
}[] = [
  {
    type: 'buyer',
    emoji: '🛍️',
    title: 'Buyer',
    description: 'Discover brands, shop products, save inspiration, and manage your purchases.',
    features: ['Discover clothing brands', 'Browse & shop drops', 'Save moodboards', 'Track orders'],
    accent: '#00C853',
  },
  {
    type: 'seller',
    emoji: '🏷️',
    title: 'Seller',
    description: 'Build, operate, launch, and grow your own clothing brand.',
    features: ['Design products & tech packs', 'Find manufacturers', 'Manage your storefront', 'Track sales & analytics'],
    accent: '#4A90E2',
  },
];

export default function AccountTypeScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const scheme  = useColorScheme();
  const isDark  = scheme !== 'light';

  const [selected, setSelected] = useState<AccountType | null>(null);
  const [saving, setSaving]     = useState(false);

  const bg   = isDark ? '#0E0E0E' : '#F5F5F5';
  const card = isDark ? '#1A1A1A' : '#FFFFFF';
  const fg   = isDark ? '#FFFFFF' : '#0A0A0A';
  const muted = isDark ? '#888' : '#666';
  const border = isDark ? '#2A2A2A' : '#E0E0E0';

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
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <Text style={[styles.eyebrow, { color: '#00C853' }]}>HOW WILL YOU USE BRANDTHREAD?</Text>
        <Text style={[styles.headline, { color: fg }]}>Choose your{'\n'}experience.</Text>
        <Text style={[styles.subtext, { color: muted }]}>
          Your choice personalizes your tools, navigation, and dashboard. You can change this later.
        </Text>
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
                { backgroundColor: card, borderColor: isSelected ? c.accent : border },
                isSelected && { borderWidth: 2, shadowColor: c.accent, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
                !isSelected && { borderWidth: 1 },
              ]}>
                {/* Card header */}
                <View style={styles.cardTop}>
                  <View style={[styles.cardIconWrap, { backgroundColor: c.accent + '22' }]}>
                    <Text style={styles.cardEmoji}>{c.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: fg }]}>{c.title}</Text>
                    <Text style={[styles.cardDesc, { color: muted }]}>{c.description}</Text>
                  </View>
                  {isSelected && (
                    <View style={[styles.checkWrap, { backgroundColor: c.accent }]}>
                      <Feather name="check" size={14} color="#FFF" />
                    </View>
                  )}
                </View>

                {/* Features */}
                <View style={styles.features}>
                  {c.features.map((f) => (
                    <View key={f} style={styles.featureRow}>
                      <View style={[styles.featureDot, { backgroundColor: c.accent }]} />
                      <Text style={[styles.featureText, { color: muted }]}>{f}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Footer */}
      <LinearGradient
        colors={isDark ? ['#0E0E0E00', '#0E0E0EFF'] : ['#F5F5F500', '#F5F5F5FF']}
        style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}
      >
        <Text style={[styles.footerHint, { color: muted }]}>You can change this later in Settings.</Text>
        <TouchableOpacity
          style={[
            styles.continueBtn,
            { backgroundColor: selected ? '#00C853' : border },
          ]}
          onPress={handleContinue}
          disabled={!selected || saving}
          activeOpacity={0.85}
        >
          <Text style={[styles.continueBtnText, { color: selected ? '#021208' : muted }]}>
            {saving ? 'Saving…' : 'Continue'}
          </Text>
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1 },
  header:  { paddingHorizontal: 24, paddingBottom: 20 },
  eyebrow: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.5, marginBottom: 10 },
  headline: { fontSize: 36, fontFamily: 'Inter_700Bold', letterSpacing: -1, lineHeight: 42, marginBottom: 10 },
  subtext:  { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21 },

  cards: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },

  card: { borderRadius: 20, padding: 20 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 16 },
  cardIconWrap: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardEmoji: { fontSize: 24 },
  cardTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  cardDesc:  { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  checkWrap: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  features:    { gap: 8 },
  featureRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureDot:  { width: 5, height: 5, borderRadius: 3 },
  featureText: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingTop: 32, paddingHorizontal: 24,
  },
  footerHint: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', marginBottom: 12 },
  continueBtn: {
    borderRadius: 16, paddingVertical: 16, alignItems: 'center',
  },
  continueBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
});
