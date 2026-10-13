/**
 * Stitch a post — TikTok "Stitch" flow, 1:1 in order, reskinned:
 *   1. Trim: pick up to 5 seconds of the original (video originals only)
 *   2. Your part: record (system camera) or upload your own photo/video
 *   3. Post: caption pre-filled "#stitch with @user", preview on the right, Post
 *
 * Route: /stitch-post?postId=…  — opened from the share sheet ("Stitch") or
 * the post viewer's ••• menu. The create-post camera is owned elsewhere, so
 * this screen uses the system camera / library and the shared publish
 * pipeline (lib/createPost/publish.ts), then links the new post to the
 * original via POST /api/fits/stitches. Preview sessions never post.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useRole } from '@/contexts/RoleContext';
import { useApi } from '@/lib/api';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { isUUID } from '@/lib/engagementUtils';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { assetToSlide } from '@/lib/createPost/slides';
import { publishCreatePost } from '@/lib/createPost/publish';
import type { MediaDraft, PickedAsset } from '@/lib/createPost/types';
import { STITCH_CLIP_MS, authorLabel, clipWindowAt, fitsErrorMessage, formatClipTime, stitchCaptionPrefix } from '@/lib/fits';
import { fitsService, type FitsPostSummary } from '@/services/fitsService';
import { RADII } from '@/constants/radii';
import { FONT, FS, SP } from '@/lib/theme';

type Step = 'clip' | 'yours' | 'post';
const CAPTION_MAX = 2200;

function ClipPreview({ uri, startMs, endMs, onDuration }: { uri: string; startMs: number; endMs: number; onDuration: (ms: number) => void }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.muted = true; p.timeUpdateEventInterval = 0.25; });
  useEffect(() => {
    const sub = player.addListener('sourceLoad', (e: { duration: number }) => onDuration(Math.round((e.duration || player.duration || 0) * 1000)));
    return () => sub.remove();
  }, [player, onDuration]);
  // Loop only the chosen window, like TikTok's trim preview.
  useEffect(() => {
    player.currentTime = startMs / 1000;
    player.play();
    const sub = player.addListener('timeUpdate', (e: { currentTime: number }) => {
      if (endMs > startMs && e.currentTime * 1000 >= endMs) player.currentTime = startMs / 1000;
    });
    return () => sub.remove();
  }, [player, startMs, endMs]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

export default function StitchPostScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { role } = useRole();
  const params = useLocalSearchParams<{ postId?: string }>();
  const postId = typeof params.postId === 'string' ? params.postId : '';

  const [source, setSource] = useState<FitsPostSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('clip');
  const [durationMs, setDurationMs] = useState(0);
  const [clip, setClip] = useState({ startMs: 0, endMs: STITCH_CLIP_MS });
  const [mine, setMine] = useState<PickedAsset | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const trackWidth = useRef(1);

  const isVideoSource = source?.mediaType === 'video';

  useEffect(() => {
    let cancelled = false;
    if (!postId) { setLoadError('This post is no longer available to stitch.'); return; }
    fitsService.stitchSource(postId)
      .then(({ source: s }) => {
        if (cancelled) return;
        setSource(s);
        setCaption(stitchCaptionPrefix(s.author));
        if (s.mediaType !== 'video') setStep('yours');
      })
      .catch((err) => { if (!cancelled) setLoadError(fitsErrorMessage(err, 'This post is no longer available to stitch.')); });
    return () => { cancelled = true; };
  }, [postId]);

  const onDuration = useCallback((ms: number) => {
    if (ms <= 0) return;
    setDurationMs(ms);
    setClip(clipWindowAt(0, ms));
  }, []);

  const moveClip = useCallback((x: number) => {
    if (durationMs <= 0) return;
    setClip(clipWindowAt(x / trackWidth.current, durationMs));
  }, [durationMs]);

  const pick = useCallback(async (from: 'camera' | 'library') => {
    setError(null);
    const perm = from === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError(from === 'camera' ? 'Allow camera access to record your part.' : 'Allow photo library access to upload your part.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images', 'videos'], quality: 0.9 };
    const res = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const a = res.canceled ? null : res.assets[0];
    if (!a) return;
    setMine({
      id: a.assetId ?? a.uri,
      uri: a.uri,
      kind: a.type === 'video' ? 'video' : 'photo',
      duration: a.type === 'video' ? (a.duration ?? 0) / 1000 : 0,
      width: a.width,
      height: a.height,
      mimeType: a.mimeType ?? null,
    });
  }, []);

  const submit = useCallback(async () => {
    if (!source || !mine || busy) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    let createdId: string | null = null;
    try {
      if (isBuyerDevPreview() || !isUUID(postId)) { goBackOr(router, '/'); return; }
      const mode = role === 'seller' ? 'thread' : 'post';
      const slide = await assetToSlide(mine);
      const media: MediaDraft = mode === 'thread' && mine.kind === 'video'
        ? { kind: 'video', video: { uri: mine.uri, mimeType: mine.mimeType, duration: slide.duration, speed: 1, trimStart: 0, trimEnd: slide.duration, coverOffset: 0 } }
        : { kind: 'slides', slides: [slide], aspect: mode === 'thread' ? '9:16' : '3:4', coverIndex: 0 };
      const created = await publishCreatePost({
        api,
        input: {
          mode,
          media,
          details: {
            caption: caption.trim(),
            productTags: [],
            visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true },
            scheduledAt: null,
          },
          isDraft: false,
        },
        onProgress: (f) => setProgress(f),
      });
      createdId = created.id;
      await fitsService.linkStitch({
        postId: created.id,
        sourcePostId: source.id,
        ...(isVideoSource && durationMs > 0 ? { clipStartMs: clip.startMs, clipEndMs: clip.endMs } : {}),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace(`/buyer-post-viewer?postId=${encodeURIComponent(created.id)}` as never);
    } catch (err) {
      // A post that couldn't be linked would lose its attribution — remove it.
      if (createdId) await fitsService.discardPost(createdId).catch(() => {});
      setError(fitsErrorMessage(err, 'Could not post your stitch. Try again.'));
    } finally {
      setBusy(false);
    }
  }, [api, busy, caption, clip, durationMs, isVideoSource, mine, postId, role, router, source]);

  const back = () => {
    if (step === 'post') return setStep('yours');
    if (step === 'yours' && isVideoSource) return setStep('clip');
    goBackOr(router, '/');
  };

  const next = step === 'clip'
    ? <Button label="Next" size="small" onPress={() => setStep('yours')} disabled={!source} accessibilityLabel="Next" testID="stitch-next" />
    : step === 'yours'
      ? <Button label="Next" size="small" onPress={() => setStep('post')} disabled={!mine} accessibilityLabel="Next" testID="stitch-next" />
      : undefined;

  const title = step === 'clip' ? 'Stitch' : step === 'yours' ? 'Your part' : 'Post';
  const sourceStill = source?.thumbnailUrl ?? (source && source.mediaType !== 'video' ? source.mediaUrl : null);

  if (loadError) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Stitch" onBack={() => goBackOr(router, '/')} />
        <View style={styles.center}><Text style={styles.muted} testID="stitch-error">{loadError}</Text></View>
      </View>
    );
  }
  if (!source) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Stitch" onBack={() => goBackOr(router, '/')} />
        <View style={styles.center}><ActivityIndicator color={theme.text} /></View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title={title} onBack={back} rightElement={next} />

      {step === 'clip' ? (
        <View style={[styles.flex, { paddingBottom: Math.max(insets.bottom, SP.md) }]} testID="stitch-step-clip">
          <View style={styles.stage}>
            {sourceStill ? <CachedImage source={{ uri: sourceStill }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
            <ClipPreview uri={source.mediaUrl} startMs={clip.startMs} endMs={clip.endMs} onDuration={onDuration} />
          </View>
          <View style={styles.trim}>
            <Text style={styles.time}>{`${formatClipTime(clip.startMs)} – ${formatClipTime(clip.endMs)}`}</Text>
            <View
              style={styles.track}
              onLayout={(e) => { trackWidth.current = Math.max(1, e.nativeEvent.layout.width); }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(e) => moveClip(e.nativeEvent.locationX)}
              onResponderMove={(e) => moveClip(e.nativeEvent.locationX)}
              accessibilityRole="adjustable"
              accessibilityLabel="Choose up to 5 seconds of the original"
              testID="stitch-track"
            >
              {sourceStill ? <CachedImage source={{ uri: sourceStill }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
              {durationMs > 0 ? (
                <View
                  pointerEvents="none"
                  style={[styles.window, {
                    left: `${(clip.startMs / durationMs) * 100}%`,
                    width: `${((clip.endMs - clip.startMs) / durationMs) * 100}%`,
                  }]}
                />
              ) : <View pointerEvents="none" style={[styles.window, { left: 0, right: 0 }]} />}
            </View>
          </View>
        </View>
      ) : null}

      {step === 'yours' ? (
        <View style={[styles.flex, { paddingBottom: Math.max(insets.bottom, SP.md) }]} testID="stitch-step-yours">
          <View style={styles.stage}>
            {mine ? (
              mine.kind === 'video'
                ? <ClipPreview uri={mine.uri} startMs={0} endMs={0} onDuration={() => {}} />
                : <CachedImage source={{ uri: mine.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : sourceStill ? (
              <CachedImage source={{ uri: sourceStill }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : null}
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>{`Stitch with ${authorLabel(source.author)}`}</Text>
            </View>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.controls}>
            <View style={styles.sideSlot} />
            <Pressable
              onPress={() => void pick('camera')}
              style={styles.record}
              accessibilityRole="button"
              accessibilityLabel="Record your part"
              testID="stitch-record"
            >
              <View style={styles.recordInner} />
            </Pressable>
            <Pressable
              onPress={() => void pick('library')}
              style={styles.sideSlot}
              accessibilityRole="button"
              accessibilityLabel="Upload"
              testID="stitch-upload"
            >
              <View style={styles.uploadIcon}><Feather name="image" size={20} color={theme.text} /></View>
              <Text style={styles.sideLabel}>Upload</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {step === 'post' ? (
        <>
          <ScrollView contentContainerStyle={styles.postContent} keyboardShouldPersistTaps="handled" testID="stitch-step-post">
            <View style={styles.postRow}>
              <TextInput
                style={styles.caption}
                value={caption}
                onChangeText={(t) => { setCaption(t.slice(0, CAPTION_MAX)); if (error) setError(null); }}
                multiline
                maxLength={CAPTION_MAX}
                placeholderTextColor={theme.subtle}
                accessibilityLabel="Caption"
                testID="stitch-caption"
              />
              <View style={styles.thumb}>
                {mine?.kind === 'photo' ? <CachedImage source={{ uri: mine.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  : sourceStill ? <CachedImage source={{ uri: sourceStill }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
              </View>
            </View>
            {error ? <Text style={styles.error} testID="stitch-post-error">{error}</Text> : null}
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Button
              label={busy ? `Posting ${Math.round(progress * 100)}%` : 'Post'}
              onPress={() => void submit()}
              loading={busy && progress === 0}
              disabled={busy || !mine}
              accessibilityLabel="Post stitch"
              testID="stitch-post"
            />
          </View>
        </>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg },
  muted: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center' },
  stage: { flex: 1, marginHorizontal: SP.md, borderRadius: RADII.input, overflow: 'hidden', backgroundColor: theme.surface },
  trim: { paddingHorizontal: SP.md, paddingTop: SP.md, gap: SP.sm },
  time: { color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm, textAlign: 'center' },
  track: { height: 56, borderRadius: RADII.input, overflow: 'hidden', backgroundColor: theme.surface },
  window: { position: 'absolute', top: 0, bottom: 0, borderWidth: 3, borderColor: theme.text, borderRadius: RADII.input },
  badge: { position: 'absolute', left: SP.sm, top: SP.sm, maxWidth: '80%', paddingHorizontal: SP.sm, paddingVertical: 4, borderRadius: RADII.input, backgroundColor: theme.background },
  badgeText: { color: theme.text, fontFamily: FONT.medium, fontSize: FS.xs },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.xl, paddingTop: SP.md },
  record: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: theme.text, alignItems: 'center', justifyContent: 'center' },
  recordInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: theme.text },
  sideSlot: { width: 64, alignItems: 'center', gap: 4 },
  uploadIcon: { width: 40, height: 40, borderRadius: RADII.input, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface },
  sideLabel: { color: theme.text, fontFamily: FONT.medium, fontSize: FS.xs },
  postContent: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.lg, gap: SP.sm },
  postRow: { flexDirection: 'row', gap: SP.md },
  caption: { flex: 1, minHeight: 140, color: theme.text, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, textAlignVertical: 'top', paddingTop: 0 },
  thumb: { width: 96, height: 128, borderRadius: RADII.input, overflow: 'hidden', backgroundColor: theme.surface },
  error: { color: theme.error ?? theme.text, fontFamily: FONT.medium, fontSize: FS.sm, paddingHorizontal: SP.md, paddingTop: SP.sm },
  footer: { paddingHorizontal: SP.md, paddingTop: SP.sm, backgroundColor: theme.background },
});
