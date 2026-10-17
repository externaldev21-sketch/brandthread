/**
 * Edit photos — Depop's "Edit photos": a grid of the listing's photos where
 * the first one is the cover. Press and hold a photo to drag it to a new
 * spot; tap one for "Make cover photo" / "Delete".
 */
import React from 'react';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { ScreenHeader } from '@/components/ScreenHeader';
import { GroupNote, ListingBottomBar } from '@/components/listing/ListingRows';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { hapticLight, hapticSelection } from '@/lib/haptics';
import { FONT, FS, SP } from '@/lib/theme';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { useListing, type ListingPhoto } from '@/lib/listing/listingStore';
import { makeCover, movePhoto, removePhoto } from '@/lib/listing/listingMedia';

const COLS = 3;
const GAP = SP.sm;

export default function ListingPhotosScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const form = useListing();
  const { width } = useWindowDimensions();
  const tile = Math.floor((Math.min(width, 600) - SP.md * 2 - GAP * (COLS - 1)) / COLS);
  const step = tile + GAP;
  const rows = Math.ceil(form.photos.length / COLS);
  /** Slot index of every photo id while a drag is in progress. */
  const order = useSharedValue<string[]>(form.photos.map(p => p.id));

  React.useEffect(() => {
    order.value = form.photos.map(p => p.id);
  }, [form.photos, order]);

  function openActions(photo: ListingPhoto, index: number) {
    showActionSheet(index === 0 ? 'Cover photo' : `Photo ${index + 1}`, undefined, [
      ...(index > 0 ? [{ text: 'Make cover photo', onPress: () => makeCover(photo.id) }] : []),
      { text: 'Delete photo', style: 'destructive' as const, onPress: () => removePhoto(photo.id) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  function commit(from: number, to: number) {
    movePhoto(from, to);
  }

  return (
    <View style={s.screen} testID="listing-photos-screen">
      <ScreenHeader title="Edit photos" />
      <GroupNote>Hold and drag to reorder. Your first photo is the cover buyers see in search.</GroupNote>
      <View style={[s.grid, { height: rows * step }]}>
        {form.photos.map((p, i) => (
          <SortableTile
            key={p.id}
            photo={p}
            index={i}
            count={form.photos.length}
            tile={tile}
            step={step}
            order={order}
            onTap={() => openActions(p, i)}
            onDrop={commit}
            s={s}
          />
        ))}
      </View>
      <View style={s.flex} />
      <ListingBottomBar primaryLabel="Done" onPrimary={() => router.back()} primaryTestID="listing-photos-done" />
    </View>
  );
}

function SortableTile({
  photo, index, count, tile, step, order, onTap, onDrop, s,
}: {
  photo: ListingPhoto; index: number; count: number; tile: number; step: number;
  order: SharedValue<string[]>; onTap: () => void; onDrop: (from: number, to: number) => void;
  s: ReturnType<typeof makeStyles>;
}) {
  const pos = (i: number) => ({ x: (i % COLS) * step, y: Math.floor(i / COLS) * step });
  const x = useSharedValue(pos(index).x);
  const y = useSharedValue(pos(index).y);
  const dragging = useSharedValue(false);
  const startIndex = useSharedValue(index);

  // Settle into the committed slot whenever the list order changes.
  React.useEffect(() => {
    x.value = withTiming(pos(index).x, { duration: 180 });
    y.value = withTiming(pos(index).y, { duration: 180 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step]);

  const id = photo.id;
  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart(() => {
      dragging.value = true;
      startIndex.value = order.value.indexOf(id);
      runOnJS(hapticSelection)();
    })
    .onUpdate(e => {
      const from = startIndex.value;
      const base = { x: (from % COLS) * step, y: Math.floor(from / COLS) * step };
      x.value = base.x + e.translationX;
      y.value = base.y + e.translationY;
    })
    .onEnd(() => {
      const col = Math.max(0, Math.min(COLS - 1, Math.round(x.value / step)));
      const row = Math.max(0, Math.round(y.value / step));
      const to = Math.max(0, Math.min(count - 1, row * COLS + col));
      const from = startIndex.value;
      x.value = withTiming((to % COLS) * step, { duration: 160 });
      y.value = withTiming(Math.floor(to / COLS) * step, { duration: 160 });
      if (to !== from) runOnJS(onDrop)(from, to);
    })
    .onFinalize(() => { dragging.value = false; });

  const tap = Gesture.Tap().onEnd((_e, ok) => { if (ok) { runOnJS(hapticLight)(); runOnJS(onTap)(); } });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: withTiming(dragging.value ? 1.06 : 1, { duration: 120 }) }],
    zIndex: dragging.value ? 10 : 1,
    opacity: dragging.value ? 0.92 : 1,
  }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <Animated.View style={[s.tile, { width: tile, height: tile }, style]} testID={`listing-edit-photo-${index}`} accessibilityRole="button" accessibilityLabel={index === 0 ? 'Cover photo' : `Photo ${index + 1}`}>
        <Image source={{ uri: photo.uri }} style={s.image} />
        {index === 0 ? <View style={s.coverTag}><Text style={s.coverText}>Cover photo</Text></View> : null}
      </Animated.View>
    </GestureDetector>
  );
}

function makeStyles(t: AppThemePreset) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background },
    flex: { flex: 1 },
    grid: { marginHorizontal: SP.md, marginTop: SP.md },
    tile: { position: 'absolute', left: 0, top: 0, borderRadius: 6, overflow: 'hidden', backgroundColor: t.surface },
    image: { width: '100%', height: '100%' },
    coverTag: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 4, alignItems: 'center', backgroundColor: `${t.background}CC` },
    coverText: { fontSize: FS.meta, fontFamily: FONT.semibold, color: t.text },
  });
}
