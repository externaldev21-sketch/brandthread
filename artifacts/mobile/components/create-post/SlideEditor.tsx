/**
 * Step 3 (photos) — slideshow editor, laid out like TikTok's crop screen:
 * the post frame in the middle with corner marks and a rule-of-thirds grid,
 * a filmstrip of the slides below (tap to jump, hold-drag to reorder), the
 * aspect-ratio row (1:1 · 3:4 · 9:16 — one ratio for the whole post) and the
 * bottom pills. Every slide is cropped on its own: drag to pan, pinch (or
 * mouse wheel on web) to zoom inside the frame; dragging past the image edge
 * swipes to the previous/next slide.
 */
import React, { useMemo, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT } from '@/lib/theme';
import { ASPECT_RATIO_VALUE, ASPECTS_BY_MODE, type PostAspect } from '@/constants/postLimits';
import type { SlideDraft } from '@/lib/createPost/types';
import { CP, IconButton, PillButton, tap } from '@/components/create-post/ui';
import { ReorderStrip } from '@/components/create-post/ReorderStrip';
import { CropFrame } from '@/components/create-post/CropFrame';

const ASPECT_ICON: Record<PostAspect, { w: number; h: number }> = {
  '1:1': { w: 20, h: 20 }, '3:4': { w: 17, h: 22 }, '9:16': { w: 13, h: 23 },
};

export function SlideEditor({ slides, aspect, activeIndex, onActiveIndex, onAspect, onSlides, onBack, onNext }: {
  slides: SlideDraft[]; aspect: PostAspect; activeIndex: number;
  onActiveIndex: (i: number) => void; onAspect: (a: PostAspect) => void;
  onSlides: (slides: SlideDraft[]) => void; onBack: () => void; onNext: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const active = slides[Math.min(activeIndex, slides.length - 1)];
  const ratio = ASPECT_RATIO_VALUE[aspect];

  const frame = useMemo(() => {
    const maxW = stage.w - 32;
    const maxH = stage.h - 8;
    if (maxW <= 0 || maxH <= 0) return { w: 0, h: 0 };
    let w = maxW; let h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    return { w: Math.floor(w), h: Math.floor(h) };
  }, [stage, ratio]);

  function go(dir: 1 | -1) {
    const next = activeIndex + dir;
    if (next < 0 || next >= slides.length) return;
    Haptics.selectionAsync().catch(() => {});
    onActiveIndex(next);
  }

  if (!active) return null;
  return (
    <View style={s.root} testID="slide-editor">
      <View style={s.topBar}>
        <IconButton icon="arrow-left" label="Back" onPress={onBack} testID="edit-back" />
        <Text style={s.counter} testID="slide-counter">{activeIndex + 1} / {slides.length}</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={s.stage} onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {frame.w > 0 ? (
          <CropFrame
            key={active.id}
            slide={active}
            aspect={aspect}
            frameW={frame.w}
            frameH={frame.h}
            gridWhen="always"
            onCrop={(crop) => onSlides(slides.map((sl) => (sl.id === active.id ? { ...sl, crop } : sl)))}
            onSwipe={go}
          />
        ) : null}
      </View>

      <ReorderStrip
        testID="slide-filmstrip"
        items={slides}
        itemW={46}
        itemH={60}
        gap={6}
        focusId={active.id}
        onReorder={(from, to) => {
          const next = [...slides]; const [m] = next.splice(from, 1); next.splice(to, 0, m);
          onSlides(next);
          onActiveIndex(activeIndex === from ? to : activeIndex);
        }}
        onPressItem={(_item, i) => onActiveIndex(i)}
        renderItem={(sl, i) => (
          <View style={[s.thumbWrap, i === activeIndex && s.thumbOn]}>
            <Image source={{ uri: sl.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          </View>
        )}
      />
      <Text style={s.hint}>Drag to reposition · pinch to zoom · hold and drag a slide to reorder</Text>

      <View style={s.aspects} testID="aspect-row">
        {ASPECTS_BY_MODE.thread.map((a) => {
          const on = a === aspect;
          return (
            <Pressable key={a} onPress={() => { tap(); onAspect(a); }} style={s.aspect} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Aspect ratio ${a}`} testID={`aspect-${a.replace(':', 'x')}`}>
              <View style={[{ width: ASPECT_ICON[a].w, height: ASPECT_ICON[a].h, borderWidth: 2, borderRadius: 3, borderColor: on ? CP.white : CP.silverDim }]} />
              <Text style={[s.aspectLabel, { color: on ? CP.white : CP.silverDim }]}>{a}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[s.buttons, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <PillButton
          label="Delete"
          icon="trash-2"
          variant="secondary"
          testID="slide-delete"
          onPress={() => {
            if (slides.length === 1) { onBack(); return; }
            const next = slides.filter((sl) => sl.id !== active.id);
            onSlides(next);
            onActiveIndex(Math.min(activeIndex, next.length - 1));
          }}
        />
        <PillButton label="Next" onPress={onNext} testID="edit-next" />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: CP.black },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 4 },
  counter: { color: CP.white, fontFamily: FONT.semibold, fontSize: 15 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { overflow: 'hidden', backgroundColor: CP.surface },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: CP.silver },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: CP.silver },
  corner: { position: 'absolute', width: 22, height: 22, borderColor: CP.white },
  thumbWrap: { flex: 1, borderRadius: 4, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: CP.surface },
  thumbOn: { borderColor: CP.white },
  hint: { color: CP.silverDim, fontFamily: FONT.regular, fontSize: 12, textAlign: 'center', marginTop: 2 },
  aspects: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 40, paddingVertical: 14 },
  aspect: { alignItems: 'center', gap: 6, minWidth: 60 },
  aspectLabel: { fontFamily: FONT.semibold, fontSize: 13 },
  buttons: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
});
