/**
 * Brandthread — Store language (seller).
 * Saves seller_settings.storeLanguage. The server uses it as the language TAG
 * of the seller's storefront page (html lang), the bio on their shared profile
 * link, and the public seller payload (`storeLanguage`). Nothing is
 * translated — the copy below says so.
 */
import React, { useState, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

import { useFocusEffect } from 'expo-router';

import { useColors } from '@/hooks/useColors';

import { ScreenHeader } from '@/components/ScreenHeader';

import { Icon } from '@/components/ui/Icon';

import { useApi } from '@/lib/api';

import { haptics, haptic } from '@/lib/haptics';


import { SUCCESS, SUCCESS_DIM, FONT, FS, RADIUS } from '@/lib/theme';

import { useSellerShell } from '@/contexts/SellerShellContext';

import { isSellerDevPreview } from '@/lib/devPreview';

import { loadBuyerSettings, patchBuyerSettings } from '@/lib/buyerSettings';

import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';

import { ErrorState } from '@/components/ui/ErrorState';

import { showAlert } from '@/lib/actionSheet';

import { friendlyError } from '@/lib/friendlyError';

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
  const { isActiveSeller } = useSellerShell();
  // Buyers have no store: they pick their app language (stored locally with
  // the rest of their buyer settings) and never hit the seller settings API.
  const isBuyer = !isActiveSeller && !isSellerDevPreview();
  const tabBarInset = useSellerTabBarInset();
  const [storeLanguage, setStoreLanguage] = useState<string>('en');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    if (isBuyer) {
      const settings = await loadBuyerSettings();
      setStoreLanguage(LANGUAGES.find(l => l.name === settings.language)?.code ?? 'en');
      setLoading(false);
      return;
    }
    try {
      const data = await api.seller.getSettings() as any;
      setStoreLanguage(data.settings?.storeLanguage ?? 'en');
    } catch (err) {
      // Don't pretend the store is in English: show the failure and let them retry.
      setLoadError(friendlyError(err, 'Couldn’t load your store language.'));
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, [isBuyer]));

  async function selectLanguage(code: string) {
    if (code === storeLanguage) return;
    haptic('select');
    setSaving(code);
    try {
      if (isBuyer) {
        await patchBuyerSettings({ language: LANGUAGES.find(l => l.code === code)?.name ?? 'English' });
      } else {
        await api.seller.updateSettings({ storeLanguage: code }) as any;
      }
      setStoreLanguage(code);
    } catch (error) {
      showAlert(isBuyer ? 'Couldn’t save app language' : 'Couldn’t save store language', friendlyError(error, 'Try again.'));
    } finally {
      setSaving(null);
    }
  }

  const currentLang = LANGUAGES.find(l => l.code === storeLanguage);

  return (
    <View style={[s.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Store language" />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => { void load(); }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 60 + tabBarInset }} showsVerticalScrollIndicator={false}>
          {/* Current language banner */}
          <View style={s.section}>
            <View style={[s.currentCard, { backgroundColor: colors.accent, borderColor: colors.primary }]}>
              <View style={[s.currentIcon, { backgroundColor: colors.accent }]}>
                <Icon name="globe" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.currentLabel, { color: colors.primary }]}>{isBuyer ? 'App language' : 'Store language'}</Text>
                <Text style={[s.currentValue, { color: colors.primary }]}>
                  {currentLang?.name ?? 'English'} — {currentLang?.nativeName ?? 'English'}
                </Text>
              </View>
            </View>
          </View>

          {/* Language list */}
          <View style={s.section}>
            {isBuyer ? null : (
              <>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Language you write your store in</Text>
            <Text style={[s.sectionSubtitle, { color: colors.mutedForeground }]}>
              This sets the language tag on your storefront page and listing metadata, so browsers, search engines and screen readers read your content correctly.
            </Text>
            <View style={[s.noticeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Icon name="info" size={16} color={colors.mutedForeground} />
              <Text style={[s.noticeText, { color: colors.mutedForeground }]}>
                Translation isn't available yet. Buyers see your products and policies exactly as you write them, and the app and storefront buttons stay in English.
              </Text>
            </View>
              </>
            )}

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
                      {isBuyer ? null : (
                        <Text style={[s.langMarket, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {lang.marketShare}
                        </Text>
                      )}
                    </View>
                    {isSaving ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : isSelected ? (
                      <Icon name="check" size={20} color={colors.primary} />
                    ) : (
                      <Icon name="circle" size={18} color={colors.mutedForeground} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {isBuyer ? null : (
          <View style={s.section}>
            <Text style={[s.footerNote, { color: colors.mutedForeground }]}>
              To reach buyers in another language today, write your product titles, descriptions and policies in that language.
            </Text>
          </View>
          )}
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
  sectionSubtitle: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 16, marginBottom: 14 },
  currentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.lg, borderWidth: 1, padding: 14 },
  currentIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  currentLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, marginBottom: 2 },
  currentValue: { fontSize: FS.sm, fontFamily: FONT.bold },
  listCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  langRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  langNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  langName: { fontSize: 15, fontFamily: FONT.semibold },
  defaultBadge: { borderRadius: 16, paddingHorizontal: 8, paddingVertical: 3 },
  defaultBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  langNative: { fontSize: 12, fontFamily: FONT.regular, marginBottom: 2, textAlign: 'left', writingDirection: 'ltr', alignSelf: 'stretch' },
  langMarket: { fontSize: 11, fontFamily: FONT.regular },
  noticeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: RADIUS.lg, borderWidth: 1, padding: 12, marginBottom: 14 },
  noticeText: { flex: 1, fontSize: 12, fontFamily: FONT.regular, lineHeight: 16 },
  footerNote: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 16 },
});
