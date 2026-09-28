/**
 * MediaCropper — the one shared cropper for the app-wide media
 * aspect-ratio system. Used by: create post (photo step), add/edit product
 * photos, and story capture (9:16 frame) — see lib/mediaCrop.ts for the
 * underlying crop math and why it stores a normalized rect rather than
 * only applying the crop immediately.
 *
 * Mobbin reference: Instagram's own post-creation crop screen (pinch/pan
 * inside a fixed frame, grid lines while dragging, a single frame per
 * context rather than an aspect-ratio picker) and the story composer's 9:16
 * capture frame.
 *
 * Fixed `targetRatio` frame (3/4 for photos, 9/16 for stories/video covers)
 * — no aspect-ratio toggle. The creator pans (one-finger drag / mouse drag)
 * and pinch-zooms (two-finger / mouse wheel / the zoom slider on web) the
 * source image inside that frame. Minimum zoom always exactly fills the
 * frame — the crop math in lib/mediaCrop.ts guarantees the crop box can
 * never exceed the source image's own bounds, so there's never an empty
 * bar around the frame.
 *
 * Gestures run on the UI thread via react-native-gesture-handler +
 * react-native-reanimated (same primitives as
 * components/design-studio/CanvasGestureLayer.tsx), so panning/zooming a
 * multi-megapixel photo stays smooth even while the JS thread is busy.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, Image as RNImage, Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import {
  DEFAULT_CROP_TRANSFORM, MIN_SCALE_DEFAULT, MAX_SCALE_DEFAULT,
  normalizeCropRect, resolvePixelCropRect, transformFromNormalizedRect,
  type CropTransform, type NormalizedCropRect,
} from '@/lib/mediaCrop';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const FRAME_MARGIN = SP.lg;

export interface MediaCropperResult {
  rect: NormalizedCropRect;
  sourceWidth: number;
  sourceHeight: number;
}

export interface MediaCropperProps {
  visible: boolean;
  /** The ORIGINAL, uncropped source image URI — always crop from source, never from a previous crop's output. */
  uri: string;
  /** width / height, e.g. 3/4 for photos, 9/16 for stories. */
  targetRatio: number;
  /** Pass the previously-saved rect to reopen "Edit crop" framed where the creator left it. */
  initialRect?: NormalizedCropRect | null;
  title?: string;
  onCancel: () => void;
  onSave: (result: MediaCropperResult) => void;
}

