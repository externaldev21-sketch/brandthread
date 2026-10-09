/**
 * Live Moderation — host screen pushed from seller-live's rail.
 * Slow mode, blocked words, and the muted / banned lists for one stream.
 * All rules are enforced server-side (routes/live.ts + lib/liveModeration.ts);
 * this screen only edits them. `&demo=1` renders sample data with no API calls.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ListRow } from '@/components/ui/ListRow';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import {
  addBannedWord, SLOW_MODE_OPTIONS,
  type LiveModerationState, type LiveRestrictedUser,
} from '@/lib/live/moderationTypes';

const DEMO_STATE: LiveModerationState = {
  bannedWords: ['spam', 'free followers', 'dm me'],
  slowModeSeconds: 10,
  pinnedCommentId: null,
  muted: [{ userId: 'demo-1', displayName: 'Maya Lin', username: 'mayalin', createdAt: '' }],
  banned: [{ userId: 'demo-2', displayName: 'Jordan Reyes', username: 'jreyes', createdAt: '' }],
};

function slowLabel(seconds: number): string {
  if (seconds === 0) return 'Off';
  return seconds >= 60 ? `${seconds / 60}m` : `${seconds}s`;
}

export default function LiveModerationScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const params = useLocalSearchParams<{ streamId?: string; demo?: string }>();
  const demo = params.demo === '1';
  const streamId = params.streamId ? String(params.streamId) : '';
  const live = !demo && !!streamId;

  const [state, setState] = useState<LiveModerationState | null>(demo ? DEMO_STATE : null);
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState<string | null>(null);
  const [wordDraft, setWordDraft] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!live) return;
    setLoading(true);
    setError(null);
    try {
      setState(await api.liveMod.get(streamId));
    } catch {
      setError('Couldn’t load moderation settings.');
    } finally {
      setLoading(false);
    }
  }, [api, live, streamId]);

  useEffect(() => { void load(); }, [load]);

  const words = state?.bannedWords ?? [];
  const slow = state?.slowModeSeconds ?? 0;

  function patch(next: Partial<LiveModerationState>) {
    setState((prev) => (prev ? { ...prev, ...next } : prev));
  }

  function commitWord() {
    const next = addBannedWord(words, wordDraft);
    setWordDraft('');
    if (next !== words) patch({ bannedWords: next });
  }

  async function save() {
    if (!state) return;
    if (!live) { goBackOr(router); return; }
    setSaving(true);
    try {
      await api.liveMod.saveSettings(streamId, {
        bannedWords: state.bannedWords, slowModeSeconds: state.slowModeSeconds, saveAsDefault,
      });
      goBackOr(router);
    } catch {
      Alert.alert('Couldn’t save', 'Your changes were not saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function lift(kind: 'muted' | 'banned', user: LiveRestrictedUser) {
    const previous = state;
    patch({ [kind]: (state?.[kind] ?? []).filter((u) => u.userId !== user.userId) } as Partial<LiveModerationState>);
    if (!live) return;
    try {
      if (kind === 'muted') await api.liveMod.unmute(streamId, user.userId);
      else await api.liveMod.unban(streamId, user.userId);
    } catch {
      setState(previous);
      Alert.alert('Couldn’t update', 'Try again.');
    }
  }

  const s = makeStyles(theme);

  const renderPeople = (kind: 'muted' | 'banned', people: LiveRestrictedUser[]) =>
    people.map((u) => (
      <ListRow
        key={u.userId}
        avatar={{ name: u.displayName }}
        title={u.displayName}
        subtitle={u.username ? `@${u.username}` : undefined}
        right={<View style={s.rowBtn}><Button label={kind === 'muted' ? 'Unmute' : 'Unban'} variant="secondary" size="compact" fullWidth onPress={() => void lift(kind, u)} /></View>}
      />
    ));

  return (
    <View style={s.root}>
      <ScreenHeader title="Moderation" onBack={() => goBackOr(router)} />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.text} /></View>
      ) : !state ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error ?? 'Open Moderation from your live broadcast.'}</Text>
          {live && <Button label="Retry" variant="secondary" size="small" onPress={() => void load()} style={{ marginTop: SP.md }} />}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + SP.xl }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.sectionLabel}>Slow mode</Text>
          <View style={s.segmentRow}>
            {SLOW_MODE_OPTIONS.map((sec) => {
              const on = slow === sec;
              return (
                <Pressable
                  key={sec}
                  onPress={() => patch({ slowModeSeconds: sec })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={sec === 0 ? 'Slow mode off' : `Slow mode ${slowLabel(sec)}`}
                  style={[s.segment, { backgroundColor: on ? theme.accent : theme.card, borderColor: on ? theme.accent : theme.border }]}
                >
                  <Text style={[s.segmentText, { color: on ? theme.onAccent : theme.text }]}>{slowLabel(sec)}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={s.sectionLabel}>Blocked words</Text>
          <View style={s.addRow}>
            <TextInput
              value={wordDraft}
              onChangeText={setWordDraft}
              onSubmitEditing={commitWord}
              placeholder="Word or phrase"
              placeholderTextColor={theme.muted}
              returnKeyType="done"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={40}
              style={s.input}
              accessibilityLabel="Blocked word"
            />
            <View style={s.rowBtn}><Button label="Add" variant="secondary" size="small" fullWidth onPress={commitWord} disabled={!wordDraft.trim()} /></View>
          </View>
          {words.map((w) => (
            <ListRow
              key={w}
              title={w}
              right={<View style={s.rowBtn}><Button label="Remove" variant="secondary" size="compact" fullWidth onPress={() => patch({ bannedWords: words.filter((x) => x !== w) })} /></View>}
            />
          ))}
          <ListRow
            title="Use for all my lives"
            toggle={{ value: saveAsDefault, onChange: setSaveAsDefault }}
            style={s.defaultRow}
          />

          {state.muted.length > 0 && (
            <>
              <Text style={s.sectionLabel}>Muted</Text>
              {renderPeople('muted', state.muted)}
            </>
          )}
          {state.banned.length > 0 && (
            <>
              <Text style={s.sectionLabel}>Banned</Text>
              {renderPeople('banned', state.banned)}
            </>
          )}

          <View style={s.saveWrap}>
            <Button label="Save" onPress={() => void save()} loading={saving} fullWidth />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg },
  errorText: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center' },
  content: { paddingHorizontal: SP.md, paddingTop: SP.sm },
  sectionLabel: {
    color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.meta, marginTop: SP.lg, marginBottom: SP.sm,
  },
  segmentRow: { flexDirection: 'row', gap: SP.sm },
  segment: { flex: 1, height: 44, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  rowBtn: { width: 112 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  input: {
    flex: 1, minWidth: 0, height: 44, borderRadius: RADIUS.md, paddingHorizontal: SP.md,
    backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, color: theme.text, fontFamily: FONT.regular, fontSize: FS.base,
  },
  defaultRow: { marginTop: SP.md },
  saveWrap: { marginTop: SP.xl },
});
