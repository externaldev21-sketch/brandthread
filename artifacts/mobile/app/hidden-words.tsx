/**
 * Hidden Words (feature 71), copied from Instagram's Settings → Hidden Words:
 * "Offensive words and phrases" (Brandthread hides these for everyone, always
 * on), then "Custom words and phrases" with its own Hide comments switch and
 * a row to manage the list. Opened from Settings → Comments.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListRow } from '@/components/ui';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { apiErrorMessage } from '@/lib/safety';
import { FONT, FS, SP } from '@/lib/theme';

export default function HiddenWordsScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const [state, setState] = useState<{ hideCustom: boolean; words: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api.safety.hiddenWords());
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t load your hidden words.'));
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function setHideCustom(next: boolean) {
    if (!state) return;
    setState({ ...state, hideCustom: next });
    try {
      setState(await api.safety.setHiddenWords({ hideCustom: next }));
    } catch (err) {
      setState((prev) => (prev ? { ...prev, hideCustom: !next } : prev));
      setError(apiErrorMessage(err, 'We couldn’t save that. Try again.'));
    }
  }

  const count = state?.words.length ?? 0;

  return (
    <View style={s.root}>
      <ScreenHeader title="Hidden Words" />
      {!state && error ? (
        <ErrorState message={error} onRetry={() => { void load(); }} style={{ flex: 1 }} />
      ) : !state ? (
        <View style={{ padding: SP.md, gap: SP.md }}>
          {[0, 1, 2].map((i) => <SkeletonBlock key={i} width="100%" height={44} />)}
        </View>
      ) : (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + SP.xl }]}>
          <Text style={s.section}>Offensive words and phrases</Text>
          <ListRow
            title="Hide comments"
            subtitle="Comments with slurs, threats or strong language are hidden until a moderator reviews them."
            subtitleNumberOfLines={3}
            value="Always on"
          />

          <Text style={s.section}>Custom words and phrases</Text>
          <ListRow
            title="Manage custom words and phrases"
            subtitle={count === 0 ? 'None added' : `${count} ${count === 1 ? 'word' : 'words'}`}
            chevron
            onPress={() => router.push('/hidden-words-custom' as never)}
            testID="hidden-words-manage"
          />
          <ListRow
            title="Hide comments"
            subtitle="Comments on your posts that use these words are hidden from everyone but the person who wrote them."
            subtitleNumberOfLines={3}
            toggle={{ value: state.hideCustom, onChange: setHideCustom }}
            testID="hidden-words-hide-custom"
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: SP.md },
    section: { fontFamily: FONT.semibold, fontSize: FS.md, color: theme.text, marginTop: SP.lg, marginBottom: SP.xs },
    error: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.error, marginTop: SP.md },
  });
}
