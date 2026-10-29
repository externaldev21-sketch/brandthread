/**
 * Instagram's in-place feed pinch for a single photo: two fingers zoom the
 * photo right where it sits, lifted above the feed, header and tab bar
 * (PhotoZoomHost — no Modal, so the live touches survive); let go and it
 * springs home. One finger never activates it, so taps (double-tap like) and
 * vertical feed scrolling keep working: a one-finger move past 10pt fails the
 * pinch at once and hands the touch back to the scroller (inside a
 * ParentScrollGestureScope the native scroll waits for exactly that).
 *
 * Same focal math and lift as the carousel's feed mode
 * (ZoomablePhotoPager mode 'reset'); this is the single-image, cover-fit
 * version for card feeds whose photo isn't a carousel.
 */
import React, { useCallback, useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  measure, runOnJS, useAnimatedRef, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { focalZoom } from '@/lib/carouselGestureMath';
import { useParentScrollGesture } from './ParentScrollGesture';
import { hideZoomLift, isZoomHostMounted, showZoomLift } from './PhotoZoomHost';

const SPRING = { damping: 26, stiffness: 260, mass: 0.9 } as const;
/** One finger moving this far (pt) means "scroll", not "about to pinch". */
const ONE_FINGER_SLOP = 10;
/** Upper bound for the spring home (ms) before the lifted copy is dropped regardless. */
const RELEASE_MS = 700;

export function PinchToZoom({
  uri, contentFit = 'cover', borderRadius = 0, onZoomChange, children, style, testID,
}: {
  /** The photo to lift while pinching; '' / undefined disables the pinch. */
  uri?: string | null;
  contentFit?: 'contain' | 'cover';
  borderRadius?: number;
  onZoomChange?: (zoomed: boolean) => void;
  /** The photo as the card normally draws it (sized by `style`). */
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const ref = useAnimatedRef<Animated.View>();
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lifted = useSharedValue(false);
  const pinching = useSharedValue(false);
  const f0 = useSharedValue({ x: 0, y: 0 });
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const size = useSharedValue({ w: 0, h: 0 });
  /** Midpoint of the two fingers in page coordinates, and the view's page origin. */
  const mid = useSharedValue({ x: 0, y: 0 });
  const origin = useSharedValue({ x: 0, y: 0 });
  const enabled = !!uri;
  const parentScroll = useParentScrollGesture();

  const lift = useCallback((rect: { x: number; y: number; width: number; height: number }) => {
    if (!uri || !isZoomHostMounted() || !pinching.value) return;
    showZoomLift({ uri, rect, scale, tx, ty, lifted, contentFit, borderRadius });
  }, [uri, scale, tx, ty, lifted, pinching, contentFit, borderRadius]);
  const unlift = useCallback(() => hideZoomLift(lifted), [lifted]);
  const zoomChange = useCallback((z: boolean) => onZoomChange?.(z), [onZoomChange]);

  // Never leave a lifted copy behind (unmount / recycled row).
  useEffect(() => () => hideZoomLift(lifted), [lifted]);

  // The lifted copy goes once the spring home has had time to land, on a JS
  // timer, so it can never outlive the gesture even if the spring is cut short.
  const unliftSoon = useCallback(() => { setTimeout(() => hideZoomLift(lifted), RELEASE_MS); }, [lifted]);
  const release = () => {
    'worklet';
    if (!pinching.value) return;
    pinching.value = false;
    tx.value = withSpring(0, SPRING);
    ty.value = withSpring(0, SPRING);
    scale.value = withSpring(1, SPRING, (finished) => { if (finished) runOnJS(unlift)(); });
    runOnJS(unliftSoon)();
    runOnJS(zoomChange)(false);
  };

  const pinch = Gesture.Pinch()
    .enabled(enabled)
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      if (e.numberOfTouches === 1 && t) { startX.value = t.absoluteX; startY.value = t.absoluteY; }
    })
    .onTouchesMove((e, manager) => {
      if (e.numberOfTouches >= 2) {
        const [a, b] = e.allTouches;
        if (a && b) mid.value = { x: (a.absoluteX + b.absoluteX) / 2, y: (a.absoluteY + b.absoluteY) / 2 };
        manager.activate();
        return;
      }
      const t = e.allTouches[0];
      if (t && Math.hypot(t.absoluteX - startX.value, t.absoluteY - startY.value) > ONE_FINGER_SLOP) manager.fail();
    })
    .onStart(() => {
      pinching.value = true;
      // Focal point from the fingers' page positions minus the view's page
      // origin: the same on web (where the event focal is page-relative)
      // and native (view-relative).
      const m = measure(ref);
      if (m) origin.value = { x: m.pageX, y: m.pageY };
      f0.value = { x: mid.value.x - origin.value.x - size.value.w / 2, y: mid.value.y - origin.value.y - size.value.h / 2 };
      runOnJS(zoomChange)(true);
      if (m) runOnJS(lift)({ x: m.pageX, y: m.pageY, width: m.width, height: m.height });
    })
    .onUpdate((e) => {
      const fx = mid.value.x - origin.value.x - size.value.w / 2;
      const fy = mid.value.y - origin.value.y - size.value.h / 2;
      const z = focalZoom({ scale: 1, tx: 0, ty: 0 }, f0.value.x, f0.value.y, fx, fy, e.scale, 1);
      scale.value = z.scale; tx.value = z.tx; ty.value = z.ty;
    })
    // Release: onEnd for a completed pinch, onFinalize for a cancelled one —
    // whichever comes first springs home (the flag makes it run once).
    .onEnd(() => { release(); })
    .onFinalize(() => { release(); });
  if (parentScroll) pinch.blocksExternalGesture(parentScroll);

  const zoomStyle = useAnimatedStyle(() => ({
    // The lifted copy draws the zoom; the original hides under it once painted.
    opacity: lifted.value ? 0 : 1,
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={pinch} touchAction="pan-y">
      <Animated.View
        ref={ref} collapsable={false} style={style} testID={testID}
        onLayout={(e) => { size.value = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }}
      >
        <Animated.View style={zoomStyle}>{children}</Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
