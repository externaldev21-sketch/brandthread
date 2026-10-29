/**
 * Hidden Words → Manage custom words and phrases (feature 71), copied from
 * Instagram: one field ("Add words, separated by commas"), Add, then the list
 * with a remove button on each. Saved to the server on every change.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { apiErrorMessage } from '@/lib/safety';
import { hapticLight } from '@/lib/haptics';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

/** "fake, ugly ,  dm me" → ["fake", "ugly", "dm me"] */
export function splitWords(raw: string): string[] {
  return raw.split(',').map((w) => w.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

export default function HiddenWordsCustomScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [words, setWords] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    api.safety.hiddenWords()
      .then((r) => { if (active) setWords(r.words); })
      .catch((err) => { if (active) setError(apiErrorMessage(err, 'We couldn’t load your words.')); });
    return () => { active = false; };
  }, [api]));

  async function save(next: string[]) {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.safety.setHiddenWords({ words: next });
      setWords(saved.words);
      return true;
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t save that. Try again.'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function add() {
    // Each save sends the whole list; one built while another is in flight
    // would undo it.
    if (saving) return;
    const added = splitWords(draft);
    if (added.length === 0) return;
    if (await save([...added, ...words])) setDraft('');
  }

  function remove(word: string) {
    if (saving) return;
    hapticLight();
    void save(words.filter((w) => w !== word));
  }

  return (
    <View style={s.root}>
      <ScreenHeader title="Custom words" />
      <View style={s.form}>
        <TextInput
          style={s.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Add words, separated by commas"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => { void add(); }}
          maxLength={300}
          testID="hidden-words-input"
        />
        <Button label="Add" onPress={() => { void add(); }} disabled={saving || splitWords(draft).length === 0} testID="hidden-words-add" />
        {error ? <Text style={s.error}>{error}</Text> : null}
      </View>
      <FlatList
        data={words}
        keyExtractor={(w) => w}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xl }}
        ListHeaderComponent={words.length ? <Text style={s.count}>{words.length} {words.length === 1 ? 'word' : 'words'}</Text> : null}
        ListEmptyComponent={<Text style={s.empty}>Words you add here are hidden from comments on your posts.</Text>}
        renderItem={({ item }) => (
          <View style={s.row}>
            <Text style={s.word} numberOfLines={1}>{item}</Text>
            <Pressable
              onPress={() => remove(item)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item}`}
              style={({ pressed }) => [s.remove, pressed && { opacity: 0.6 }]}
            >
              <Feather name="x" size={18} color={theme.muted} />
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    form: { paddingHorizontal: SP.md, paddingTop: SP.sm, gap: SP.sm },
    input: {
      minHeight: 48, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, paddingHorizontal: SP.md,
      fontFamily: FONT.regular, fontSize: FS.base, color: theme.text, backgroundColor: theme.background,
    },
    error: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.error },
    count: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, paddingTop: SP.lg, paddingBottom: SP.xs },
    empty: { fontFamily: FONT.regular, fontSize: FS.base, color: theme.muted, paddingTop: SP.lg },
    row: {
      flexDirection: 'row', alignItems: 'center', minHeight: 52,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
    },
    word: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base, color: theme.text },
    remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  });
}
