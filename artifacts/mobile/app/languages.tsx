/**
 * Brandthread — Languages (store localization settings)
 * Low-priority: stores preferred store language in seller_settings.
 */
import React, { useState, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/lib/api';
import * as Haptics from 'expo-haptics';
import { SUCCESS, SUCCESS_DIM, FONT, FS, RADIUS } from '@/lib/theme';

interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  marketShare: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English',    nativeName: 'English',    marketShare: '~60% of global e-commerce' },
  { code: 'es', name: 'Spanish',    nativeName: 'Español',    marketShare: '~8% of global e-commerce' },
  { code: 'fr', name: 'French',     nativeName: 'Français',   marketShare: '~5% of global e-commerce' },
  { code: 'de', name: 'German',     nativeName: 'Deutsch',    marketShare: '~4% of global e-commerce' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português',  marketShare: '~4% of global e-commerce' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '中文', marketShare: '~3% of global e-commerce' },
  { code: 'ja', name: 'Japanese',   nativeName: '日本語',       marketShare: '~3% of global e-commerce' },
  { code: 'ko', name: 'Korean',     nativeName: '한국어',       marketShare: '~2% of global e-commerce' },
  { code: 'ar', name: 'Arabic',     nativeName: 'العربية',     marketShare: '~2% of global e-commerce' },
  { code: 'it', name: 'Italian',    nativeName: 'Italiano',   marketShare: '~2% of global e-commerce' },
];

export default function LanguagesScreen() {
  const colors = useColors();
  const api = useApi();
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
      Alert.alert('Error', 'Could not save language preference. Please try again.');
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
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          {/* Current language banner */}
          <View style={s.section}>
            <View style={[s.currentCard, { backgroundColor: colors.accent, borderColor: colors.primary }]}>
              <View style={[s.currentIcon, { backgroundColor: colors.accent }]}>
                <Feather name="globe" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.currentLabel, { color: colors.primary }]}>Store language</Text>
                <Text style={[s.currentValue, { color: colors.primary }]}>
                  {currentLang?.name ?? 'English'} — {currentLang?.nativeName ?? 'English'}
                </Text>
              </View>
            </View>
          </View>

          {/* Language list */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Published languages</Text>
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
                          <View style={[s.defaultBadge, { backgroundColor: SUCCESS_DIM }]}>
                            <Text style={[s.defaultBadgeText, { color: SUCCESS }]}>Default</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[s.langNative, { color: colors.mutedForeground }]}>{lang.nativeName}</Text>
                      <Text style={[s.langMarket, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {lang.marketShare}
                      </Text>
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

          <View style={s.section}>
            <Text style={[s.footerNote, { color: colors.mutedForeground }]}>
              To translate your product descriptions and policies for international buyers, enable multi-language support from your plan settings.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  section: { paddingHorizontal: 20, paddingVertical: 14 },
  sectionTitle: { fontSize: 15, fontFamily: FONT.semibold, marginBottom: 4 },
  sectionSubtitle: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 17, marginBottom: 14 },
  currentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, padding: 14 },
  currentIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  currentLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  currentValue: { fontSize: FS.sm, fontFamily: FONT.bold },
  listCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  langRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  langNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  langName: { fontSize: 14, fontFamily: FONT.semibold },
  defaultBadge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  defaultBadgeText: { fontSize: 10, fontFamily: FONT.semibold },
  langNative: { fontSize: 12, fontFamily: FONT.regular, marginBottom: 2 },
  langMarket: { fontSize: 11, fontFamily: FONT.regular },
  footerNote: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 18 },
});
