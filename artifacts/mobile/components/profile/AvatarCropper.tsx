/**
 * Full-screen "Move and scale" step shown after someone picks a profile
 * picture (Instagram / TikTok edit-profile-photo style): the photo sits
 * behind a circular cut-out in a darkened scrim, drag moves it, pinch zooms
 * it (from "just covers the circle" up to 4x), and Done crops exactly what
 * is inside the circle to an 800x800 JPEG via expo-image-manipulator.
 *
 * Replaces the system `allowsEditing` crop for avatars — that one is a
 * square, not the circle the avatar is actually shown in.
 *
 * Web (best effort): the same pan/pinch gestures via gesture-handler, plus
 * mouse-wheel / trackpad zoom.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { FONT, FS, SP } from '@/lib/theme';
import {
  AVATAR_OUTPUT_SIZE,
  clampOffset,
  clampZoom,
  coverScale,
  cropRectFor,
  offsetForFocalZoom,
} from '@/lib/avatarCrop';

export type AvatarCropSource = { uri: string; width?: number; height?: number };
export type AvatarCropResult = { uri: string; width: number; height: number };

// Fixed black/white chrome regardless of app theme — a photo editor reads
// best on black, like Instagram's and TikTok's.
const INK = '#FFFFFF'; // theme-exempt: fixed photo-editor chrome
const SCRIM = 'rgba(0,0,0,0.62)'; // theme-exempt: fixed photo-editor scrim
const CANVAS = '#000000'; // theme-exempt: fixed photo-editor canvas
const GUIDE = 'rgba(255,255,255,0.45)'; // theme-exempt: fixed photo-editor guide line
const SIDE_GUTTER = 16;
// Thick enough to cover any phone/tablet screen from the circle outward.
const SCRIM_BORDER = 2000;

export function AvatarCropper({
  source,
  onCancel,
  onDone,
}: {
  /** The picked photo; the cropper is visible while this is set. */
  source: AvatarCropSource | null;
  onCancel: () => void;
  onDone: (result: AvatarCropResult) => void;
}) {
  return (
    <Modal visible={!!source} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel} statusBarTranslucent>
      {source ? (
        <ModalSafeArea>
          <GestureHandlerRootView style={styles.root}>
            <CropStage source={source} onCancel={onCancel} onDone={onDone} />
          </GestureHandlerRootView>
        </ModalSafeArea>
      ) : null}
    </Modal>
  );
}

