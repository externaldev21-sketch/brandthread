/**
 * Muted words — hide comments and posts containing words, phrases, #hashtags
 * or @handles. Stored on the server so the filter applies on every device;
 * only the person who muted them is affected and authors aren't notified.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { PressableScale } from '@/components/BrandthreadUI';
import { Header } from '@/components/layout';
import { apiErrorMessage } from '@/lib/safety';
import type { MutedWord } from '@/lib/safetyTypes';

const MAX_LENGTH = 60;
const SUGGESTIONS = ['spoilers', 'giveaway', 'dm me', 'resell', 'crypto'];

export default function MutedWordsScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const inputRef = useRef<TextInput>(null);

  const [words, setWords] = useState<MutedWord[]>([]);
  const [limit, setLimit] = useState(200);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.safety.mutedWords();
      setWords(result.words);
      setLimit(result.limit);
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t load your muted words.'));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function add(raw: string) {
    const phrase = raw.trim();
    if (!phrase || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.safety.muteWord(phrase);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setWords((prev) => prev.some((w) => w.phrase === created.phrase)
        ? prev
        : [...prev, { phrase: created.phrase, createdAt: created.createdAt }].sort((a, b) => a.phrase.localeCompare(b.phrase)));
      setDraft('');
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t mute that word. Try again.'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  }

  async function remove(phrase: string) {
    setRemoving(phrase);
    setError(null);
    try {
      await api.safety.unmuteWord(phrase);
      Haptics.selectionAsync();
      setWords((prev) => prev.filter((w) => w.phrase !== phrase));
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t unmute that word. Try again.'));
    } finally {
      setRemoving(null);
    }
  }

  const available = SUGGESTIONS.filter((suggestion) => !words.some((w) => w.phrase === suggestion));
  const atLimit = words.length >= limit;

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title="Muted words" />

      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={s.lead}>
          Comments and posts that contain these words are hidden from you everywhere on Brandthread. Nobody is notified.
        </Text>

        <View style={[s.inputShell, atLimit && { opacity: 0.5 }]}>
          <Feather name="plus" size={18} color={theme.muted} />
          <TextInput
            ref={inputRef}
            style={s.input}
            value={draft}
            onChangeText={(value) => setDraft(value.slice(0, MAX_LENGTH))}
            placeholder="Add a word, phrase, #hashtag or @handle"
            placeholderTextColor={theme.subtle}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => add(draft)}
            editable={!atLimit}
            accessibilityLabel="Word or phrase to mute"
            maxLength={MAX_LENGTH}
          />
          <PressableScale
            onPress={() => add(draft)}
            disabled={!draft.trim() || saving || atLimit}
            style={[s.addBtn, (!draft.trim() || atLimit) && { opacity: 0.35 }]}
            accessibilityRole="button"
            accessibilityLabel="Mute"
          >
            {saving ? <ActivityIndicator size="small" color={theme.onAccent} /> : <Text style={s.addText}>Mute</Text>}
          </PressableScale>
        </View>
        <Text style={s.hint}>
          Matches whole words, so muting “art” won’t hide “party”. {words.length}/{limit} used.
        </Text>

        {error ? (
          <View style={s.errorCard}>
            <Feather name="alert-circle" size={16} color={theme.error} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        {available.length > 0 && !atLimit ? (
          <>
            <Text style={s.sectionLabel}>SUGGESTIONS</Text>
            <View style={s.chips}>
              {available.map((suggestion) => (
                <PressableScale key={suggestion} style={s.suggestion} onPress={() => add(suggestion)} accessibilityRole="button" accessibilityLabel={`Mute ${suggestion}`}>
                  <Feather name="plus" size={12} color={theme.muted} />
                  <Text style={s.suggestionText}>{suggestion}</Text>
                </PressableScale>
              ))}
            </View>
          </>
        ) : null}

        <Text style={s.sectionLabel}>{words.length ? `MUTED (${words.length})` : 'MUTED'}</Text>
        {loading ? (
          <ActivityIndicator color={theme.text} style={{ marginTop: SP.lg }} />
        ) : words.length === 0 ? (
          <View style={s.empty}>
            <View style={s.emptyIcon}><Feather name="volume-x" size={22} color={theme.text} /></View>
            <Text style={s.emptyTitle}>No muted words yet</Text>
            <Text style={s.emptyBody}>Add words you don’t want to see — like spoilers, topics or phrases.</Text>
          </View>
        ) : (
          <View style={s.chips}>
            {words.map((word) => (
              <View key={word.phrase} style={s.wordChip}>
                <Text style={s.wordText}>{word.phrase}</Text>
                <PressableScale
                  onPress={() => remove(word.phrase)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Unmute ${word.phrase}`}
                  disabled={removing === word.phrase}
                >
                  {removing === word.phrase
                    ? <ActivityIndicator size="small" color={theme.muted} />
                    : <Feather name="x" size={14} color={theme.muted} />}
                </PressableScale>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.md },
  lead: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, marginBottom: SP.md },
  inputShell: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingLeft: SP.md, paddingRight: 6, height: 54,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
  },
  input: { flex: 1, color: theme.text, fontFamily: FONT.regular, fontSize: FS.base, height: '100%' },
  addBtn: { height: 40, paddingHorizontal: 16, borderRadius: RADIUS.md, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  addText: { color: theme.onAccent, fontFamily: FONT.bold, fontSize: FS.sm },
  hint: { color: theme.subtle, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 8 },
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.md, padding: SP.md,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.error + '55', backgroundColor: theme.card,
  },
  errorText: { flex: 1, color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm },
  sectionLabel: { color: theme.subtle, fontFamily: FONT.semibold, fontSize: 11, letterSpacing: 1, marginTop: SP.lg, marginBottom: SP.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  suggestion: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 12,
    borderRadius: RADIUS.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border,
  },
  suggestionText: { color: theme.muted, fontFamily: FONT.medium, fontSize: FS.sm },
  wordChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingLeft: 14, paddingRight: 10,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
  },
  wordText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
  empty: {
    alignItems: 'center', padding: SP.lg, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border,
    backgroundColor: theme.card, gap: 6,
  },
  emptyIcon: {
    width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border, marginBottom: 4,
  },
  emptyTitle: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  emptyBody: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, textAlign: 'center' },
});
