/**
 * Product video — a poster tile with a play control, shown on the product
 * page when the seller has added a video (GET /api/product-videos/public/:id,
 * works signed out). Renders nothing otherwise.
 *
 * Playback reuses the app's expo-video pattern (profile cover / hero media):
 * muted, looping. The server renders these videos without an audio track.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CachedImage } from '@/components/CachedImage';
import { useColors } from '@/hooks/useColors';
import { useApi, type ProductVideoInfo } from '@/lib/api';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { getPreviewBuyerProduct, isPreviewProductId } from '@/lib/previewProducts';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export function formatVideoLength(durationMs: number | null | undefined): string | null {
  if (!durationMs || durationMs <= 0) return null;
  const total = Math.round(durationMs / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function ProductVideo({ productId }: { productId: string }) {
  const colors = useColors();
  const api = useApi();
  const [video, setVideo] = useState<ProductVideoInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVideo(null);
    if (isPreviewProductId(productId)) {
      // No server row exists for catalog preview ids; show a demo tile only on request.
      const demo = isPreviewDemoMode() ? getPreviewBuyerProduct(productId) : null;
      if (demo) setVideo({ videoUrl: '', posterUrl: demo.imageUris[0] ?? null, durationMs: 18000 });
      return () => { cancelled = true; };
    }
    api.productVideos.publicGet(productId)
      .then((res) => { if (!cancelled) setVideo(res?.video ?? null); })
      .catch(() => { if (!cancelled) setVideo(null); });
    return () => { cancelled = true; };
  }, [productId, api]);

  const s = useMemo(() => makeStyles(colors), [colors]);
  if (!video) return null;

  return (
    <View testID="product-video-section">
      <View style={s.divider} />
      <Text style={s.header} accessibilityRole="header">Product video</Text>
      {video.videoUrl ? <PlayableTile video={video} /> : <Tile posterUri={video.posterUrl} length={formatVideoLength(video.durationMs)} />}
    </View>
  );
}

function Tile({ posterUri, length, onPress }: { posterUri: string | null; length: string | null; onPress?: () => void }) {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      disabled={!onPress}
      onPress={onPress}
      style={s.tile}
      accessibilityRole="button"
      accessibilityLabel="Play product video"
    >
      {posterUri ? <CachedImage source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      <View style={s.playWrap}>
        <View style={s.play}><Feather name="play" size={22} color={colors.foreground} style={{ marginLeft: 2 }} /></View>
      </View>
      {length ? <View style={s.length}><Text style={s.lengthText}>{length}</Text></View> : null}
    </TouchableOpacity>
  );
}

function PlayableTile({ video }: { video: ProductVideoInfo }) {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [playing, setPlaying] = useState(false);
  if (!playing) {
    return <Tile posterUri={video.posterUrl} length={formatVideoLength(video.durationMs)} onPress={() => setPlaying(true)} />;
  }
  return (
    <View style={s.tile}>
      <InlinePlayer uri={video.videoUrl} />
      <TouchableOpacity style={s.close} onPress={() => setPlaying(false)} accessibilityRole="button" accessibilityLabel="Close product video">
        <Feather name="x" size={16} color={colors.foreground} />
      </TouchableOpacity>
    </View>
  );
}

function InlinePlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  divider: { height: 1, backgroundColor: c.border, marginVertical: SP.md },
  header: { fontSize: FS.sm, fontFamily: FONT.semibold, color: c.mutedForeground, marginBottom: SP.sm },
  tile: { width: '100%', aspectRatio: 4 / 5, maxHeight: 420, borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: c.card },
  playWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' },
  length: { position: 'absolute', left: SP.sm, bottom: SP.sm, backgroundColor: c.foreground, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 3 },
  lengthText: { color: c.background, fontSize: FS.xs, fontFamily: FONT.semibold },
  close: { position: 'absolute', top: SP.sm, right: SP.sm, width: 32, height: 32, borderRadius: 16, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' },
});
