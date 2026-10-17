/**
 * Shared native-feeling photo pager (feed, viewer, profile-opened viewer):
 *  - UI-thread RNGH + Reanimated paging with momentum and rubber-band edges.
 *  - Manual 10pt direction lock: horizontal claims the touch, vertical fails
 *    immediately so the parent vertical scroll owns it.
 *  - Pinch up to 4x around the focal point, panning while pinching.
 *    mode 'reset'  (feed):   springs home on release; lifted above nav via PhotoZoomHost.
 *    mode 'persistent' (viewer): stays zoomed; swipes pan; double tap / pinch-out resets.
 *  - Single/double tap are NOT handled while unzoomed: the parent Pressable
 *    keeps owning double-tap like (no duplicate handler).
 *  - Remembers the index per post (lib/carouselMemory) and preloads neighbours.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  measure, runOnJS, useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { rememberSlide, rememberedSlide, subscribeSlide } from '@/lib/carouselMemory';
import {
  clampPan, focalZoom, pagerOffset, panMoveDecision, pinchTouchDecision, releaseZoom, snapIndex, touchDownLock,
  type TouchLock, type ZoomMode,
} from '@/lib/carouselGestureMath';
import { useIsFocused } from 'expo-router';
import { useParentScrollGesture } from './ParentScrollGesture';
import { CREATE_CANVAS as MEDIA, FONT } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { containRect } from '@/components/buyer-feed/photoSlideGeometry';
import { PhotoSlide } from './PhotoSlide';
import { hideZoomLift, isZoomHostMounted, showZoomLift } from './PhotoZoomHost';

const SPRING = { damping: 26, stiffness: 260, mass: 0.9 } as const;
// CSS hidden remains programmatically scrollable: focusing a dot can shift
// the entire viewport independently of our paging transform. CSS clip cannot
// scroll. RN's native style union omits this web-only overflow value.
const WEB_NONSCROLL_CLIP = { overflow: 'clip' as ViewStyle['overflow'] };

export type ZoomablePhotoPagerProps = {
  /** Remembered-index key; omit to not remember. */
  postId?: string;
  /** One entry per page; '' for a page rendered by `renderPage`. */
  uris: string[];
  width: number;
  height: number;
  aspects?: (number | null | undefined)[];
  mode: ZoomMode;
  /** Custom (non-zoomable) page, e.g. a video slide. Return null to use the photo slide. */
  renderPage?: (index: number, active: boolean) => React.ReactNode | null;
  showCounter?: boolean;
  counterTop?: number;
  /** 'overlay' draws dots inside the frame at `dotsBottom`; 'below' draws them under it. */
  dotsPlacement?: 'overlay' | 'below';
  dotsBottom?: number;
  dotColor?: string;
  dotDim?: string;
  isActive?: boolean;
  onIndexChange?: (index: number) => void;
  onFirstImagePainted?: () => void;
  onZoomChange?: (zoomed: boolean) => void;
  testID?: string;
  /** Extra chrome inside the frame (e.g. web prev/next arrows). */
  renderOverlay?: (api: { index: number; count: number; zoomed: boolean; goTo: (i: number) => void }) => React.ReactNode;
};

