/**
 * Account Type Settings — lets a user see their current account type
 * and request a switch between Buyer and Seller modes.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import {
  BG, CARD, BORDER, FG, MUTED, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';

type AccountType = 'seller' | 'buyer';

const ACCOUNT_INFO: Record<AccountType, { icon: keyof typeof Feather.glyphMap; color: string; title: string; bullets: string[] }> = {
  seller: {
    icon: 'shopping-bag',
    color: PURPLE,
    title: 'Seller',
    bullets: [
      'List products and collections',
      'Receive orders and payments',
      'Access analytics and insights',
      'Design studio and AI tools',
      'Brand storefront',
    ],
  },
  buyer: {
    icon: 'user',
    color: CYAN,
    title: 'Buyer',
    bullets: [
      'Browse seller storefronts',
      'Purchase products',
      'Follow sellers and friends',
      'Save and share items',
    ],
  },
};

export default function AccountTypeSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [currentType, setCurrentType] = useState<AccountType | null>(null);
  const [selectedType, setSelectedType] = useState<AccountType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.auth.getProfile()
      .then((profile: any) => {
        const t: AccountType = profile?.accountType === 'buyer' ? 'buyer' : 'seller';
        setCurrentType(t);
        setSelectedType(t);
      })
      .catch(() => {
        setCurrentType('seller');
        setSelectedType('seller');
      })
      .finally(() => setLoading(false));
  }, []);

  const isDirty = selectedType !== null && selectedType !== currentType;

  async function handleSave() {
    if (!selectedType || !isDirty) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      `Switch to ${ACCOUNT_INFO[selectedType].title}?`,
      'Switching account type will change the features available to you. You can switch back at any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            setSaving(true);
            try {
              await api.auth.updateProfile({ accountType: selectedType });
              setCurrentType(selectedType);
              Alert.alert(
                'Account type updated',
                `You are now a ${ACCOUNT_INFO[selectedType].title}. Restart the app to apply all changes.`,
                [{ text: 'OK', onPress: () => router.back() }],
              );
            } catch {
              Alert.alert('Error', 'Could not update account type. Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Account Type</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={PURPLE} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 60 }}>

          {/* Current badge */}
          {currentType && (
            <View style={s.currentBadge}>
              <Feather name={ACCOUNT_INFO[currentType].icon} size={ICON.sm} color={ACCOUNT_INFO[currentType].color} />
              <Text style={[s.currentBadgeText, { color: ACCOUNT_INFO[currentType].color }]}>
                Current: {ACCOUNT_INFO[currentType].title}
              </Text>
            </View>
          )}

          <Text style={s.sectionLabel}>Select account type</Text>

          {/* Type cards */}
          {(['seller', 'buyer'] as AccountType[]).map((type) => {
            const info = ACCOUNT_INFO[type];
            const isSelected = selectedType === type;
            const isCurrent = currentType === type;
            return (
              <TouchableOpacity
                key={type}
                style={[s.typeCard, isSelected && { borderColor: info.color, backgroundColor: info.color + '0D' }]}
                activeOpacity={0.8}
                onPress={() => { Haptics.selectionAsync(); setSelectedType(type); }}
              >
                <View style={s.typeCardTop}>
                  <View style={[s.typeIconWrap, { backgroundColor: info.color + '22' }]}>
                    <Feather name={info.icon} size={ICON.md} color={info.color} />
                  </View>
                  <View style={{ flex: 1, marginLeft: SP.sm }}>
                    <Text style={s.typeTitle}>{info.title}</Text>
                    {isCurrent && (
                      <Text style={[s.currentTag, { color: info.color }]}>Current plan</Text>
                    )}
                  </View>
                  <View style={[s.radioOuter, isSelected && { borderColor: info.color }]}>
                    {isSelected && <View style={[s.radioInner, { backgroundColor: info.color }]} />}
                  </View>
                </View>
                <View style={s.typeCardBullets}>
                  {info.bullets.map((b) => (
                    <View key={b} style={s.bulletRow}>
                      <Feather name="check" size={12} color={info.color} style={{ marginRight: 8, marginTop: 2 }} />
                      <Text style={s.bulletText}>{b}</Text>
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Save button */}
          <TouchableOpacity
            style={[s.saveBtn, !isDirty && s.saveBtnDisabled]}
            activeOpacity={0.85}
            disabled={!isDirty || saving}
            onPress={handleSave}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[s.saveBtnText, !isDirty && { color: MUTED }]}>
                {isDirty ? `Switch to ${selectedType ? ACCOUNT_INFO[selectedType].title : ''}` : 'No changes'}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={s.disclaimer}>
            Switching account types changes the features available to you. Your existing data (orders, products, etc.) is preserved.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  headerTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  backBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  currentBadge:    { flexDirection: 'row', alignItems: 'center', gap: SP.xs, backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.sm, paddingVertical: SP.xs, alignSelf: 'flex-start', marginBottom: SP.md },
  currentBadgeText:{ fontSize: FS.sm, fontFamily: FONT.semibold },

  sectionLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SP.sm },

  typeCard:        { backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.md, marginBottom: SP.sm },
  typeCardTop:     { flexDirection: 'row', alignItems: 'center' },
  typeIconWrap:    { width: 44, height: 44, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  typeTitle:       { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  currentTag:      { fontSize: FS.xs, fontFamily: FONT.medium, marginTop: 2 },
  radioOuter:      { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  radioInner:      { width: 10, height: 10, borderRadius: 5 },
  typeCardBullets: { marginTop: SP.sm, gap: 6 },
  bulletRow:       { flexDirection: 'row', alignItems: 'flex-start' },
  bulletText:      { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, flex: 1 },

  saveBtn:        { backgroundColor: PURPLE, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SP.md },
  saveBtnDisabled:{ backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  saveBtnText:    { fontSize: FS.base, fontFamily: FONT.bold, color: '#fff' },

  disclaimer: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: SP.md, lineHeight: 18 },
});