export function MediaCropper({
  visible, uri, targetRatio, initialRect, title = 'Crop photo', onCancel, onSave,
}: MediaCropperProps) {
  const { theme } = useAppTheme();
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [gesturing, setGesturing] = useState(false);

  const frameWidth = Math.min(SCREEN_W, 480) - FRAME_MARGIN * 2;
  const frameHeight = frameWidth / targetRatio;

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const [sliderScale, setSliderScale] = useState(1);

  useEffect(() => {
    if (!visible || !uri) return;
    let cancelled = false;
    RNImage.getSize(uri, (width, height) => {
      if (cancelled) return;
      setSourceSize({ width, height });
      const initialTransform = initialRect
        ? transformFromNormalizedRect(initialRect, width, height)
        : DEFAULT_CROP_TRANSFORM;
      scale.value = initialTransform.scale;
      savedScale.value = initialTransform.scale;
      setSliderScale(initialTransform.scale);
      // tx/ty are in source pixels; convert to screen pixels for the live
      // gesture (see baseCoverScale below) once we know source size.
      const baseCoverScale = Math.max(frameWidth / width, frameHeight / height);
      translateX.value = -initialTransform.tx * baseCoverScale * initialTransform.scale;
      translateY.value = -initialTransform.ty * baseCoverScale * initialTransform.scale;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    }, () => { /* leave sourceSize null — cropper shows a loading state */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, uri, initialRect]);

  // Base "cover" scale so the image fills the frame with zero empty space
  // at pinch-scale 1 — the minimum-zoom guarantee.
  const baseCoverScale = sourceSize
    ? Math.max(frameWidth / sourceSize.width, frameHeight / sourceSize.height)
    : 1;
  const renderWidth = sourceSize ? sourceSize.width * baseCoverScale : frameWidth;
  const renderHeight = sourceSize ? sourceSize.height * baseCoverScale : frameHeight;

  function clampToFrame(nextScale: number, x: number, y: number) {
    'worklet';
    const w = renderWidth * nextScale;
    const h = renderHeight * nextScale;
    const maxX = Math.max(0, (w - frameWidth) / 2);
    const maxY = Math.max(0, (h - frameHeight) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }

  const pinch = Gesture.Pinch()
    .onBegin(() => { runOnJS(setGesturing)(true); })
    .onUpdate((e) => {
      const next = Math.max(MIN_SCALE_DEFAULT, Math.min(MAX_SCALE_DEFAULT, savedScale.value * e.scale));
      scale.value = next;
      const clamped = clampToFrame(next, translateX.value, translateY.value);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(setSliderScale)(scale.value);
      runOnJS(setGesturing)(false);
    });

  const pan = Gesture.Pan()
    .onBegin(() => { runOnJS(setGesturing)(true); })
    .onUpdate((e) => {
      const clamped = clampToFrame(scale.value, savedTranslateX.value + e.translationX, savedTranslateY.value + e.translationY);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(setGesturing)(false);
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  const imageStyle = useAnimatedStyle(() => ({
    width: renderWidth,
    height: renderHeight,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  function applySliderScale(next: number) {
    const clampedScale = Math.max(MIN_SCALE_DEFAULT, Math.min(MAX_SCALE_DEFAULT, next));
    scale.value = clampedScale;
    savedScale.value = clampedScale;
    const clamped = clampToFrame(clampedScale, translateX.value, translateY.value);
    translateX.value = clamped.x;
    translateY.value = clamped.y;
    savedTranslateX.value = clamped.x;
    savedTranslateY.value = clamped.y;
    setSliderScale(clampedScale);
  }

  // Web: mouse wheel zooms, matching the on-screen zoom slider (also web-only
  // — touch devices already have pinch). RN's View type doesn't declare
  // onWheel, but react-native-web forwards unknown props to the underlying
  // DOM node, so this reaches a real wheel listener there.
  const webWheelProps = Platform.OS === 'web' ? {
    onWheel: (e: any) => {
      e.preventDefault?.();
      applySliderScale(scale.value - e.deltaY * 0.0025);
    },
  } : {};

  function handleSave() {
    if (!sourceSize) return;
    // Convert the live screen-space gesture state back into the source-pixel
    // CropTransform lib/mediaCrop.ts works in.
    const finalScale = scale.value;
    const tx = -translateX.value / (baseCoverScale * finalScale);
    const ty = -translateY.value / (baseCoverScale * finalScale);
    const transform: CropTransform = { scale: finalScale, tx, ty };
    const pixelRect = resolvePixelCropRect(sourceSize.width, sourceSize.height, targetRatio, transform);
    const rect = normalizeCropRect(pixelRect, sourceSize.width, sourceSize.height);
    onSave({ rect, sourceWidth: sourceSize.width, sourceHeight: sourceSize.height });
  }

  if (!visible) return null;

  return (
    <View style={[s.root, { backgroundColor: theme.background }]} testID="media-cropper">
      <View style={s.header}>
        <PressableScale onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Cancel crop" testID="media-cropper-cancel">
          <Text style={[s.headerAction, { color: theme.text }]}>Cancel</Text>
        </PressableScale>
        <Text style={[s.headerTitle, { color: theme.text }]}>{title}</Text>
        <PressableScale onPress={handleSave} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Save crop" testID="media-cropper-save" disabled={!sourceSize}>
          <Text style={[s.headerAction, s.headerActionPrimary, { color: theme.text, opacity: sourceSize ? 1 : 0.4 }]}>Done</Text>
        </PressableScale>
      </View>

      <View style={s.stage}>
        <View
          style={[s.frame, { width: frameWidth, height: frameHeight }]}
          {...webWheelProps}
        >
          <GestureDetector gesture={composed}>
            <View style={StyleSheet.absoluteFill}>
              {sourceSize && (
                <Animated.View style={imageStyle}>
                  <CachedImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                </Animated.View>
              )}
            </View>
          </GestureDetector>

          {gesturing && (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              {[1, 2].map((i) => (
                <View key={`v${i}`} style={[s.gridLineV, { left: (frameWidth / 3) * i }]} />
              ))}
              {[1, 2].map((i) => (
                <View key={`h${i}`} style={[s.gridLineH, { top: (frameHeight / 3) * i }]} />
              ))}
            </View>
          )}
        </View>
      </View>

      <View style={s.footer}>
        {/* Zoom slider — the web fallback for pinch, alongside the wheel
            listener above; also usable on touch as a coarse zoom control. */}
        <View style={s.sliderRow} testID="media-cropper-zoom-slider">
          <Feather name="zoom-out" size={16} color={theme.muted} />
          <ZoomTrack value={sliderScale} min={MIN_SCALE_DEFAULT} max={MAX_SCALE_DEFAULT} onChange={applySliderScale} />
          <Feather name="zoom-in" size={16} color={theme.muted} />
        </View>
        <Text style={[s.hint, { color: theme.muted }]}>Drag to reposition · Pinch or use the slider to zoom</Text>
      </View>
    </View>
  );
}

/** A minimal draggable zoom track (no slider library in this project) built
 *  on the same Gesture.Pan primitive as the cropper itself. */
function ZoomTrack({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  const { theme } = useAppTheme();
  const TRACK_WIDTH = 160;
  const progress = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const startProgress = useSharedValue(progress);

  function progressToValue(p: number) {
    return min + Math.max(0, Math.min(1, p)) * (max - min);
  }

  const pan = Gesture.Pan()
    .onBegin(() => { startProgress.value = progress; })
    .onUpdate((e) => {
      const next = startProgress.value + e.translationX / TRACK_WIDTH;
      runOnJS(onChange)(progressToValue(next));
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={[s.track, { width: TRACK_WIDTH, backgroundColor: theme.border }]} testID="media-cropper-zoom-track">
        <View style={[s.trackFill, { width: TRACK_WIDTH * progress, backgroundColor: theme.text }]} />
        <View style={[s.trackThumb, { left: TRACK_WIDTH * progress - 8, backgroundColor: theme.text }]} />
      </View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, position: Platform.OS === 'web' ? 'fixed' as any : 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingTop: SP.xl, paddingBottom: SP.md,
  },
  headerAction: { fontSize: FS.base, fontFamily: FONT.medium },
  headerActionPrimary: { fontFamily: FONT.bold },
  headerTitle: { fontSize: FS.base, fontFamily: FONT.semibold },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { overflow: 'hidden', borderRadius: RADIUS.sm },
  gridLineV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.55)' },
  gridLineH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.55)' },
  footer: { paddingHorizontal: SP.lg, paddingBottom: SP.xl, gap: SP.sm, alignItems: 'center' },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  hint: { fontSize: FS.xs, fontFamily: FONT.regular },
  track: { height: 4, borderRadius: 2, justifyContent: 'center' },
  trackFill: { position: 'absolute', left: 0, height: 4, borderRadius: 2 },
  trackThumb: { position: 'absolute', width: 16, height: 16, borderRadius: 8, top: -6 },
});