export function ZoomablePhotoPager({
  postId, uris, width: W, height: H, aspects, mode, renderPage, showCounter = true, counterTop = 12,
  dotsPlacement = 'overlay', dotsBottom = 12, dotColor = MEDIA.white, dotDim = `${MEDIA.white}66`,
  isActive = true, onIndexChange, onFirstImagePainted, onZoomChange, testID, renderOverlay,
}: ZoomablePhotoPagerProps) {
  const pages = useMemo(() => (uris.length > 0 ? uris : ['']), [uris]);
  const count = pages.length;
  const initialIndex = useMemo(() => (postId ? rememberedSlide(postId, count) : 0), [postId, count]);
  const [index, setIndex] = useState(initialIndex);
  const [liveIndex, setLiveIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const indexRef = useRef(initialIndex);
  const aspectByIndex = useRef<Record<number, number>>({});

  const surfaceRef = useAnimatedRef<Animated.View>();
  const offset = useSharedValue(-initialIndex * W);
  const idx = useSharedValue(initialIndex);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const zoomedSV = useSharedValue(false);
  const pinching = useSharedValue(false);
  const lifted = useSharedValue(false);
  const touchLock = useSharedValue<TouchLock>('');
  const multiTouch = useSharedValue(false);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const panTx0 = useSharedValue(0);
  const panTy0 = useSharedValue(0);
  const pinch0 = useSharedValue({ scale: 1, tx: 0, ty: 0, fx: 0, fy: 0 });
  const content = useSharedValue({ w: W, h: H });

  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const isPhotoPage = useCallback((i: number) => !!pages[i] && !(renderPage && renderPage(i, false) !== null), [pages, renderPage]);
  const zoomEnabled = isPhotoPage(index);

  const syncContent = useCallback((i: number) => {
    const r = containRect(W, H, aspects?.[i] ?? aspectByIndex.current[i]);
    content.value = { w: r.width || W, h: r.height || H };
  }, [W, H, aspects, content]);

  const commit = useCallback((next: number) => {
    const c = Math.max(0, Math.min(count - 1, next));
    syncContent(c);
    if (c === indexRef.current) return;
    indexRef.current = c;
    setIndex(c);
    setLiveIndex(c);
    if (postId) rememberSlide(postId, c);
    onIndexChangeRef.current?.(c);
  }, [count, postId, syncContent]);

  const setZoomedJS = useCallback((z: boolean) => {
    setZoomed(z);
    onZoomChangeRef.current?.(z);
  }, []);

  useEffect(() => { onIndexChangeRef.current?.(initialIndex); }, [initialIndex]);
  // Re-anchor on size change or when the remembered index changes (new post).
  useEffect(() => {
    idx.value = indexRef.current;
    offset.value = -indexRef.current * W;
    syncContent(indexRef.current);
  }, [W, H, idx, offset, syncContent]);

  // Preload one ahead and one behind.
  useEffect(() => {
    if (!isActive) return;
    const n = [pages[index + 1], pages[index - 1]].filter((u): u is string => !!u);
    if (n.length > 0) void Image.prefetch(n).catch(() => false);
  }, [index, isActive, pages]);

  // Live counter / dots follow the drag, not only the settle.
  useAnimatedReaction(
    () => (W > 0 ? Math.max(0, Math.min(count - 1, Math.round(-offset.value / W))) : 0),
    (cur, prev) => { if (cur !== prev) runOnJS(setLiveIndex)(cur); },
    [W, count],
  );

  const onAspect = useCallback((i: number, a: number) => {
    aspectByIndex.current[i] = a;
    if (i === indexRef.current) syncContent(i);
  }, [syncContent]);

  const resetZoomAnimated = useCallback(() => {
    scale.value = withSpring(1, SPRING);
    tx.value = withSpring(0, SPRING);
    ty.value = withSpring(0, SPRING);
    zoomedSV.value = false;
    setZoomedJS(false);
  }, [scale, tx, ty, zoomedSV, setZoomedJS]);

  const goTo = useCallback((i: number) => {
    const c = Math.max(0, Math.min(count - 1, i));
    if (zoomedSV.value) resetZoomAnimated();
    idx.value = c;
    offset.value = withSpring(-c * W, { ...SPRING, overshootClamping: true });
    commit(c);
  }, [W, commit, count, idx, offset, resetZoomAnimated, zoomedSV]);

  // Retained screens follow the shared per-post index (viewer <-> feed <-> profile).
  useEffect(() => {
    if (!postId) return undefined;
    const jump = (i: number) => {
      const c = Math.max(0, Math.min(count - 1, i));
      if (c === indexRef.current) return;
      idx.value = c;
      offset.value = -c * W;
      indexRef.current = c;
      setIndex(c);
      setLiveIndex(c);
      syncContent(c);
      onIndexChangeRef.current?.(c);
    };
    jump(rememberedSlide(postId, count));
    return subscribeSlide(postId, jump);
  }, [postId, count, W, idx, offset, syncContent]);

  const liftCurrent = useCallback((rect: { x: number; y: number; width: number; height: number }, i: number) => {
    const uri = pages[i];
    if (!uri || !isZoomHostMounted() || !pinching.value) return;
    showZoomLift({ uri, rect, scale, tx, ty, lifted });
  }, [pages, scale, tx, ty, lifted, pinching]);
  const unlift = useCallback(() => hideZoomLift(lifted), [lifted]);
  const canLift = mode === 'reset';
  const parentScroll = useParentScrollGesture();

  // Canceled pinch / blur / page deactivation: never leave zoom or a lifted copy behind.
  const cancelZoom = useCallback(() => {
    pinching.value = false;
    scale.value = 1; tx.value = 0; ty.value = 0;
    if (zoomedSV.value) { zoomedSV.value = false; setZoomedJS(false); }
    hideZoomLift(lifted);
  }, [pinching, scale, tx, ty, zoomedSV, setZoomedJS, lifted]);
  const focused = useIsFocused();
  useEffect(() => { if (!focused || !isActive) cancelZoom(); }, [focused, isActive, cancelZoom]);

  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      // First finger = new touch sequence; later fingers never unlock a sticky direction.
      touchLock.value = touchDownLock(touchLock.value, e.numberOfTouches);
      if (e.numberOfTouches <= 1) multiTouch.value = false; else multiTouch.value = true;
      if (e.numberOfTouches === 1 && e.allTouches[0]) {
        touchX.value = e.allTouches[0].absoluteX;
        touchY.value = e.allTouches[0].absoluteY;
      }
    })
    .onTouchesMove((e, manager) => {
      if (e.numberOfTouches >= 2) multiTouch.value = true;
      const t = e.allTouches[0];
      if (!t) return;
      const d = panMoveDecision(
        touchLock.value, t.absoluteX - touchX.value, t.absoluteY - touchY.value,
        pinching.value ? 2 : e.numberOfTouches, zoomedSV.value, count,
      );
      touchLock.value = d.lock;
      if (d.action === 'activate') manager.activate();
      else if (d.action === 'fail') manager.fail();
    })
    .onStart(() => { panTx0.value = tx.value; panTy0.value = ty.value; })
    .onUpdate((e) => {
      if (pinching.value) return;
      if (zoomedSV.value) {
        const c = clampPan(panTx0.value + e.translationX, panTy0.value + e.translationY, scale.value, W, H, content.value.w, content.value.h);
        tx.value = c.tx; ty.value = c.ty;
        return;
      }
      offset.value = pagerOffset(e.translationX, idx.value, count, W);
    })
    .onEnd((e) => {
      if (zoomedSV.value) return;
      // A pinch joined this touch: never turn the remaining finger into a page swipe.
      const next = pinching.value || multiTouch.value ? idx.value : snapIndex(idx.value, e.translationX, e.velocityX, count, W);
      idx.value = next;
      offset.value = withSpring(-next * W, { ...SPRING, velocity: e.velocityX, overshootClamping: true });
      runOnJS(commit)(next);
    });

  const pinch = Gesture.Pinch()
    .enabled(zoomEnabled)
    .manualActivation(true)
    // On web, pointer-add callbacks run BEFORE the scale detector computes
    // its focal point. Wait for movement so onStart never captures undefined
    // coordinates (which would turn every subsequent zoom transform into NaN).
    .onTouchesMove((e, manager) => {
      const d = pinchTouchDecision(touchLock.value, e.numberOfTouches, zoomEnabled);
      if (d === 'activate') manager.activate();
      else if (d === 'fail') manager.fail();
    })
    .onStart((e) => {
      pinching.value = true;
      zoomedSV.value = true;
      runOnJS(setZoomedJS)(true);
      // Settle the pager if a page swipe was mid-flight.
      offset.value = -idx.value * W;
      pinch0.value = { scale: scale.value, tx: tx.value, ty: ty.value, fx: e.focalX - W / 2, fy: e.focalY - H / 2 };
      if (canLift && !lifted.value) {
        const m = measure(surfaceRef);
        if (m) {
          const cw = content.value.w, ch = content.value.h;
          runOnJS(liftCurrent)({ x: m.pageX + (W - cw) / 2, y: m.pageY + (H - ch) / 2, width: cw, height: ch }, idx.value);
        }
      }
    })
    .onUpdate((e) => {
      const p = pinch0.value;
      const z = focalZoom({ scale: p.scale, tx: p.tx, ty: p.ty }, p.fx, p.fy, e.focalX - W / 2, e.focalY - H / 2, e.scale, mode === 'reset' ? 1 : 0.8);
      scale.value = z.scale; tx.value = z.tx; ty.value = z.ty;
    })
    .onEnd(() => {
      const r = releaseZoom(mode, { scale: scale.value, tx: tx.value, ty: ty.value }, W, H, content.value.w, content.value.h);
      tx.value = withSpring(r.tx, SPRING);
      ty.value = withSpring(r.ty, SPRING);
      scale.value = withSpring(r.scale, SPRING, (finished) => {
        if (finished && !r.zoomed && canLift) runOnJS(unlift)();
      });
      if (zoomedSV.value !== r.zoomed) { zoomedSV.value = r.zoomed; runOnJS(setZoomedJS)(r.zoomed); }
    })
    .onFinalize((_e, success) => {
      const wasPinching = pinching.value;
      pinching.value = false;
      if (!success && wasPinching) {
        // Canceled/failed pinch: spring home and drop any lifted copy.
        scale.value = withSpring(1, SPRING);
        tx.value = withSpring(0, SPRING);
        ty.value = withSpring(0, SPRING);
        if (zoomedSV.value) { zoomedSV.value = false; runOnJS(setZoomedJS)(false); }
        runOnJS(unlift)();
      }
    });

  // Native parent scroll waits for these; vertical manual failure releases it.
  if (parentScroll) {
    pan.blocksExternalGesture(parentScroll);
    pinch.blocksExternalGesture(parentScroll);
  }

  // Only while zoomed: double tap resets. Unzoomed taps stay with the parent (like).
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .enabled(zoomed)
    .onEnd(() => {
      scale.value = withSpring(1, SPRING);
      tx.value = withSpring(0, SPRING);
      ty.value = withSpring(0, SPRING);
      zoomedSV.value = false;
      runOnJS(setZoomedJS)(false);
    });

  const gesture = Gesture.Simultaneous(pan, pinch, doubleTap);

  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const zoomStyle = useAnimatedStyle(() => ({
    opacity: lifted.value ? 0 : 1,
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  // Safety: never leave a lifted copy behind on unmount.
  useEffect(() => () => hideZoomLift(lifted), [lifted]);

  const dots = count > 1 ? (
    <View
      style={dotsPlacement === 'overlay' ? [styles.dotsOverlay, { bottom: dotsBottom }] : styles.dotsBelow}
      testID="carousel-dots"
      accessibilityLabel={`Slide ${liveIndex + 1} of ${count}`}
    >
      {pages.map((_, i) => (
        <Pressable
          key={i}
          // Dots never reach the parent's like / pause Pressable.
          onPressIn={(e) => e.stopPropagation?.()}
          onPressOut={(e) => e.stopPropagation?.()}
          onPress={(e) => { e.stopPropagation?.(); goTo(i); }} hitSlop={{ top: 10, bottom: 10, left: 3, right: 3 }}
          accessibilityRole="button" accessibilityLabel={`Go to slide ${i + 1}`} testID={`carousel-dot-${i}`}
        >
          <View style={[styles.dot, { backgroundColor: i === liveIndex ? dotColor : dotDim }]} />
        </Pressable>
      ))}
    </View>
  ) : null;

  return (
    <View style={{ width: W }} testID={testID}>
      <GestureDetector gesture={gesture} touchAction={zoomed ? 'none' : 'pan-y'}>
        <Animated.View ref={surfaceRef} style={[styles.surface, Platform.OS === 'web' && WEB_NONSCROLL_CLIP, { width: W, height: H }]} testID="photo-carousel-surface" collapsable={false}>
          <Animated.View style={[{ width: W * count, height: H, flexDirection: 'row' }, trackStyle]}>
            {pages.map((uri, i) => {
              const near = Math.abs(i - liveIndex) <= 1 || i === index;
              const custom = near && renderPage ? renderPage(i, i === index) : null;
              return (
                <View key={i} style={{ width: W, height: H }}>
                  {!near ? null : custom ?? (
                    <PhotoSlide
                      uri={uri} index={i} count={count} pageWidth={W} pageHeight={H}
                      authoredAspect={aspects?.[i]}
                      priority={i === index ? 'high' : 'normal'}
                      zoomStyle={i === index ? zoomStyle : undefined}
                      onPainted={i === initialIndex ? onFirstImagePainted : undefined}
                      onAspect={onAspect}
                    />
                  )}
                </View>
              );
            })}
          </Animated.View>
          {showCounter && count > 1 ? (
            <View style={[styles.counter, { top: counterTop }]} pointerEvents="none" testID="carousel-counter">
              <Text style={styles.counterText} accessibilityLabel={`Photo ${liveIndex + 1} of ${count}`}>{`${liveIndex + 1}/${count}`}</Text>
            </View>
          ) : null}
          {dotsPlacement === 'overlay' ? dots : null}
          {renderOverlay ? renderOverlay({ index: liveIndex, count, zoomed, goTo }) : null}
        </Animated.View>
      </GestureDetector>
      {dotsPlacement === 'below' ? dots : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { overflow: 'hidden', backgroundColor: MEDIA.black },
  counter: {
    position: 'absolute', right: 12, minWidth: 38, height: 24, paddingHorizontal: 9,
    borderRadius: RADII.pill, backgroundColor: `${MEDIA.black}8C`, alignItems: 'center', justifyContent: 'center',
  },
  counterText: { color: MEDIA.white, fontFamily: FONT.semibold, fontSize: 12, letterSpacing: 0.3 },
  dotsOverlay: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dotsBelow: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
