/**
 * POST step 2 — Instagram's carousel editor. The active slide sits in the
 * fixed 3:4 frame (drag to reposition, pinch to zoom, grid while dragging,
 * Reset) with its neighbours peeking either side; dots show the position.
 * Bottom tool row: Filter · Edit (Brightness, Contrast, Structure, Warmth,
 * Saturation, Fade, Vignette — per slide, with "Apply to all") · Trim (video
 * slides). "+" goes back to add more, Next continues to the caption.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, TEXT_DISABLED } from '@/lib/theme';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { ASPECT_RATIO_VALUE, MAX_SLIDES_BY_MODE } from '@/constants/postLimits';
import { DEFAULT_SLIDE_CROP } from '@/lib/createPost/crop';
import { ADJUST_TOOLS, FILTER_PRESETS, isNeutral, matchingPreset, NO_ADJUST, previewFilter, type Adjust, type AdjustKey } from '@/lib/createPost/adjust';
import type { SlideDraft } from '@/lib/createPost/types';
import { CP, IconButton, PillButton, tap } from '@/components/create-post/ui';
import { CropFrame } from '@/components/create-post/CropFrame';
import { ReorderStrip } from '@/components/create-post/ReorderStrip';
import { formatDuration, MediaThumb } from '@/components/create-post/GalleryPicker';

function SlideThumb({ slide, style, adjust }: { slide: SlideDraft; style: any; adjust?: Adjust }) {
  const f = adjust ? previewFilter(adjust) : undefined;
  return <MediaThumb asset={{ id: slide.id, uri: slide.uri, kind: slide.kind, duration: 0 }} style={[style, f ? { filter: f } : null]} />;
}

type Tool = null | 'filter' | 'edit' | 'trim';
const RATIO = ASPECT_RATIO_VALUE['3:4'];
const PEEK = 16;

function Slider({ value, min, onChange, testID }: { value: number; min: number; onChange: (v: number) => void; testID?: string }) {
  const [w, setW] = useState(0);
  const pan = Gesture.Pan()
    .onBegin((e) => { runOnJS(onChange)(Math.round(min + (Math.max(0, Math.min(w, e.x)) / Math.max(1, w)) * (100 - min))); })
    .onUpdate((e) => { runOnJS(onChange)(Math.round(min + (Math.max(0, Math.min(w, e.x)) / Math.max(1, w)) * (100 - min))); });
  const pos = ((value - min) / (100 - min)) * w;
  const zero = ((0 - min) / (100 - min)) * w;
  return (
    <GestureDetector gesture={pan}>
      <View style={sl.wrap} onLayout={(e) => setW(e.nativeEvent.layout.width)} testID={testID}>
        <View style={sl.track} />
        <View style={[sl.fill, { left: Math.min(zero, pos), width: Math.abs(pos - zero) }]} />
        <View style={[sl.thumb, { left: Math.max(0, Math.min(w - 22, pos - 11)) }]} />
      </View>
    </GestureDetector>
  );
}

function TrimBar({ slide, onChange }: { slide: SlideDraft; onChange: (trimStart: number, trimEnd: number) => void }) {
  const [w, setW] = useState(0);
  const total = Math.max(1, slide.duration);
  const H = 16;
  const usable = Math.max(1, w - H * 2);
  const a = (slide.trimStart / total) * usable;
  const b = (slide.trimEnd / total) * usable;
  const sv = useSharedValue(0);
  const ev = useSharedValue(0);
  const minPx = (1 / total) * usable;
  const startPan = Gesture.Pan()
    .onBegin(() => { sv.value = a; })
    .onUpdate((e) => {
      const x = Math.max(0, Math.min(b - minPx, sv.value + e.translationX));
      runOnJS(onChange)((x / usable) * total, slide.trimEnd);
    });
  const endPan = Gesture.Pan()
    .onBegin(() => { ev.value = b; })
    .onUpdate((e) => {
      const x = Math.max(a + minPx, Math.min(usable, ev.value + e.translationX));
      runOnJS(onChange)(slide.trimStart, (x / usable) * total);
    });
  return (
    <View>
      <Text style={ed.trimLabel} testID="trim-readout">{formatDuration(slide.trimEnd - slide.trimStart)} of {formatDuration(slide.duration)}</Text>
      <View style={ed.trimTrack} onLayout={(e) => setW(e.nativeEvent.layout.width)} testID="trim-track">
        <View style={ed.trimBar} />
        {w > 0 ? (
          <>
            <View style={[ed.trimWindow, { left: a, width: b - a + H * 2 }]} pointerEvents="none" />
            <GestureDetector gesture={startPan}><View style={[ed.trimHandle, { left: a }]} testID="trim-start"><View style={ed.grip} /></View></GestureDetector>
            <GestureDetector gesture={endPan}><View style={[ed.trimHandle, { left: b + H }]} testID="trim-end"><View style={ed.grip} /></View></GestureDetector>
          </>
        ) : null}
      </View>
    </View>
  );
}

export function CarouselEditor({ slides, activeIndex, onActiveIndex, onSlides, onBack, onAdd, onNext }: {
  slides: SlideDraft[]; activeIndex: number; onActiveIndex: (i: number) => void;
  onSlides: (s: SlideDraft[]) => void; onBack: () => void; onAdd: () => void; onNext: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<Tool>(null);
  const [editKey, setEditKey] = useState<AdjustKey | null>(null);
  const [applyAll, setApplyAll] = useState(false);
  const [draftValue, setDraftValue] = useState<Adjust | null>(null);
  const active = slides[Math.min(activeIndex, slides.length - 1)];
  const atCap = slides.length >= MAX_SLIDES_BY_MODE.post;

  const frame = useMemo(() => {
    const maxW = stage.w - PEEK * 2 - 20; const maxH = stage.h - 30;
    if (maxW <= 0 || maxH <= 0) return { w: 0, h: 0 };
    let w = maxW; let h = w / RATIO;
    if (h > maxH) { h = maxH; w = h * RATIO; }
    return { w: Math.floor(w), h: Math.floor(h) };
  }, [stage]);

  if (!active) return null;
  const live = draftValue ?? active.adjust;

  function patchActive(patch: Partial<SlideDraft>) {
    onSlides(slides.map((sl) => (sl.id === active.id ? { ...sl, ...patch } : sl)));
  }
  function setAdjust(next: Adjust) {
    onSlides(slides.map((sl) => (applyAll || sl.id === active.id ? { ...sl, adjust: next } : sl)));
  }
  function go(dir: 1 | -1) {
    const n = activeIndex + dir;
    if (n < 0 || n >= slides.length) return;
    Haptics.selectionAsync().catch(() => {});
    onActiveIndex(n);
  }
  const prev = slides[activeIndex - 1];
  const next = slides[activeIndex + 1];

  return (
    <View style={ed.root} testID="carousel-editor">
      <View style={ed.top}>
        <View style={ed.round}><IconButton icon="arrow-left" label="Back" onPress={onBack} size={22} testID="edit-back" /></View>
        <Pressable
          onPress={() => { tap(); patchActive({ crop: DEFAULT_SLIDE_CROP, adjust: NO_ADJUST }); setDraftValue(null); }}
          accessibilityRole="button"
          accessibilityLabel="Reset slide"
          testID="slide-reset"
          style={ed.reset}
        >
          <Text style={ed.resetText}>Reset</Text>
        </Pressable>
      </View>

      <View style={ed.stage} onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {frame.w > 0 ? (
          <View style={{ width: stage.w, height: frame.h, alignItems: 'center', justifyContent: 'center' }}>
            {prev ? (
              <Pressable onPress={() => go(-1)} style={[ed.peek, { left: 0, height: frame.h * 0.88, width: PEEK + 14 }]} accessibilityRole="button" accessibilityLabel="Previous slide" testID="slide-prev">
                <SlideThumb slide={prev} adjust={prev.adjust} style={{ width: frame.w * 0.88, height: frame.h * 0.88, position: 'absolute', right: 0 }} />
              </Pressable>
            ) : null}
            <CropFrame
              key={active.id}
              slide={{ ...active, adjust: live }}
              aspect="3:4"
              radius={10}
              frameW={frame.w}
              frameH={frame.h}
              onCrop={(crop) => patchActive({ crop })}
              onSwipe={go}
            />
            {next ? (
              <Pressable onPress={() => go(1)} style={[ed.peek, { right: 0, height: frame.h * 0.88, width: PEEK + 14 }]} accessibilityRole="button" accessibilityLabel="Next slide" testID="slide-next">
                <SlideThumb slide={next} adjust={next.adjust} style={{ width: frame.w * 0.88, height: frame.h * 0.88, position: 'absolute', left: 0 }} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View style={ed.dots} testID="slide-dots">
          {slides.map((sl, i) => <View key={sl.id} style={[ed.dot, i === activeIndex && ed.dotOn]} />)}
        </View>
      </View>

      <ReorderStrip
        testID="slide-filmstrip"
        items={slides}
        itemW={40}
        itemH={52}
        gap={6}
        focusId={active.id}
        onReorder={(from, to) => {
          const n = [...slides]; const [m] = n.splice(from, 1); n.splice(to, 0, m);
          onSlides(n); onActiveIndex(activeIndex === from ? to : activeIndex);
        }}
        onPressItem={(_i, i) => onActiveIndex(i)}
        renderItem={(sl, i) => (
          <View style={[ed.thumb, i === activeIndex && ed.thumbOn]}>
            <SlideThumb slide={sl} style={{ width: '100%', height: '100%' }} />
            {sl.kind === 'video' ? <View style={ed.thumbBadge}><Feather name="play" size={9} color={CP.black} /></View> : null}
          </View>
        )}
      />

      <View style={[ed.panel, tool && ed.panelOpen]} testID="tool-panel">
        {tool === 'filter' ? (
          <View style={ed.presetGrid}>
            {FILTER_PRESETS.map((p) => {
              const on = matchingPreset(live) === p.id;
              return (
                <Pressable key={p.id} onPress={() => { tap(); setAdjust(p.adjust); }} style={ed.preset} accessibilityRole="button" accessibilityState={{ selected: on }} testID={`filter-${p.id}`}>
                  <Text style={[ed.presetLabel, { color: on ? CP.white : CP.silverDim }]}>{p.label}</Text>
                  <View style={[ed.presetThumb, on && { borderColor: CP.white }]}>
                    <SlideThumb slide={active} adjust={p.adjust} style={{ width: '100%', height: '100%' }} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {tool === 'edit' && !editKey ? (
          <View style={ed.presetGrid}>
            {ADJUST_TOOLS.map((t) => (
              <Pressable key={t.key} onPress={() => { tap(); setEditKey(t.key); setDraftValue(active.adjust); }} style={ed.preset} accessibilityRole="button" testID={`edit-${t.key}`}>
                <Text style={[ed.presetLabel, { color: live[t.key] ? CP.white : CP.silverDim }]}>{t.label}</Text>
                <View style={[ed.toolCircle, live[t.key] !== 0 && { borderColor: CP.white }]}>
                  <Feather name={t.icon as any} size={22} color={CP.white} />
                  {live[t.key] !== 0 ? <Text style={ed.toolValue}>{live[t.key]}</Text> : null}
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {tool === 'edit' && editKey ? (
          <View style={ed.sliderBox}>
            <Text style={ed.sliderLabel}>{ADJUST_TOOLS.find((t) => t.key === editKey)?.label}  <Text style={{ color: CP.silver }}>{live[editKey]}</Text></Text>
            <Slider
              value={live[editKey]}
              min={ADJUST_TOOLS.find((t) => t.key === editKey)?.min ?? -100}
              onChange={(v) => setDraftValue({ ...(draftValue ?? active.adjust), [editKey]: v })}
              testID="edit-slider"
            />
            <View style={ed.sliderActions}>
              <Pressable onPress={() => { tap(); setDraftValue(null); setEditKey(null); }} accessibilityRole="button" testID="edit-cancel"><Text style={ed.sliderBtn}>Cancel</Text></Pressable>
              <Pressable onPress={() => { tap(); if (draftValue) setAdjust(draftValue); setDraftValue(null); setEditKey(null); }} accessibilityRole="button" testID="edit-done"><Text style={[ed.sliderBtn, { color: CP.white }]}>Done</Text></Pressable>
            </View>
          </View>
        ) : null}

        {tool === 'trim' && active.kind === 'video' ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
            <TrimBar slide={active} onChange={(a, b) => patchActive({ trimStart: a, trimEnd: b })} />
          </View>
        ) : null}

        {(tool === 'filter' || tool === 'edit') && slides.length > 1 && !editKey ? (
          <View style={ed.applyRow}>
            <Text style={ed.applyLabel}>Apply to all slides</Text>
            <HapticSwitch value={applyAll} onValueChange={setApplyAll} testID="apply-all" accessibilityLabel="Apply to all slides" />
          </View>
        ) : null}
      </View>

      <View style={ed.tools}>
        {([
          { id: 'filter' as const, icon: 'droplet', label: 'Filter' },
          { id: 'edit' as const, icon: 'sliders', label: 'Edit' },
          ...(active.kind === 'video' ? [{ id: 'trim' as const, icon: 'scissors', label: 'Trim' }] : []),
        ]).map((t) => (
          <Pressable
            key={t.id}
            onPress={() => { tap(); setEditKey(null); setDraftValue(null); setTool((cur) => (cur === t.id ? null : t.id)); }}
            style={[ed.toolBtn, tool === t.id && { backgroundColor: CP.white }]}
            accessibilityRole="button"
            accessibilityState={{ selected: tool === t.id }}
            testID={`tool-${t.id}`}
          >
            <Feather name={t.icon as any} size={20} color={tool === t.id ? CP.black : CP.white} />
            <Text style={[ed.toolText, { color: tool === t.id ? CP.black : CP.white }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={[ed.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable onPress={() => { tap(); if (!atCap) onAdd(); }} disabled={atCap} style={[ed.add, atCap && { borderColor: TEXT_DISABLED }]} accessibilityRole="button" accessibilityLabel="Add more" testID="slide-add">
          <Feather name="plus" size={22} color={atCap ? TEXT_DISABLED : CP.white} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <PillButton label="Next" icon="arrow-right" onPress={onNext} testID="edit-next" flex={false} style={{ paddingHorizontal: 28, minWidth: 132 }} />
      </View>
    </View>
  );
}

const sl = StyleSheet.create({
  wrap: { height: 40, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, backgroundColor: CP.surface2 },
  fill: { position: 'absolute', height: 3, backgroundColor: CP.white },
  thumb: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: CP.white },
});

const ed = StyleSheet.create({
  root: { flex: 1, backgroundColor: CP.black },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 4 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: CP.surface2, alignItems: 'center', justifyContent: 'center' },
  reset: { paddingHorizontal: 12, height: 40, justifyContent: 'center' },
  resetText: { color: CP.white, fontFamily: FONT.semibold, fontSize: 15 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  peek: { position: 'absolute', overflow: 'hidden', zIndex: 0, borderRadius: 10 },
  dots: { flexDirection: 'row', gap: 6, position: 'absolute', bottom: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: CP.silverDim },
  dotOn: { backgroundColor: CP.white },
  thumb: { flex: 1, borderRadius: 4, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: CP.surface },
  thumbOn: { borderColor: CP.white },
  thumbBadge: { position: 'absolute', right: 2, bottom: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: CP.white, alignItems: 'center', justifyContent: 'center' },
  panel: { minHeight: 0 },
  panelOpen: { minHeight: 150 },
  presetRow: { paddingHorizontal: 16, gap: 14, paddingTop: 10 },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 8 },
  preset: { width: '25%', alignItems: 'center', gap: 5, paddingBottom: 8 },
  presetLabel: { fontFamily: FONT.semibold, fontSize: 13 },
  presetThumb: { width: 56, height: 56, borderRadius: 28, overflow: 'hidden', borderWidth: 2, borderColor: CP.line },
  toolCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: CP.line, alignItems: 'center', justifyContent: 'center' },
  toolValue: { position: 'absolute', bottom: 6, color: CP.silver, fontFamily: FONT.semibold, fontSize: 10 },
  sliderBox: { paddingHorizontal: 24, paddingTop: 12 },
  sliderLabel: { color: CP.white, fontFamily: FONT.bold, fontSize: 15, textAlign: 'center', marginBottom: 6 },
  sliderActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  sliderBtn: { color: CP.silver, fontFamily: FONT.semibold, fontSize: 15, padding: 6 },
  applyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
  applyLabel: { color: CP.silver, fontFamily: FONT.semibold, fontSize: 14 },
  tools: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingVertical: 10 },
  toolBtn: { width: 76, height: 52, borderRadius: 10, backgroundColor: CP.surface2, alignItems: 'center', justifyContent: 'center', gap: 3 },
  toolText: { fontFamily: FONT.semibold, fontSize: 12 },
  bottom: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  add: { width: 44, height: 44, borderRadius: 10, borderWidth: 2, borderColor: CP.white, alignItems: 'center', justifyContent: 'center' },
  trimLabel: { color: CP.white, fontFamily: FONT.semibold, fontSize: 13, marginBottom: 6 },
  trimTrack: { height: 56, justifyContent: 'center' },
  trimBar: { position: 'absolute', left: 0, right: 0, height: 44, borderRadius: 6, backgroundColor: CP.surface2 },
  trimWindow: { position: 'absolute', height: 52, borderTopWidth: 3, borderBottomWidth: 3, borderColor: CP.white },
  trimHandle: { position: 'absolute', width: 16, height: 52, borderRadius: 6, backgroundColor: CP.white, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 3, height: 18, borderRadius: 2, backgroundColor: CP.black },
});
