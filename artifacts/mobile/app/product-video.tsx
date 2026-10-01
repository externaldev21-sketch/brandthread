/**
 * Product video manager — one short silent video per product, shown under the
 * product page. Upload / replace / remove with progress and a preview.
 *
 * Route: /product-video?productId=<uuid>
 *
 * Signed-out web preview never calls the API; `&demo=1` shows a local
 * uploaded example.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CachedImage } from '@/components/CachedImage';
import { Header } from '@/components/layout';
import { formatVideoLength } from '@/components/products/ProductVideo';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useApi, type ProductVideoInfo } from '@/lib/api';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

const MAX_SECONDS = 60;
const MAX_BYTES = 100 * 1024 * 1024;

function notify(title: string, message?: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

function serverMessage(error: unknown): string {
  const raw = (error as { message?: string } | null)?.message;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.error === 'string') return parsed.error;
    } catch { /* plain text */ }
    if (raw.trim()) return raw;
  }
  return 'Could not upload the video. Try again.';
}

export default function ProductVideoScreen() {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const demo = isPreviewDemoMode();
  const offline = isSellerDevPreview() && !demo;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [video, setVideo] = useState<ProductVideoInfo | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      if (demo) {
        const { getProducts } = await import('@/services/productService');
        const first = (await getProducts())[0];
        setVideo({ videoUrl: '', posterUrl: first?.media?.[0]?.uri ?? null, durationMs: 18000 });
      } else if (!offline && productId) {
        setVideo((await api.productVideos.get(productId)).video);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [api, demo, offline, productId]);

  useEffect(() => { void load(); }, [load]);

  const pick = useCallback(async () => {
    if (!productId || offline || demo || progress !== null) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (typeof asset.duration === 'number' && asset.duration / 1000 > MAX_SECONDS + 0.25) {
        notify('Video is too long', `Product videos can be at most ${MAX_SECONDS} seconds.`);
        return;
      }
      if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_BYTES) {
        notify('Video is too large', 'Choose a video under 100 MB.');
        return;
      }
      setProgress(0);
      const res = await api.productVideos.upload(productId, asset.uri, asset.mimeType ?? null, setProgress);
      setVideo(res.video);
    } catch (err) {
      notify("Couldn't upload video", serverMessage(err));
    } finally {
      setProgress(null);
    }
  }, [api, demo, offline, productId, progress]);

  const remove = useCallback(() => {
    const run = async () => {
      setRemoving(true);
      try {
        if (!demo && productId) await api.productVideos.remove(productId);
        setVideo(null);
      } catch {
        notify("Couldn't remove video", 'Try again.');
      } finally {
        setRemoving(false);
      }
    };
    if (Platform.OS === 'web') { void run(); return; }
    Alert.alert('Remove video?', 'Shoppers will no longer see it on this product.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { void run(); } },
    ]);
  }, [api, demo, productId]);

  const uploading = progress !== null;

  return (
    <View style={s.root}>
      <Header dividerVariant="none" title="Product video" onBack={() => goBackOr(router)} />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.hint}>Could not load this product.</Text>
          <TouchableOpacity onPress={load} style={s.textBtn} accessibilityRole="button"><Text style={s.textBtnLabel}>Try again</Text></TouchableOpacity>
        </View>
      ) : (
        <View style={[s.body, { paddingBottom: insets.bottom + 120 }]}>
          {video ? (
            <Preview video={video} s={s} colors={colors} />
          ) : (
            <TouchableOpacity
              style={[s.drop, uploading && { opacity: 0.6 }]}
              onPress={pick}
              disabled={uploading || offline}
              accessibilityRole="button"
              accessibilityLabel="Add video"
            >
              <Feather name="video" size={28} color={colors.foreground} />
              <Text style={s.dropTitle}>Add video</Text>
              <Text style={s.hint}>MP4, MOV or WebM. Up to 60 seconds, 100 MB.</Text>
            </TouchableOpacity>
          )}

          {uploading ? (
            <View style={s.progressWrap} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round((progress ?? 0) * 100) }}>
              <View style={s.track}><View style={[s.fill, { width: `${Math.round((progress ?? 0) * 100)}%` }]} /></View>
              <Text style={s.hint}>{(progress ?? 0) >= 1 ? 'Processing...' : `Uploading ${Math.round((progress ?? 0) * 100)}%`}</Text>
            </View>
          ) : null}

          {video && !uploading ? (
            <View style={s.actions}>
              <TouchableOpacity style={s.secondaryBtn} onPress={pick} disabled={offline || demo} accessibilityRole="button" accessibilityLabel="Replace video">
                <Feather name="refresh-cw" size={16} color={colors.foreground} />
                <Text style={s.secondaryLabel}>Replace</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.secondaryBtn} onPress={remove} disabled={removing} accessibilityRole="button" accessibilityLabel="Remove video">
                <Feather name="trash-2" size={16} color={colors.destructive} />
                <Text style={[s.secondaryLabel, { color: colors.destructive }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function Preview({ video, s, colors }: { video: ProductVideoInfo; s: ReturnType<typeof makeStyles>; colors: ReturnType<typeof useColors> }) {
  const [playing, setPlaying] = useState(false);
  const length = formatVideoLength(video.durationMs);
  return (
    <View style={s.preview}>
      {playing && video.videoUrl ? (
        <Player uri={video.videoUrl} />
      ) : (
        <>
          {video.posterUrl ? <CachedImage source={{ uri: video.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          <TouchableOpacity
            style={s.playWrap}
            disabled={!video.videoUrl}
            onPress={() => setPlaying(true)}
            accessibilityRole="button"
            accessibilityLabel="Play preview"
          >
            <View style={s.play}><Feather name="play" size={22} color={colors.foreground} style={{ marginLeft: 2 }} /></View>
          </TouchableOpacity>
          {length ? <View style={s.length}><Text style={s.lengthText}>{length}</Text></View> : null}
        </>
      )}
      {!video.posterUrl && !playing ? <Feather name="video" size={28} color={colors.mutedForeground} /> : null}
    </View>
  );
}

function Player({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; p.play(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.lg },
  body: { flex: 1, paddingHorizontal: SP.md, paddingTop: SP.md, gap: SP.md },
  drop: {
    aspectRatio: 4 / 5, maxHeight: 420, width: '100%', borderRadius: RADIUS.md,
    borderWidth: 1, borderStyle: 'dashed', borderColor: c.border, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center', gap: SP.sm, padding: SP.lg,
  },
  dropTitle: { fontSize: FS.lg, fontFamily: FONT.bold, color: c.foreground },
  hint: { fontSize: FS.sm, fontFamily: FONT.medium, color: c.mutedForeground, textAlign: 'center' },
  preview: {
    aspectRatio: 4 / 5, maxHeight: 420, width: '100%', borderRadius: RADIUS.md, overflow: 'hidden',
    backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
  },
  playWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' },
  length: { position: 'absolute', left: SP.sm, bottom: SP.sm, backgroundColor: c.foreground, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 3 },
  lengthText: { color: c.background, fontSize: FS.xs, fontFamily: FONT.semibold },
  progressWrap: { gap: SP.xs },
  track: { height: 6, borderRadius: 3, backgroundColor: c.card, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: c.primary },
  actions: { flexDirection: 'row', gap: SP.sm },
  secondaryBtn: {
    flex: 1, height: 48, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
  },
  secondaryLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: c.foreground },
  textBtn: { paddingVertical: SP.sm, paddingHorizontal: SP.md },
  textBtnLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: c.foreground },
});
