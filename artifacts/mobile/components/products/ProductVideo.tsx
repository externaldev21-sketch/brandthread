/**
 * Product video — shown on the product page when the seller has added a
 * video (GET /api/product-videos/public/:id, works signed out). Renders
 * nothing otherwise.
 *
 * Plays on its own, muted and looping, with no play button (Dev's less-AI
 * pass, item 49) — same expo-video pattern as the profile cover / hero media,
 * paused while the screen is not focused. The poster shows until the first
 * frame. The server renders these videos without an audio track.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useIsFocused } from 'expo-router';
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

function Tile({ posterUri, length, children }: { posterUri: string | null; length: string | null; children?: React.ReactNode }) {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={s.tile} accessibilityLabel="Product video" testID="product-video-tile">
      {posterUri ? <CachedImage source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      {children}
      {length ? <View style={s.length}><Text style={s.lengthText}>{length}</Text></View> : null}
    </View>
  );
}

function PlayableTile({ video }: { video: ProductVideoInfo }) {
  return (
    <Tile posterUri={video.posterUrl} length={formatVideoLength(video.durationMs)}>
      <InlinePlayer uri={video.videoUrl} />
    </Tile>
  );
}

function InlinePlayer({ uri }: { uri: string }) {
  const focused = useIsFocused();
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
  });
  useEffect(() => {
    if (focused) player.play(); else player.pause();
  }, [focused, player]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  divider: { height: 1, backgroundColor: c.border, marginVertical: SP.md },
  header: { fontSize: FS.sm, fontFamily: FONT.semibold, color: c.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  tile: { width: '100%', aspectRatio: 4 / 5, maxHeight: 420, borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: c.card },
  length: { position: 'absolute', left: SP.sm, bottom: SP.sm, backgroundColor: c.foreground, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 3 },
  lengthText: { color: c.background, fontSize: FS.xs, fontFamily: FONT.semibold },
});
