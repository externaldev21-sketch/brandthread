/**
 * Brandthread — App language (buyer).
 * Saves the preferred app language to the account (/api/me/settings
 * appLanguage) and the device. English is the only translated app language;
 * choosing another one says so plainly instead of pretending the UI changed.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useApi } from '@/lib/api';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { SUCCESS, SUCCESS_DIM, FONT, FS, RADIUS } from '@/lib/theme';
import {
  APP_LANGUAGES,
  DEFAULT_APP_LANGUAGE,
  appLanguageName,
  isAppUiTranslated,
  normalizeAppLanguage,
  readLocalAppLanguage,
  untranslatedNotice,
  writeLocalAppLanguage,
} from '@/lib/appLanguage';

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message.replace(/^API \d{3}:\s*/, '').trim() : '';
  return raw && !raw.startsWith('{') && raw.length <= 200
    ? raw
    : 'Check your connection and try again.';
}

export default function AppLanguageScreen() {
  const colors = useColors();
  const api = useApi();
  const router = useRouter();
  const { userId, isSignedIn } = useAuth();
  const [language, setLanguage] = useState<string>(DEFAULT_APP_LANGUAGE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const local = await readLocalAppLanguage(userId);
    if (local) setLanguage(local);
    if (isSignedIn) {
      try {
        const data = await api.meSettings.get();
        const server = normalizeAppLanguage(data.settings?.appLanguage);
        setLanguage(server);
        void writeLocalAppLanguage(userId, server);
      } catch {
        // Keep the device copy; saving below reports any server error.
      }
    }
    setLoading(false);
  }, [api, isSignedIn, userId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function save(code: string) {
    setSaving(code);
    try {
      if (isSignedIn) await api.meSettings.update({ appLanguage: code });
      await writeLocalAppLanguage(userId, code);
      setLanguage(code);
      Haptics.selectionAsync();
    } catch (error) {
      Alert.alert('Could not save language', errorText(error));
    } finally {
      setSaving(null);
    }
  }

  function select(code: string) {
    if (code === language || saving) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isAppUiTranslated(code)) {
      void save(code);
      return;
    }
    Alert.alert(
      `${appLanguageName(code)} isn't available yet`,
      'The Brandthread app is only translated into English right now. You can save this as your preferred language, but the app will stay in English.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save preference', onPress: () => { void save(code); } },
      ],
    );
  }

  const current = APP_LANGUAGES.find(l => l.code === language);

  return (
    <View style={[s.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="App language" onBack={() => goBackOr(router, '/buyer-settings')} />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          <View style={s.section}>
            <View style={[s.currentCard, { backgroundColor: colors.accent, borderColor: colors.primary }]}>
              <View style={[s.currentIcon, { backgroundColor: colors.accent }]}>
                <Feather name="globe" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.currentLabel, { color: colors.primary }]}>Preferred language</Text>
                <Text style={[s.currentValue, { color: colors.primary }]}>
                  {current?.name ?? 'English'} — {current?.nativeName ?? 'English'}
                </Text>
              </View>
            </View>
            {!isAppUiTranslated(language) && (
              <Text style={[s.notice, { color: colors.mutedForeground }]}>{untranslatedNotice(language)}</Text>
            )}
          </View>

          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Languages</Text>
            <Text style={[s.sectionSubtitle, { color: colors.mutedForeground }]}>
              English is the only fully supported app language right now. Other languages can be saved as a preference but aren't translated yet.
            </Text>

            <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {APP_LANGUAGES.map((lang, i) => {
                const isSelected = language === lang.code;
                const isSaving = saving === lang.code;
                const translated = isAppUiTranslated(lang.code);
                return (
                  <TouchableOpacity
                    key={lang.code}
                    onPress={() => select(lang.code)}
                    activeOpacity={0.7}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityHint={translated ? undefined : 'Not translated yet'}
                    style={[
                      s.langRow,
                      i !== APP_LANGUAGES.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                      isSelected && { backgroundColor: colors.accent },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={s.langNameRow}>
                        <Text style={[s.langName, { color: colors.foreground }]}>{lang.name}</Text>
                        {translated && (
                          <View style={[s.badge, { backgroundColor: SUCCESS_DIM }]}>
                            <Text style={[s.badgeText, { color: SUCCESS }]}>Fully supported</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[s.langNative, { color: colors.mutedForeground }]}>
                        {lang.nativeName}{translated ? '' : ' · Not translated yet'}
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
  notice: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 17, marginTop: 10 },
  listCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  langRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  langNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  langName: { fontSize: 14, fontFamily: FONT.semibold },
  badge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  langNative: { fontSize: 12, fontFamily: FONT.regular },
});
