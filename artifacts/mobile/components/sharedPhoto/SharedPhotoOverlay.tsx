/**
 * The one overlay image behind every shared-element product photo morph (see
 * lib/sharedPhoto.ts). Mounted once above the root stack, never touchable.
 *
 * Open: tile frame → hero frame in 320 ms (ease-out), then it holds until the
 * product page reports its photo is up (or 1.2 s) and fades out in 120 ms so
 * the real gallery takes over. Close: hero frame → tile frame in 280 ms and
 * it's gone; the tile underneath is the same photo.
 *
 * Runs entirely on the UI thread: a single absolutely positioned view whose
 * frame and corner radius are driven by one shared value.
 */
import React, { useEffect, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { CachedImage } from '@/components/CachedImage';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { sharedPhoto, type Flight } from '@/lib/sharedPhoto';

const OPEN_MS = 320;
const CLOSE_MS = 280;
const HANDOFF_FADE_MS = 120;
const HANDOFF_TIMEOUT_MS = 1200;

export function SharedPhotoOverlay() {
  const killSwitch = useFeatureFlag('sharedPhotoTransition');
  useEffect(() => { sharedPhoto.setKillSwitch(killSwitch); }, [killSwitch]);
  const flight = useSyncExternalStore(sharedPhoto.subscribe, sharedPhoto.current, sharedPhoto.current);
  if (!flight) return null;
  // Window-sized layer so the window coordinates from measureInWindow line up.
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <FlightView key={flight.id} flight={flight} />
    </View>
  );
}

function FlightView({ flight }: { flight: Flight }) {
  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);
  const heroReady = useSyncExternalStore(sharedPhoto.subscribe, sharedPhoto.isHeroReady, sharedPhoto.isHeroReady);
  const [landed, setLanded] = React.useState(false);

  useEffect(() => {
    const done = () => {
      if (flight.kind === 'close') sharedPhoto.finish(flight.id);
      else setLanded(true);
    };
    progress.value = withTiming(1, {
      duration: flight.kind === 'open' ? OPEN_MS : CLOSE_MS,
      easing: Easing.out(Easing.cubic),
    }, (finished) => { if (finished) runOnJS(done)(); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open hand-off: once landed, fade as soon as the page's own photo is up.
  useEffect(() => {
    if (flight.kind !== 'open' || !landed) return;
    const fade = () => {
      opacity.value = withTiming(0, { duration: HANDOFF_FADE_MS }, (finished) => {
        if (finished) runOnJS(sharedPhoto.finish)(flight.id);
      });
    };
    if (heroReady) { fade(); return; }
    const t = setTimeout(fade, HANDOFF_TIMEOUT_MS);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed, heroReady]);

  const { from, to, fromRadius, toRadius } = flight;
  const style = useAnimatedStyle(() => ({
    left: interpolate(progress.value, [0, 1], [from.x, to.x]),
    top: interpolate(progress.value, [0, 1], [from.y, to.y]),
    width: interpolate(progress.value, [0, 1], [from.width, to.width]),
    height: interpolate(progress.value, [0, 1], [from.height, to.height]),
    borderRadius: interpolate(progress.value, [0, 1], [fromRadius, toRadius]),
    opacity: opacity.value,
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.frame, style]} testID="shared-photo-overlay">
      <CachedImage source={{ uri: flight.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', overflow: 'hidden', zIndex: 1000, elevation: 1000 },
});
