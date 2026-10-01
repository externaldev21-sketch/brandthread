/**
 * One slide inside the fixed post frame: drag to reposition, pinch (mouse
 * wheel on web) to zoom in/out, rule-of-thirds grid while dragging. Works for
 * photos and videos. The crop it reports is {zoom, cx, cy} in
 * lib/createPost/crop.ts terms; dragging past the image edge asks the parent
 * to swipe to the neighbouring slide.
 */
import React, { useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ASPECT_RATIO_VALUE, type PostAspect } from '@/constants/postLimits';
import { clampSlideCrop, MAX_SLIDE_ZOOM, type SlideCrop } from '@/lib/createPost/crop';
import { previewFilter } from '@/lib/createPost/adjust';
import type { SlideDraft } from '@/lib/createPost/types';
import { CP } from '@/components/create-post/ui';

const SWIPE_OVERSHOOT = 70;

function CropVideo({ uri, start, end, w, h, filter, playing }: {
  uri: string; start: number; end: number; w: number; h: number; filter?: string; playing: boolean;
}) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.muted = true; p.currentTime = start; });
  useEffect(() => {
    if (playing) player.play(); else player.pause();
  }, [playing, player]);
  useEffect(() => {
    const id = setInterval(() => { if (player.currentTime >= end - 0.05 || player.currentTime < start - 0.3) player.currentTime = start; }, 150);
    return () => clearInterval(id);
  }, [player, start, end]);
  return <VideoView player={player} style={[{ width: w, height: h }, filter ? ({ filter } as any) : null]} contentFit="cover" nativeControls={false} />;
}

export function CropFrame({ slide, aspect, frameW, frameH, onCrop, onSwipe, gridWhen = 'dragging', playing = true, radius = 0 }: {
  slide: Pick<SlideDraft, 'id' | 'kind' | 'uri' | 'width' | 'height' | 'crop' | 'adjust' | 'trimStart' | 'trimEnd'>;
  aspect: PostAspect; frameW: number; frameH: number;
  onCrop: (crop: SlideCrop) => void; onSwipe: (dir: 1 | -1) => void;
  gridWhen?: 'always' | 'dragging';
  playing?: boolean;
  /** Corner radius of the frame (the carousel editor rounds it like Instagram's). */
  radius?: number;
}) {
  const ratio = ASPECT_RATIO_VALUE[aspect];
  const cover = Math.max(frameW / slide.width, frameH / slide.height);
  const baseW = slide.width * cover;
  const baseH = slide.height * cover;
  const [dragging, setDragging] = useState(false);

  const zoom = useSharedValue(1);
  const savedZoom = useSharedValue(1);
  const px = useSharedValue(0);
  const py = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  useEffect(() => {
    const c = clampSlideCrop(slide.crop, slide.width, slide.height, ratio);
    zoom.value = c.zoom; savedZoom.value = c.zoom;
    px.value = (0.5 - c.cx) * baseW * c.zoom; savedX.value = px.value;
    py.value = (0.5 - c.cy) * baseH * c.zoom; savedY.value = py.value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide.id, aspect, frameW, frameH, slide.crop.zoom, slide.crop.cx, slide.crop.cy]);

  function commit(z: number, x: number, y: number) {
    onCrop(clampSlideCrop({ zoom: z, cx: 0.5 - x / (baseW * z), cy: 0.5 - y / (baseH * z) }, slide.width, slide.height, ratio));
  }

  const pinch = Gesture.Pinch()
    .onBegin(() => { runOnJS(setDragging)(true); })
    .onUpdate((e) => {
      const z = Math.max(1, Math.min(MAX_SLIDE_ZOOM, savedZoom.value * e.scale));
      zoom.value = z;
      const maxX = Math.max(0, (baseW * z - frameW) / 2);
      const maxY = Math.max(0, (baseH * z - frameH) / 2);
      px.value = Math.max(-maxX, Math.min(maxX, px.value));
      py.value = Math.max(-maxY, Math.min(maxY, py.value));
    })
    .onEnd(() => {
      savedZoom.value = zoom.value; savedX.value = px.value; savedY.value = py.value;
      runOnJS(commit)(zoom.value, px.value, py.value);
    })
    .onFinalize(() => { runOnJS(setDragging)(false); });

  const pan = Gesture.Pan()
    .minDistance(4)
    .onBegin(() => { runOnJS(setDragging)(true); })
    .onUpdate((e) => {
      const maxX = Math.max(0, (baseW * zoom.value - frameW) / 2);
      const maxY = Math.max(0, (baseH * zoom.value - frameH) / 2);
      px.value = Math.max(-maxX, Math.min(maxX, savedX.value + e.translationX));
      py.value = Math.max(-maxY, Math.min(maxY, savedY.value + e.translationY));
    })
    .onEnd((e) => {
      const maxX = Math.max(0, (baseW * zoom.value - frameW) / 2);
      const raw = savedX.value + e.translationX;
      const over = raw - Math.max(-maxX, Math.min(maxX, raw));
      savedX.value = px.value; savedY.value = py.value;
      if (Math.abs(over) > SWIPE_OVERSHOOT) runOnJS(onSwipe)(over < 0 ? 1 : -1);
      else runOnJS(commit)(zoom.value, px.value, py.value);
    })
    .onFinalize(() => { runOnJS(setDragging)(false); });

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: px.value }, { translateY: py.value }, { scale: zoom.value }],
  }));

  function setZoom(next: number) {
    const z = Math.max(1, Math.min(MAX_SLIDE_ZOOM, next));
    zoom.value = z; savedZoom.value = z;
    const maxX = Math.max(0, (baseW * z - frameW) / 2);
    const maxY = Math.max(0, (baseH * z - frameH) / 2);
    px.value = Math.max(-maxX, Math.min(maxX, px.value)); py.value = Math.max(-maxY, Math.min(maxY, py.value));
    savedX.value = px.value; savedY.value = py.value;
    commit(z, px.value, py.value);
  }
  const webWheel = Platform.OS === 'web' ? {
    onWheel: (e: any) => { e.preventDefault?.(); setZoom(zoom.value - e.deltaY * 0.0025); },
  } : {};

  const filter = previewFilter(slide.adjust);
  const showGrid = gridWhen === 'always' || dragging;

  return (
    <View style={[s.frame, { width: frameW, height: frameH, borderRadius: radius }]} testID="slide-crop-frame" {...webWheel}>
      <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[{ position: 'absolute', left: (frameW - baseW) / 2, top: (frameH - baseH) / 2, width: baseW, height: baseH }, imageStyle]}>
            {slide.kind === 'video' ? (
              <CropVideo uri={slide.uri} start={slide.trimStart} end={slide.trimEnd} w={baseW} h={baseH} filter={filter} playing={playing} />
            ) : (
              <Image source={{ uri: slide.uri }} style={[{ width: baseW, height: baseH }, filter ? ({ filter } as any) : null]} resizeMode="cover" />
            )}
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {showGrid ? (
          <>
            {[1, 2].map((i) => <View key={`v${i}`} style={[s.gridV, { left: (frameW / 3) * i }]} />)}
            {[1, 2].map((i) => <View key={`h${i}`} style={[s.gridH, { top: (frameH / 3) * i }]} />)}
          </>
        ) : null}
        {gridWhen === 'always' ? (
          <>
            <View style={[s.corner, { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 }]} />
            <View style={[s.corner, { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 }]} />
            <View style={[s.corner, { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 }]} />
            <View style={[s.corner, { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 }]} />
          </>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: CP.surface },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: CP.silver },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: CP.silver },
  corner: { position: 'absolute', width: 22, height: 22, borderColor: CP.white },
});
