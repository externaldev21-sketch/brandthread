/**
 * Owner-only captions editor for a video post: one editable line per caption
 * segment (timing is fixed), plus "Generate captions" when no track exists yet.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { DEMO_VIDEO_POST_ID, demoCaptionTrack, type CaptionTrack } from '@/lib/captions';
import { RADII } from '@/constants/radii';
import { FONT, FS, SP } from '@/lib/theme';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Phase = 'loading' | 'none' | 'pending' | 'ready' | 'failed' | 'unavailable';

export default function PostCaptionsEditScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('loading');
  const [track, setTrack] = useState<CaptionTrack | null>(null);
  const [texts, setTexts] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demo = isPreviewDemoMode() && postId === DEMO_VIDEO_POST_ID;

  const applyTrack = useCallback((next: CaptionTrack) => {
    setTrack(next);
    setTexts(next.segments.map((segment) => segment.text));
    setPhase('ready');
  }, []);

  const load = useCallback(async () => {
    if (!postId) return;
    if (demo) { applyTrack(demoCaptionTrack()); return; }
    try {
      const res = await api.posts.captions(postId);
      const ready = res.tracks.find((t) => t.status === 'ready');
      if (ready) { applyTrack(ready); return; }
      if (res.tracks.some((t) => t.status === 'pending')) { setPhase('pending'); return; }
      setPhase(res.tracks.some((t) => t.status === 'failed') ? 'failed' : 'none');
    } catch (e: any) {
      setPhase(e?.status === 503 || e?.code === 'CAPTIONS_UNAVAILABLE' ? 'unavailable' : 'none');
    }
  }, [api, postId, demo, applyTrack]);

  useEffect(() => { void load(); }, [load]);

  // While generation runs, re-check every few seconds.
  useEffect(() => {
    if (phase !== 'pending') return;
    pollRef.current = setTimeout(() => { void load(); }, 4000);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [phase, load]);

  const generate = async () => {
    if (!postId) return;
    setError(null);
    setPhase('pending');
    try {
      await api.posts.generateCaptions(postId, phase === 'failed');
    } catch {
      setPhase('failed');
      setError('Could not start captions. Try again.');
    }
  };

  const save = async () => {
    if (!postId || !track) return;
    setSaving(true);
    setError(null);
    try {
      if (demo) { goBackOr(router); return; }
      const updated = await api.posts.updateCaptions(postId, track.language, texts);
      applyTrack(updated);
      goBackOr(router);
    } catch (e: any) {
      setError(e?.message?.includes('Edit segment') ? e.message : 'Could not save captions. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const dirty = track ? texts.some((t, i) => t !== track.segments[i]?.text) : false;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="post-captions-edit">
      <ScreenHeader title="Captions" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {phase === 'loading' || phase === 'pending' ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.text} />
            {phase === 'pending' ? (
              <Text style={[styles.message, { color: theme.muted }]}>Generating captions. This takes a minute.</Text>
            ) : null}
          </View>
        ) : phase === 'ready' && track ? (
          <>
            <ScrollView
              contentContainerStyle={{ padding: SP.md, paddingBottom: SP.lg, gap: SP.sm }}
              keyboardShouldPersistTaps="handled"
            >
              {track.segments.map((segment, index) => (
                <View key={index} style={styles.row}>
                  <Text style={[styles.time, { color: theme.muted }]}>{formatTime(segment.start)}</Text>
                  <TextInput
                    style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]}
                    value={texts[index] ?? ''}
                    onChangeText={(value) => setTexts((prev) => prev.map((t, i) => (i === index ? value : t)))}
                    multiline
                    maxLength={500}
                    placeholderTextColor={theme.subtle}
                    accessibilityLabel={`Caption at ${formatTime(segment.start)}`}
                    testID={`caption-input-${index}`}
                  />
                </View>
              ))}
              {error ? <Text style={[styles.message, { color: theme.text }]}>{error}</Text> : null}
            </ScrollView>
            <View style={[styles.footer, { paddingBottom: insets.bottom + SP.sm, borderTopColor: theme.border }]}>
              <Button label="Save" onPress={save} loading={saving} disabled={!dirty && !demo} fullWidth testID="save-captions" />
            </View>
          </>
        ) : phase === 'unavailable' ? (
          <View style={styles.center}>
            <Text style={[styles.title, { color: theme.text }]}>Captions are not available</Text>
            <Text style={[styles.message, { color: theme.muted }]}>Auto captions are not turned on for your account yet.</Text>
          </View>
        ) : (
          <View style={styles.center}>
            <Text style={[styles.title, { color: theme.text }]}>
              {phase === 'failed' ? 'Captions could not be generated' : 'No captions yet'}
            </Text>
            <Text style={[styles.message, { color: theme.muted }]}>
              {phase === 'failed'
                ? 'The video may have no speech, or be too long.'
                : 'Add subtitles generated from the speech in this video.'}
            </Text>
            {error ? <Text style={[styles.message, { color: theme.text }]}>{error}</Text> : null}
            <Button
              label={phase === 'failed' ? 'Try again' : 'Generate captions'}
              onPress={generate}
              style={{ marginTop: SP.md }}
              testID="generate-captions"
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg, gap: SP.xs },
  title: { fontFamily: FONT.semibold, fontSize: FS.lg, textAlign: 'center' },
  message: { fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  time: { width: 40, paddingTop: 12, fontFamily: FONT.medium, fontSize: FS.xs },
  input: {
    flex: 1, borderWidth: 1, borderRadius: RADII.input, paddingHorizontal: SP.sm, paddingVertical: SP.sm,
    fontFamily: FONT.regular, fontSize: FS.base, minHeight: 44,
  },
  footer: { paddingHorizontal: SP.md, paddingTop: SP.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
