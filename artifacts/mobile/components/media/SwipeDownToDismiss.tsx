/**
 * Swipe down to close, for a full-screen media viewer whose content is not a
 * zoomable photo (video, AI results). Wrap the viewer's content inside its
 * <Modal>: the content follows a downward drag and the black backdrop thins
 * with it; let go past the threshold to close, otherwise it settles back.
 * Horizontal drags fail the gesture, so pagers inside keep paging. Once a
 * vertical drag has claimed it, the content follows the finger both ways,
 * shrinks and rounds its corners (Instagram's viewer pull-down).
 * Photos use PhotoViewer, which has the same gesture plus pinch-zoom.
 */
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { CREATE_CANVAS } from '@/lib/theme';
import { backdropOpacityFor, dragRadiusFor, dragScaleFor, shouldDismiss } from '@/lib/mediaDismiss';

const SETTLE = { duration: 180 };

export function SwipeDownToDismiss({
  onDismiss,
  children,
  backdropColor = CREATE_CANVAS.black,
  style,
  testID,
}: {
  onDismiss: () => void;
  children: React.ReactNode;
  backdropColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const dragY = useSharedValue(0);
  const dragX = useSharedValue(0);
  const backdrop = useSharedValue(1);

  const pan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .failOffsetX([-16, 16])
    .onUpdate((e) => {
      dragY.value = e.translationY;
      dragX.value = e.translationX;
      backdrop.value = backdropOpacityFor(e.translationY);
    })
    .onEnd((e) => {
      if (shouldDismiss(e.translationY, e.velocityY)) {
        runOnJS(onDismiss)();
        return;
      }
      dragY.value = withTiming(0, SETTLE);
      dragX.value = withTiming(0, SETTLE);
      backdrop.value = withTiming(1, SETTLE);
    });

  const contentStyle = useAnimatedStyle(() => ({
    borderRadius: dragRadiusFor(dragY.value),
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }, { scale: dragScaleFor(dragY.value) }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  return (
    <GestureHandlerRootView style={[StyleSheet.absoluteFill, style]} testID={testID}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }, backdropStyle]} />
      <GestureDetector gesture={pan}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.content, contentStyle]}>{children}</Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ content: { overflow: 'hidden' } });
