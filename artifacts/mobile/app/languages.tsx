/**
 * Brandthread — Languages (store localization settings)
 * Low-priority: stores preferred store language in seller_settings.
 */
import React, { useState, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/lib/api';
import * as Haptics from 'expo-haptics';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English',    nativeName: 'English' },
  { code: 'es', name: 'Spanish',    nativeName: 'Español' },
  { code: 'fr', name: 'French',     nativeName: 'Français' },
  { code: 'de', name: 'German',     nativeName: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '中文' },
  { code: 'ja', name: 'Japanese',   nativeName: '日本語' },
  { code: 'ko', name: 'Korean',     nativeName: '한국어' },
  { code: 'ar', name: 'Arabic',     nativeName: 'العربية' },
  { code: 'it', name: 'Italian',    nativeName: 'Italiano' },
];

export default function LanguagesScreen() {
  const colors = useColors();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const [storeLanguage, setStoreLanguage] = useState<string>('en');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.seller.getSettings() as any;
      setStoreLanguage(data.settings?.storeLanguage ?? 'en');
    } catch {
      setStoreLanguage('en');
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  async function selectLanguage(code: string) {
    if (code === storeLanguage) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSaving(code);
    try {
      await api.seller.updateSettings({ storeLanguage: code }) as any;
      setStoreLanguage(code);
    } catch {
      Alert.alert('Couldn’t save language', 'Check your connection and try again.');
    } finally {
      setSaving(null);
    }
  }

  const currentLang = LANGUAGES.find(l => l.code === storeLanguage);

  return (
    <View style={[s.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Languages" />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SP.xxl }} showsVerticalScrollIndicator={false}>
          {/* Current language banner */}
          <View style={s.section}>
            <View style={[s.currentCard, { backgroundColor: colors.accent, borderColor: colors.primary }]}>
              <View style={[s.currentIcon, { backgroundColor: colors.accent }]}>
                <Feather name="globe" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.currentLabel, { color: colors.primary }]}>Store language</Text>
                <Text style={[s.currentValue, { color: colors.primary }]}>
                  {currentLang ? (currentLang.name === currentLang.nativeName ? currentLang.name : `${currentLang.name} — ${currentLang.nativeName}`) : 'English'}
                </Text>
              </View>
            </View>
          </View>

          {/* Language list */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Store language</Text>
            <Text style={[s.sectionSubtitle, { color: colors.mutedForeground }]}>
              Select your store's primary language. Buyers will see content in this language.
            </Text>

            <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {LANGUAGES.map((lang, i) => {
                const isSelected = storeLanguage === lang.code;
                const isSaving = saving === lang.code;
                return (
                  <TouchableOpacity
                    key={lang.code}
                    onPress={() => selectLanguage(lang.code)}
                    activeOpacity={0.7}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected, busy: isSaving }}
                    accessibilityLabel={`${lang.name}, ${lang.nativeName}`}
                    style={[
                      s.langRow,
                      i !== LANGUAGES.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                      isSelected && { backgroundColor: colors.accent },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={s.langNameRow}>
                        <Text style={[s.langName, { color: colors.foreground }]}>{lang.name}</Text>
                        {isSelected && (
                          <View style={[s.defaultBadge, { borderColor: colors.border }]}>
                            <Text style={[s.defaultBadgeText, { color: colors.mutedForeground }]}>Current</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[s.langNative, { color: colors.mutedForeground }]}>{lang.nativeName}</Text>
                    </View>
                    {isSaving ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : isSelected ? (
                      <Feather name="check" size={20} color={colors.primary} />
                    ) : (
                      <Feather name="circle" size={18} color={colors.mutedForeground} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  section: { paddingHorizontal: SP.md, paddingVertical: SP.md },
  sectionTitle: { fontSize: FS.base, fontFamily: FONT.semibold, marginBottom: SP.xs },
  sectionSubtitle: { fontSize: FS.meta, fontFamily: FONT.regular, lineHeight: 17, marginBottom: SP.md },
  currentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, padding: 14 },
  currentIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  currentLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  currentValue: { fontSize: FS.sm, fontFamily: FONT.bold },
  listCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  langRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  langNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  langName: { fontSize: FS.base, fontFamily: FONT.semibold },
  defaultBadge: { borderRadius: RADIUS.pill, borderWidth: 1, paddingHorizontal: SP.sm, paddingVertical: 2 },
  defaultBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  langNative: { fontSize: FS.meta, fontFamily: FONT.regular },
});
