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
  BG, CARD, BORDER, FG, MUTED, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';

type AccountType = 'seller' | 'buyer';

export default function AccountTypeSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [currentType, setCurrentType] = useState<AccountType | null>(null);
  const [selectedType, setSelectedType] = useState<AccountType | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const accountInfo: Record<AccountType, { icon: keyof typeof Feather.glyphMap; color: string; title: string; bullets: string[] }> = {
    seller: {
      icon: 'shopping-bag',
      color: colors.primary,
      title: 'Seller',
      bullets: ['List products and collections', 'Receive orders and payments', 'Access analytics and insights', 'Design studio and AI tools', 'Brand storefront'],
    },
    buyer: {
      icon: 'user',
      color: colors.accentForeground,
      title: 'Buyer',
      bullets: ['Browse seller storefronts', 'Purchase products', 'Follow sellers and friends', 'Save and share items'],
    },
  };

  function fetchProfile() {
    setLoading(true);
    setLoadError(null);
    api.auth.me()
      .then((profile: any) => {
        const t: AccountType = profile?.accountType === 'buyer' ? 'buyer' : 'seller';
        setCurrentType(t);
        setSelectedType(t);
        setLoadError(null);
      })
      .catch(() => {
        // Do NOT silently default — surface the error so the user can retry.
        setLoadError('Could not load your account type. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchProfile(); }, []);

  const isDirty = selectedType !== null && selectedType !== currentType;

  async function handleSave() {
    if (!selectedType || !isDirty) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      `Switch to ${accountInfo[selectedType].title}?`,
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
                `You are now a ${accountInfo[selectedType].title}. Restart the app to apply all changes.`,
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
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : loadError ? (
        /* Do NOT silently open with a seller default — show retryable error */
        <View style={s.errorWrap}>
          <Feather name="alert-circle" size={36} color={colors.primary} style={{ marginBottom: 12 }} />
          <Text style={s.errorTitle}>Couldn't load account type</Text>
          <Text style={s.errorBody}>{loadError}</Text>
          <TouchableOpacity
            style={[s.retryBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.8}
            onPress={() => fetchProfile()}
          >
            <Feather name="refresh-cw" size={14} color={colors.primaryForeground} style={{ marginRight: 6 }} />
            <Text style={[s.retryBtnText, { color: colors.primaryForeground }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 60 }}>

          {/* Current badge */}
          {currentType && (
            <View style={s.currentBadge}>
              <Feather name={accountInfo[currentType].icon} size={ICON.sm} color={accountInfo[currentType].color} />
              <Text style={[s.currentBadgeText, { color: accountInfo[currentType].color }]}>
                Current: {accountInfo[currentType].title}
              </Text>
            </View>
          )}

          <Text style={s.sectionLabel}>Select account type</Text>

          {/* Type cards */}
          {(['seller', 'buyer'] as AccountType[]).map((type) => {
            const info = accountInfo[type];
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
            style={[s.saveBtn, { backgroundColor: colors.primary }, !isDirty && s.saveBtnDisabled]}
            activeOpacity={0.85}
            disabled={!isDirty || saving}
            onPress={handleSave}
          >
            {saving ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[s.saveBtnText, { color: colors.primaryForeground }, !isDirty && { color: MUTED }]}>
                {isDirty ? `Switch to ${selectedType ? accountInfo[selectedType].title : ''}` : 'No changes'}
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
  root:        { flex: 1, backgroundColor: 'transparent' },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  headerTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  backBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Error state
  errorWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl },
  errorTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG, marginBottom: SP.sm, textAlign: 'center' },
  errorBody:  { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 20, marginBottom: SP.lg },
  retryBtn:   { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.md, paddingVertical: 12, paddingHorizontal: SP.lg },
  retryBtnText: { fontSize: FS.sm, fontFamily: FONT.bold },

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

  saveBtn:        { borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SP.md },
  saveBtnDisabled:{ backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  saveBtnText:    { fontSize: FS.base, fontFamily: FONT.bold },

  disclaimer: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: SP.md, lineHeight: 18 },
});
