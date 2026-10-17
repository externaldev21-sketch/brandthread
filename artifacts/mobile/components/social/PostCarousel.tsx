/**
 * A POST carousel as people see it: fixed 3:4 frame, horizontal swipe between
 * slides (shared ZoomablePhotoPager: pinch/pan zoom, remembered slide), tappable dots under the frame, and videos that autoplay MUTED while their
 * slide is the visible one (and the screen is focused). Photos-only posts
 * (and legacy single-photo posts) use the same component.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Icon } from '@/components/ui/Icon';
import { ZoomablePhotoPager } from '@/components/media/ZoomablePhotoPager';
import { parseAspect, type ZoomMode } from '@/lib/carouselGestureMath';
import type { PostSlide } from '@/services/socialTypes';
import { CREATE_CANVAS } from '@/lib/theme';

export const POST_RATIO = 3 / 4;

function SlideVideo({ uri, active, width, height }: { uri: string; active: boolean; width: number; height: number }) {
  const focused = useIsFocused();
  const [muted, setMuted] = useState(true);
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; });
  useEffect(() => {
    if (active && focused) player.play(); else player.pause();
  }, [active, focused, player]);
  useEffect(() => { player.muted = muted; }, [muted, player]);
  return (
    <View style={{ width, height }}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      <Pressable
        onPress={() => setMuted((m) => !m)}
        style={s.mute}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        testID="carousel-mute"
        hitSlop={8}
      >
        <Icon name={muted ? 'volume-x' : 'volume-2'} size={14} color={CREATE_CANVAS.white} />
      </Pressable>
    </View>
  );
}

export function PostCarousel({ slides, width, dotColor = CREATE_CANVAS.white, dotDim = CREATE_CANVAS.silverDim, postId, mode = 'persistent', onIndexChange, onZoomChange, aspectRatio, aspects }: {
  slides: PostSlide[]; width: number; dotColor?: string; dotDim?: string;
  /** Shares the remembered slide with the feed / profile for this post. */
  postId?: string;
  /** 'persistent' (fullscreen viewer) keeps zoom after release; 'reset' springs home. */
  mode?: ZoomMode;
  onIndexChange?: (index: number) => void;
  onZoomChange?: (zoomed: boolean) => void;
  /** Authored post ratio ("4:5", "3:4", number w/h) — framing for every photo. */
  aspectRatio?: string | number | null;
  /** Optional per-photo authored ratios; win over `aspectRatio`. */
  aspects?: (number | string | null | undefined)[];
}) {
  const height = Math.round(width / POST_RATIO);
  const uris = useMemo(() => slides.map((sl) => (sl.kind === 'video' ? '' : sl.url)), [slides]);
  const authored = useMemo(
    () => slides.map((_, i) => parseAspect(aspects?.[i]) ?? parseAspect(aspectRatio) ?? null),
    [slides, aspects, aspectRatio],
  );
  // A mouse can't swipe: the web build keeps explicit previous/next controls (hidden while zoomed).
  const renderOverlay = useCallback(({ index, count, zoomed, goTo }: { index: number; count: number; zoomed: boolean; goTo: (i: number) => void }) => (
    Platform.OS === 'web' && count > 1 && !zoomed ? (
      <>
        {index > 0 ? (
          <Pressable onPress={(e) => { e.stopPropagation?.(); goTo(index - 1); }} style={[s.arrow, { left: 10, top: height / 2 - 16 }]} accessibilityRole="button" accessibilityLabel="Previous slide" testID="carousel-prev">
            <Icon name="chevron-left" size={18} color={CREATE_CANVAS.white} />
          </Pressable>
        ) : null}
        {index < count - 1 ? (
          <Pressable onPress={(e) => { e.stopPropagation?.(); goTo(index + 1); }} style={[s.arrow, { right: 10, top: height / 2 - 16 }]} accessibilityRole="button" accessibilityLabel="Next slide" testID="carousel-next">
            <Icon name="chevron-right" size={18} color={CREATE_CANVAS.white} />
          </Pressable>
        ) : null}
      </>
    ) : null
  ), [height]);
  const renderPage = useCallback((i: number, active: boolean) => {
    const sl = slides[i];
    return sl && sl.kind === 'video' ? <SlideVideo uri={sl.url} active={active} width={width} height={height} /> : null;
  }, [slides, width, height]);
  return (
    <ZoomablePhotoPager
      testID="post-carousel"
      postId={postId}
      uris={uris}
      width={width}
      height={height}
      mode={mode}
      renderPage={renderPage}
      renderOverlay={renderOverlay}
      aspects={authored}
      dotsPlacement="below"
      dotColor={dotColor}
      dotDim={dotDim}
      onIndexChange={onIndexChange}
      onZoomChange={onZoomChange}
    />
  );
}

const s = StyleSheet.create({
  arrow: { position: 'absolute', width: 32, height: 32, borderRadius: 16, backgroundColor: CREATE_CANVAS.black, alignItems: 'center', justifyContent: 'center' },
  mute: { position: 'absolute', right: 10, bottom: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: CREATE_CANVAS.black, alignItems: 'center', justifyContent: 'center' },
});
