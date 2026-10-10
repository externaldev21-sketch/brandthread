/**
 * POST step 1 — Instagram's "New post" picker: X · New post · Next, a preview
 * of the focused pick (already framed at the fixed 3:4 — drag/pinch right
 * here), a Recents row with the select-multiple toggle, and the gallery grid
 * with numbered picks. Up to 14 slides, photos and videos mixed; the 15th is
 * blocked with a message. The destination bar sits at the bottom like
 * Instagram's POST · STORY · REEL pill.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT } from '@/lib/theme';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useDeviceMedia } from '@/lib/createPost/useDeviceMedia';
import { assetToSlide } from '@/lib/createPost/slides';
import type { PickedAsset, SlideDraft } from '@/lib/createPost/types';
import { ASPECT_RATIO_VALUE, MAX_SLIDES_BY_MODE, MAX_VIDEO_SECONDS, type CreateMode } from '@/constants/postLimits';
import { CP, IconButton, PillButton, SubPage, tap } from '@/components/create-post/ui';
import { ModeBar } from '@/components/create-post/ModeBar';
import { CropFrame } from '@/components/create-post/CropFrame';
import { formatDuration, MediaThumb } from '@/components/create-post/GalleryPicker';

const COLS = 4;
const GAP = 1;
const CAP = MAX_SLIDES_BY_MODE.post;
const RATIO = ASPECT_RATIO_VALUE['3:4'];

export function PostPicker({ modes, mode, onChangeMode, onClose, onNext, onOpenCamera, initial = [] }: {
  modes: CreateMode[]; mode: CreateMode; onChangeMode: (m: CreateMode) => void;
  onClose: () => void; onNext: (slides: SlideDraft[]) => void; onOpenCamera?: () => void;
  initial?: SlideDraft[];
}) {
  const top = useHeaderTopInset();
  const insets = useSafeAreaInsets();
  const media = useDeviceMedia();
  const [multi, setMulti] = useState(initial.length > 1);
  const [slides, setSlides] = useState<SlideDraft[]>(initial);
  const [focusId, setFocusId] = useState<string | null>(initial[0]?.id ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [albumPage, setAlbumPage] = useState(false);
  const [gridW, setGridW] = useState(0);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const fileInput = useRef<any>(null);
  const building = useRef(new Set<string>());

  const tile = gridW > 0 ? (gridW - GAP * (COLS - 1)) / COLS : 0;
  const focused = slides.find((s) => s.id === focusId) ?? null;
  // slide id ← asset id mapping so a tile knows its number
  const order = useMemo(() => new Map(slides.map((s, i) => [s.id.replace(/-\d+$/, ''), i + 1])), [slides]);

  const warn = useCallback((text: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setMessage(text);
  }, []);

  async function press(asset: PickedAsset) {
    tap();
    setMessage(null);
    const existing = slides.find((s) => s.id.replace(/-\d+$/, '') === asset.id);
    if (existing) {
      if (!multi) { setFocusId(existing.id); return; }
      if (existing.id !== focusId) { setFocusId(existing.id); return; }
      const next = slides.filter((s) => s.id !== existing.id);
      setSlides(next);
      setFocusId(next[next.length - 1]?.id ?? null);
      return;
    }
    if (asset.kind === 'video' && asset.duration > MAX_VIDEO_SECONDS + 0.5) { warn('Videos can be up to 10 minutes long.'); return; }
    if (multi && slides.length >= CAP) { warn(`You can select up to ${CAP} photos and videos. Deselect one to add another.`); return; }
    if (building.current.has(asset.id)) return;
    building.current.add(asset.id);
    const slide = await assetToSlide(asset);
    building.current.delete(asset.id);
    setSlides((prev) => (multi ? (prev.length >= CAP ? prev : [...prev, slide]) : [slide]));
    setFocusId(slide.id);
  }

  function toggleMulti() {
    tap();
    setMessage(null);
    if (multi && slides.length > 1) {
      // Back to single: keep only the focused pick.
      const keep = slides.find((s) => s.id === focusId) ?? slides[0];
      setSlides([keep]); setFocusId(keep.id);
    }
    setMulti((m) => !m);
  }

  const frame = useMemo(() => {
    const maxW = stage.w - 32; const maxH = stage.h - 8;
    if (maxW <= 0 || maxH <= 0) return { w: 0, h: 0 };
    let w = maxW; let h = w / RATIO;
    if (h > maxH) { h = maxH; w = h * RATIO; }
    return { w: Math.floor(w), h: Math.floor(h) };
  }, [stage]);

  type Row = { key: string; kind: 'camera' | 'files' } | { key: string; kind: 'asset'; asset: PickedAsset };
  const rows: Row[] = useMemo(() => [
    media.isWeb ? { key: 'files', kind: 'files' as const } : { key: 'camera', kind: 'camera' as const },
    ...media.assets.map((asset) => ({ key: asset.id, kind: 'asset' as const, asset })),
  ], [media.assets, media.isWeb]);

  function renderTile({ item }: { item: Row }) {
    if (item.kind !== 'asset') {
      return (
        <Pressable
          onPress={() => { tap(); if (item.kind === 'camera') onOpenCamera?.(); else fileInput.current?.click(); }}
          style={[s.tile, { width: tile, height: tile, backgroundColor: CP.surface, alignItems: 'center', justifyContent: 'center' }]}
          accessibilityRole="button"
          accessibilityLabel={item.kind === 'camera' ? 'Camera' : 'Browse files'}
          testID={item.kind === 'camera' ? 'picker-camera' : 'picker-browse'}
        >
          <Icon name={item.kind === 'camera' ? 'camera' : 'plus'} size={24} color={CP.white} />
        </Pressable>
      );
    }
    const asset = item.asset;
    const n = order.get(asset.id);
    const isFocus = !!focused && focused.id.replace(/-\d+$/, '') === asset.id;
    return (
      <Pressable
        onPress={() => press(asset)}
        testID={`picker-tile-${asset.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${asset.kind === 'video' ? 'Video' : 'Photo'}${n ? `, selected ${n}` : ''}`}
        style={{ width: tile, height: tile, marginBottom: GAP }}
      >
        <MediaThumb asset={asset} style={{ width: tile, height: tile }} />
        {asset.kind === 'video' ? <Text style={s.duration}>{formatDuration(asset.duration)}</Text> : null}
        {isFocus ? <View style={s.focusRing} pointerEvents="none" /> : null}
        {multi ? (
          <View style={[s.circle, n ? s.circleOn : null]}>{n ? <Text style={s.circleNum}>{n}</Text> : null}</View>
        ) : null}
      </Pressable>
    );
  }

  return (
    <View style={s.root} testID="post-picker">
      <View style={[s.header, { paddingTop: top + 8 }]}>
        <IconButton icon="x" label="Close" onPress={onClose} testID="picker-close" />
        <Text style={s.title}>New post</Text>
        <Pressable onPress={() => { tap(); if (slides.length) onNext(slides); }} disabled={slides.length === 0} hitSlop={10} style={s.nextBtn} accessibilityRole="button" accessibilityLabel="Next" testID="picker-next">
          <Text style={[s.nextText, { color: slides.length ? CP.white : CP.silverDim }]}>Next</Text>
        </Pressable>
      </View>

      <View style={s.preview} onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} testID="picker-preview">
        {focused && frame.w > 0 ? (
          <CropFrame
            key={focused.id}
            slide={focused}
            aspect="3:4"
            frameW={frame.w}
            frameH={frame.h}
            onSwipe={() => {}}
            onCrop={(crop) => setSlides((prev) => prev.map((sl) => (sl.id === focused.id ? { ...sl, crop } : sl)))}
          />
        ) : (
          <Text style={s.previewHint}>{media.permission === 'denied' ? 'Allow photo access to pick from your library' : 'Choose photos or videos'}</Text>
        )}
      </View>

      <View style={s.recentsRow}>
        <Pressable onPress={() => { tap(); setAlbumPage(true); }} style={s.recents} accessibilityRole="button" accessibilityLabel="Choose album" testID="picker-album">
          <Text style={s.recentsText}>{media.isWeb ? 'Files' : media.album.title}</Text>
          {!media.isWeb ? <Icon name="chevron-down" size={18} color={CP.white} /> : null}
        </Pressable>
        <Pressable onPress={toggleMulti} style={[s.chip, multi && { backgroundColor: CP.white }]} accessibilityRole="button" accessibilityState={{ selected: multi }} accessibilityLabel="Select multiple" testID="picker-multi">
          <Icon name="copy" size={18} color={multi ? CP.black : CP.white} />
        </Pressable>
      </View>
      {message ? <Text style={s.message} testID="picker-message" accessibilityLiveRegion="polite">{message}</Text> : null}

      <View style={{ flex: 1 }} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
        {media.permission === 'loading' ? <ActivityIndicator color={CP.white} style={{ marginTop: 24 }} /> : tile > 0 ? (
          <FlatList
            data={rows}
            numColumns={COLS}
            keyExtractor={(r) => r.key}
            renderItem={renderTile}
            columnWrapperStyle={{ gap: GAP }}
            onEndReached={media.loadMore}
            onEndReachedThreshold={0.6}
            showsVerticalScrollIndicator={false}
          />
        ) : null}
      </View>

      {media.isWeb ? React.createElement('input', {
        ref: fileInput, type: 'file', multiple: true, accept: 'image/*,video/*', 'data-testid': 'gallery-file-input', style: { display: 'none' },
        onChange: (e: any) => { media.addWebFiles(Array.from(e.target.files ?? [])); e.target.value = ''; },
      }) : null}

      <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <ModeBar modes={modes} active={mode} onChange={onChangeMode} />
      </View>

      {albumPage ? (
        <SubPage title="Albums" onBack={() => setAlbumPage(false)} testID="picker-album-page">
          {media.albums.map((a) => (
            <Pressable key={a.id ?? 'recents'} style={s.albumRow} onPress={() => { tap(); media.selectAlbum(a); setAlbumPage(false); }} accessibilityRole="button">
              <Text style={s.albumTitle}>{a.title}</Text>
              {a.id === media.album.id ? <Icon name="check" size={20} color={CP.white} /> : null}
            </Pressable>
          ))}
        </SubPage>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: CP.black },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 6 },
  title: { color: CP.white, fontFamily: FONT.bold, fontSize: 17 },
  nextBtn: { minWidth: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  nextText: { fontFamily: FONT.bold, fontSize: 17 },
  preview: { height: 332, alignItems: 'center', justifyContent: 'center' },
  previewHint: { color: CP.silverDim, fontFamily: FONT.regular, fontSize: 14 },
  recentsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, height: 48 },
  recents: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  recentsText: { color: CP.white, fontFamily: FONT.bold, fontSize: 16 },
  chip: { width: 34, height: 34, borderRadius: 17, backgroundColor: CP.surface2, alignItems: 'center', justifyContent: 'center' },
  message: { color: CP.white, fontFamily: FONT.semibold, fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 },
  tile: {},
  duration: { position: 'absolute', right: 5, bottom: 4, color: CP.white, fontFamily: FONT.semibold, fontSize: 11 },
  focusRing: { ...({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const), borderWidth: 2, borderColor: CP.white },
  circle: { position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: CP.white, alignItems: 'center', justifyContent: 'center' },
  circleOn: { backgroundColor: CP.white },
  circleNum: { color: CP.black, fontFamily: FONT.bold, fontSize: 12 },
  bottom: { backgroundColor: CP.black, paddingTop: 4 },
  albumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 18 },
  albumTitle: { color: CP.white, fontFamily: FONT.semibold, fontSize: 16 },
});
