/**
 * Product video as the first gallery slide (polish 83).
 *
 * When the seller added a product video (Products → ⋯ → Product video), it
 * leads the photo gallery, muted and looping, and plays only while it is the
 * slide on screen. Reduce Motion keeps it paused on its poster. Same muted
 * expo-video pattern as components/products/ProductVideo.tsx; the server
 * renders these videos without an audio track.
 */
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CachedImage } from '@/components/CachedImage';
import { useApi, type ProductVideoInfo } from '@/lib/api';
import { isPreviewProductId } from '@/lib/previewProducts';

/** The product's video (GET /api/product-videos/public/:id, works signed out), or null. */
export function useGalleryVideo(productId: string | undefined): ProductVideoInfo | null {
  const api = useApi();
  const [video, setVideo] = useState<ProductVideoInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    setVideo(null);
    if (!productId || isPreviewProductId(productId)) return () => { cancelled = true; };
    api.productVideos.publicGet(productId)
      .then((res) => { if (!cancelled) setVideo(res?.video?.videoUrl ? res.video : null); })
      .catch(() => { if (!cancelled) setVideo(null); });
    return () => { cancelled = true; };
  }, [productId, api]);
  return video;
}

export function GalleryVideoSlide({ video, active, width, height }: {
  video: ProductVideoInfo; active: boolean; width: number; height: number;
}) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (live) setReduceMotion(v); }).catch(() => { if (live) setReduceMotion(false); });
    return () => { live = false; };
  }, []);

  const player = useVideoPlayer(video.videoUrl, (p) => {
    p.loop = true;
    p.muted = true;
  });

  const shouldPlay = active && reduceMotion === false;
  useEffect(() => {
    if (shouldPlay) player.play();
    else player.pause();
  }, [player, shouldPlay]);

  return (
    <View style={{ width, height }} testID="gallery-video-slide" accessibilityLabel="Product video, muted">
      {video.posterUrl ? <CachedImage source={{ uri: video.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
    </View>
  );
}