function CropStage({
  source,
  onCancel,
  onDone,
}: {
  source: AvatarCropSource;
  onCancel: () => void;
  onDone: (result: AvatarCropResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const [stage, setStage] = useState({ w: winW, h: 0 });
  const [size, setSize] = useState<{ w: number; h: number } | null>(
    source.width && source.height ? { w: source.width, h: source.height } : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (size) return;
    Image.getSize(source.uri, (w, h) => setSize({ w, h }), () => setError('Couldn’t load this photo.'));
  }, [size, source.uri]);

  const diameter = Math.max(120, Math.min(stage.w - SIDE_GUTTER * 2, stage.h - SP.xl * 2));
  const imgW = size?.w ?? 1;
  const imgH = size?.h ?? 1;
  const base = coverScale(imgW, imgH, diameter);
  const centreX = stage.w / 2;
  const centreY = stage.h / 2;

  const zoom = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  // A new photo or a resized stage starts from the centred cover fit again.
  useEffect(() => {
    zoom.value = 1;
    tx.value = 0;
    ty.value = 0;
  }, [source.uri, diameter, zoom, tx, ty]);

  const applyZoom = useCallback((nextZoom: number, focalX: number, focalY: number) => {
    'worklet';
    const from = zoom.value;
    const to = clampZoom(nextZoom);
    const scale = base * to;
    tx.value = clampOffset(offsetForFocalZoom(tx.value, focalX, from, to), imgW, scale, diameter);
    ty.value = clampOffset(offsetForFocalZoom(ty.value, focalY, from, to), imgH, scale, diameter);
    zoom.value = to;
  }, [base, diameter, imgW, imgH, zoom, tx, ty]);

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onChange((e) => {
      const scale = base * zoom.value;
      tx.value = clampOffset(tx.value + e.changeX, imgW, scale, diameter);
      ty.value = clampOffset(ty.value + e.changeY, imgH, scale, diameter);
    });

  const pinch = Gesture.Pinch().onChange((e) => {
    applyZoom(zoom.value * e.scaleChange, e.focalX - centreX, e.focalY - centreY);
  });

  const gesture = Gesture.Simultaneous(pan, pinch);

  // Web: wheel / trackpad zoom about the pointer.
  const stageRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = stageRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = node.getBoundingClientRect();
      applyZoom(zoom.value * Math.exp(-ev.deltaY / 300), ev.clientX - rect.left - centreX, ev.clientY - rect.top - centreY);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [applyZoom, centreX, centreY, zoom]);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: zoom.value }],
  }));

  const finish = useCallback(async (z: number, x: number, y: number) => {
    if (!size) return;
    setSaving(true);
    setError(null);
    try {
      const rect = cropRectFor({ imageW: size.w, imageH: size.h, diameter, zoom: z, tx: x, ty: y });
      const out = await manipulateAsync(
        source.uri,
        [{ crop: rect }, { resize: { width: AVATAR_OUTPUT_SIZE, height: AVATAR_OUTPUT_SIZE } }],
        { compress: 0.88, format: SaveFormat.JPEG },
      );
      onDone({ uri: out.uri, width: out.width, height: out.height });
    } catch {
      setError('Couldn’t crop this photo. Try again.');
      setSaving(false);
    }
  }, [diameter, onDone, size, source.uri]);

  const done = useCallback(() => {
    // Read the shared values on the JS thread at tap time.
    void finish(zoom.value, tx.value, ty.value);
  }, [finish, zoom, tx, ty]);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.bar}>
        <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cancel" testID="avatar-crop-cancel">
          <Text style={styles.barAction}>Cancel</Text>
        </Pressable>
        <Text style={styles.barTitle} accessibilityRole="header">Move and scale</Text>
        <Pressable
          onPress={done}
          disabled={!size || saving}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Done"
          testID="avatar-crop-done"
          style={styles.doneWrap}
        >
          {saving ? <ActivityIndicator color={INK} /> : <Text style={[styles.barAction, styles.barDone, !size && styles.disabled]}>Done</Text>}
        </Pressable>
      </View>

      <GestureDetector gesture={gesture}>
        <View
          ref={stageRef}
          style={styles.stage}
          collapsable={false}
          onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          testID="avatar-crop-stage"
        >
          {size && stage.h > 0 ? (
            <Animated.Image
              source={{ uri: source.uri }}
              resizeMode="cover"
              style={[
                {
                  position: 'absolute',
                  width: imgW * base,
                  height: imgH * base,
                  left: centreX - (imgW * base) / 2,
                  top: centreY - (imgH * base) / 2,
                },
                imageStyle,
              ]}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <ActivityIndicator color={INK} style={StyleSheet.absoluteFill} />
          )}
          {stage.h > 0 ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: diameter + SCRIM_BORDER * 2,
                height: diameter + SCRIM_BORDER * 2,
                left: centreX - diameter / 2 - SCRIM_BORDER,
                top: centreY - diameter / 2 - SCRIM_BORDER,
                borderRadius: diameter / 2 + SCRIM_BORDER,
                borderWidth: SCRIM_BORDER,
                borderColor: SCRIM,
              }}
              testID="avatar-crop-mask"
            />
          ) : null}
          {stage.h > 0 ? (
            // Faint guide on the cut-out's edge so the circle reads even over a
            // dark photo (editor chrome, not part of the saved picture).
            <View
              pointerEvents="none"
              style={{
                position: 'absolute', width: diameter, height: diameter, borderRadius: diameter / 2,
                left: centreX - diameter / 2, top: centreY - diameter / 2,
                borderWidth: StyleSheet.hairlineWidth, borderColor: GUIDE,
              }}
            />
          ) : null}
        </View>
      </GestureDetector>

      <Text style={styles.hint}>{error ?? (Platform.OS === 'web' ? 'Drag to move · Scroll or pinch to zoom' : 'Drag to move · Pinch to zoom')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CANVAS },
  bar: {
    height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, zIndex: 2, backgroundColor: CANVAS,
  },
  barTitle: { color: INK, fontFamily: FONT.semibold, fontSize: FS.base },
  barAction: { color: INK, fontFamily: FONT.regular, fontSize: FS.base },
  barDone: { fontFamily: FONT.semibold },
  doneWrap: { minWidth: 44, alignItems: 'flex-end' },
  disabled: { opacity: 0.4 },
  stage: { flex: 1, overflow: 'hidden', backgroundColor: CANVAS },
  hint: {
    color: 'rgba(255,255,255,0.72)', // theme-exempt: fixed photo-editor chrome
    textAlign: 'center', fontFamily: FONT.regular, fontSize: FS.sm,
    paddingVertical: SP.md, backgroundColor: CANVAS, zIndex: 2,
  },
});
