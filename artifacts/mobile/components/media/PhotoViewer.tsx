/**
 * Full-screen product photo viewer (Dev's less-AI pass, items 52 + 53).
 *
 * Reference: Faire Wholesale, "Image preview" — tap a product photo and it
 * opens edge to edge on black with a close (X) top right and a thumbnail
 * strip along the bottom; swipe sideways between photos. Reskinned in
 * Brandthread's black / white / silver.
 *
 *  - Pinch to zoom (1x–4x) around the pinch point; drag to look around
 *    while zoomed; double-tap zooms in to 2.5x / back out.
 *  - Swipe down (unzoomed) to close: the photo follows the finger, shrinks
 *    and rounds its corners (Instagram), and the black backdrop thins out with it, so the gesture shows what it will do;
 *    let go past the threshold and it closes, otherwise it settles back.
 *  - Motion only reports a gesture — no decorative animation.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { CREATE_CANVAS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { backdropOpacityFor, dragRadiusFor, dragScaleFor, shouldDismiss } from '@/lib/mediaDismiss';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const SETTLE = { duration: 180 };
const THUMB_WIDTH = 44;
const THUMB_HEIGHT = 55; // 4:5, the product photo frame

export interface PhotoViewerProps {
  visible: boolean;
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}

export function PhotoViewer({ visible, images, initialIndex = 0, onClose }: PhotoViewerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const listRef = useRef<FlatList<string>>(null);
  const thumbsRef = useRef<FlatList<string>>(null);
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const backdrop = useSharedValue(1);

  useEffect(() => {
    if (!visible) return;
    setIndex(initialIndex);
    setZoomed(false);
    backdrop.value = 1;
  }, [visible, initialIndex, backdrop]);

  const goTo = useCallback((next: number) => {
    setIndex(next);
    listRef.current?.scrollToIndex({ index: next, animated: true });
  }, []);

  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(Math.max(0, Math.min(images.length - 1, next)));
  }, [width, images.length]);

  useEffect(() => {
    if (images.length > 1) thumbsRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }, [index, images.length]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: backdrop.value < 1 ? 0 : 1 }));

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose} supportedOrientations={['portrait']}>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
        <FlatList
          ref={listRef}
          data={images}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed && images.length > 1}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={Math.min(initialIndex, Math.max(0, images.length - 1))}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(uri, i) => `${uri}-${i}`}
          onMomentumScrollEnd={onMomentumEnd}
          renderItem={({ item, index: i }) => (
            <ZoomablePhoto
              uri={item}
              width={width}
              height={height}
              active={i === index}
              backdrop={backdrop}
              onZoomChange={setZoomed}
              onDismiss={onClose}
            />
          )}
        />

        <Animated.View style={[styles.close, { top: insets.top + 8 }, chromeStyle]}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            testID="photo-viewer-close"
            style={styles.closeHit}
          >
            <Feather name="x" size={26} color={theme.text} />
          </Pressable>
        </Animated.View>

        {images.length > 1 && (
          <Animated.View style={[styles.thumbBar, { paddingBottom: insets.bottom + 12 }, chromeStyle]}>
            <FlatList
              ref={thumbsRef}
              data={images}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbList}
              keyExtractor={(uri, i) => `thumb-${uri}-${i}`}
              getItemLayout={(_, i) => ({ length: THUMB_WIDTH + 8, offset: (THUMB_WIDTH + 8) * i, index: i })}
              onScrollToIndexFailed={() => {}}
              renderItem={({ item, index: i }) => (
                <Pressable
                  onPress={() => goTo(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`Photo ${i + 1} of ${images.length}`}
                  accessibilityState={{ selected: i === index }}
                  style={[styles.thumb, i === index && { borderColor: theme.text }]}
                >
                  <CachedImage source={{ uri: item }} style={styles.thumbImage} contentFit="cover" />
                </Pressable>
              )}
            />
          </Animated.View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

function ZoomablePhoto({
  uri, width, height, active, backdrop, onZoomChange, onDismiss,
}: {
  uri: string;
  width: number;
  height: number;
  active: boolean;
  backdrop: SharedValue<number>;
  onZoomChange: (zoomed: boolean) => void;
  onDismiss: () => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragX = useSharedValue(0);
  // Leaving a photo resets its zoom, so coming back shows it whole.
  useEffect(() => {
    if (active) return;
    scale.value = 1; savedScale.value = 1;
    tx.value = 0; ty.value = 0; savedTx.value = 0; savedTy.value = 0;
  }, [active, scale, savedScale, tx, ty, savedTx, savedTy]);

  const clamp = (s: number, x: number, y: number) => {
    'worklet';
    const maxX = Math.max(0, (width * s - width) / 2);
    const maxY = Math.max(0, (height * s - height) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };

  const settleZoom = (s: number, x: number, y: number) => {
    'worklet';
    const c = clamp(s, x, y);
    scale.value = withTiming(s, SETTLE);
    tx.value = withTiming(c.x, SETTLE);
    ty.value = withTiming(c.y, SETTLE);
    savedScale.value = s; savedTx.value = c.x; savedTy.value = c.y;
    runOnJS(onZoomChange)(s > 1.01);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = Math.max(1, Math.min(MAX_SCALE, savedScale.value * e.scale));
      // Keep the point under the fingers still while scaling.
      const fx = e.focalX - width / 2;
      const fy = e.focalY - height / 2;
      const ratio = next / savedScale.value;
      const c = clamp(next, fx - (fx - savedTx.value) * ratio, fy - (fy - savedTy.value) * ratio);
      scale.value = next; tx.value = c.x; ty.value = c.y;
    })
    .onEnd(() => {
      if (scale.value < 1.05) settleZoom(1, 0, 0);
      else settleZoom(scale.value, tx.value, ty.value);
    });

  // Zoomed: drag pans the photo.
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (savedScale.value <= 1.01) return;
      const c = clamp(scale.value, savedTx.value + e.translationX, savedTy.value + e.translationY);
      tx.value = c.x; ty.value = c.y;
    })
    .onEnd(() => {
      if (savedScale.value <= 1.01) return;
      savedTx.value = tx.value; savedTy.value = ty.value;
    });

  // Unzoomed: a vertical drag pulls the photo away to close. Horizontal
  // movement fails this gesture so the pager keeps paging.
  const dismiss = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .failOffsetX([-16, 16])
    .onUpdate((e) => {
      if (savedScale.value > 1.01) return;
      dragY.value = e.translationY;
      dragX.value = e.translationX;
      backdrop.value = backdropOpacityFor(e.translationY);
    })
    .onEnd((e) => {
      if (savedScale.value > 1.01) return;
      if (shouldDismiss(e.translationY, e.velocityY)) {
        runOnJS(onDismiss)();
        return;
      }
      dragY.value = withTiming(0, SETTLE);
      dragX.value = withTiming(0, SETTLE);
      backdrop.value = withTiming(1, SETTLE);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((e) => {
      if (savedScale.value > 1.01) {
        settleZoom(1, 0, 0);
        return;
      }
      const fx = e.x - width / 2;
      const fy = e.y - height / 2;
      settleZoom(DOUBLE_TAP_SCALE, -fx * (DOUBLE_TAP_SCALE - 1), -fy * (DOUBLE_TAP_SCALE - 1));
    });

  const gesture = Gesture.Simultaneous(pinch, Gesture.Exclusive(dismiss, pan), doubleTap);

  const photoStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value + dragX.value },
      { translateY: ty.value + dragY.value },
      { scale: scale.value * dragScaleFor(dragY.value) },
    ],
  }));
  // Rounds the photo's own frame: the clip is sized to the photo's contain
  // rect (once its aspect is known), so the rounded corners are the image's,
  // not the empty letterbox's.
  const frameStyle = useAnimatedStyle(() => ({ borderRadius: dragRadiusFor(dragY.value) }));
  const [aspect, setAspect] = useState<number | null>(null);
  const frame = aspect
    ? (width / height > aspect ? { width: height * aspect, height } : { width, height: width / aspect })
    : { width, height };

  // Web: the mouse wheel zooms (no pinch on a trackpad-less mouse).
  const webWheel = Platform.OS === 'web' ? {
    onWheel: (e: { deltaY: number; preventDefault?: () => void }) => {
      e.preventDefault?.();
      const next = Math.max(1, Math.min(MAX_SCALE, scale.value - e.deltaY * 0.004));
      if (next <= 1.01) settleZoom(1, 0, 0);
      else { scale.value = next; savedScale.value = next; onZoomChange(true); }
    },
  } : {};

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height }} collapsable={false} {...webWheel}>
        <Animated.View style={[styles.page, { width, height }, photoStyle]}>
          <Animated.View style={[{ ...frame, overflow: 'hidden' }, frameStyle]}>
            <CachedImage
              source={{ uri }}
              style={frame}
              contentFit="contain"
              onLoad={(e) => { const { width: w, height: h } = e.source; if (w > 0 && h > 0) setAspect(w / h); }}
              accessibilityLabel="Product photo. Pinch to zoom, swipe down to close."
            />
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: CREATE_CANVAS.black },
  page: { alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', right: 12 },
  closeHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  thumbBar: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  thumbList: { paddingHorizontal: 12, gap: 8 },
  thumb: {
    width: THUMB_WIDTH, height: THUMB_HEIGHT, borderRadius: 6, overflow: 'hidden',
    borderWidth: 1.5, borderColor: 'transparent',
  },
  thumbImage: { width: '100%', height: '100%' },
});
