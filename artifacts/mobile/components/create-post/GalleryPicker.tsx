/**
 * Step 2 — the device gallery (TikTok's "Upload" picker): X · Recents ⌄ header,
 * All / Videos / Photos tabs, a dense grid with numbered selection circles, a
 * tray of the selection in order (hold-drag to reorder, × to remove) and the
 * Clear / Next pills. One video OR a slideshow of photos; the photo cap comes
 * from constants/postLimits.ts and the extra photo is blocked with a message.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import * as Haptics from 'expo-haptics';
import { FONT } from '@/lib/theme';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDeviceMedia } from '@/lib/createPost/useDeviceMedia';
import type { PickedAsset } from '@/lib/createPost/types';
import { MAX_SLIDES_BY_MODE, MAX_VIDEO_SECONDS, MODE_LABEL, type PostMode } from '@/constants/postLimits';
import { CP, IconButton, PillButton, SubPage, tap } from '@/components/create-post/ui';
import { ReorderStrip } from '@/components/create-post/ReorderStrip';

type Tab = 'all' | 'videos' | 'photos';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'videos', label: 'Videos' }, { id: 'photos', label: 'Photos' },
];
const GAP = 1;

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Web-only tile preview for videos (an <video> paused on its first frame). */
function WebVideoThumb({ uri }: { uri: string }) {
  return React.createElement('video', {
    src: `${uri}#t=0.1`, muted: true, playsInline: true, preload: 'metadata',
    style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' },
  });
}

export function MediaThumb({ asset, style }: { asset: PickedAsset; style?: any }) {
  if (Platform.OS === 'web' && asset.kind === 'video') {
    return <View style={[{ backgroundColor: CP.surface }, style]}><WebVideoThumb uri={asset.uri} /></View>;
  }
  return <Image source={{ uri: asset.uri }} style={[{ backgroundColor: CP.surface }, style]} resizeMode="cover" />;
}

export function GalleryPicker({ mode, onClose, onNext, initialSelection = [], destinationOptions, onPickDestination }: {
  mode: PostMode;
  onClose: () => void;
  onNext: (selection: PickedAsset[]) => void;
  initialSelection?: PickedAsset[];
  /** Web only (no camera screen to hold the mode bar): lets the header switch destination. */
  destinationOptions?: Array<{ id: string; label: string }>;
  onPickDestination?: (id: string) => void;
}) {
  const top = useHeaderTopInset();
  const insets = useSafeAreaInsets();
  const media = useDeviceMedia();
  const [tab, setTab] = useState<Tab>('all');
  const [selected, setSelected] = useState<PickedAsset[]>(initialSelection);
  const [message, setMessage] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [albumPage, setAlbumPage] = useState(false);
  const fileInput = React.useRef<any>(null);

  const cap = MAX_SLIDES_BY_MODE[mode];
  const cols = tab === 'videos' ? 3 : 4;
  const tile = width > 0 ? (width - GAP * (cols - 1)) / cols : 0;
  const hasVideo = selected.some((a) => a.kind === 'video');

  const data = useMemo(() => media.assets.filter((a) => (
    tab === 'all' ? true : tab === 'videos' ? a.kind === 'video' : a.kind === 'photo'
  )), [media.assets, tab]);

  const warn = useCallback((text: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setMessage(text);
  }, []);

  const toggle = useCallback((asset: PickedAsset) => {
    tap();
    setMessage(null);
    setSelected((prev) => {
      if (prev.some((a) => a.id === asset.id)) return prev.filter((a) => a.id !== asset.id);
      if (asset.kind === 'video') {
        if (asset.duration > MAX_VIDEO_SECONDS + 0.5) {
          warn('Videos can be up to 10 minutes long.');
          return prev;
        }
        return [asset];
      }
      const photos = prev.filter((a) => a.kind === 'photo');
      if (photos.length >= cap) {
        warn(`You can add up to ${cap} photos to a ${MODE_LABEL[mode].toLowerCase()}. Remove one to add another.`);
        return prev;
      }
      return [...photos, asset];
    });
  }, [cap, mode, warn]);

  const order = useMemo(() => new Map(selected.map((a, i) => [a.id, i + 1])), [selected]);

  const helper = hasVideo ? 'Video selected' : `Select up to ${cap} photos or 1 video`;

  function renderTile({ item }: { item: PickedAsset }) {
    const n = order.get(item.id);
    return (
      <Pressable
        onPress={() => toggle(item)}
        testID={`gallery-tile-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${item.kind === 'video' ? 'Video' : 'Photo'}${n ? `, selected ${n}` : ''}`}
        style={{ width: tile, height: tile, marginBottom: GAP }}
      >
        <MediaThumb asset={item} style={{ width: tile, height: tile }} />
        {item.kind === 'video' ? <Text style={s.duration}>{formatDuration(item.duration)}</Text> : null}
        <View style={[s.circle, n ? s.circleOn : null]}>
          {n ? <Text style={s.circleNum}>{n}</Text> : <Icon name="plus" size={13} color={CP.white} />}
        </View>
      </Pressable>
    );
  }

  return (
    <View style={s.root} testID="gallery-picker">
      <View style={[s.header, { paddingTop: top + 8 }]}>
        <IconButton icon="x" label="Close" onPress={onClose} testID="gallery-close" />
        {media.isWeb ? (
          <Pressable
            style={s.titleBtn}
            onPress={() => { tap(); setAlbumPage(true); }}
            accessibilityRole="button"
            accessibilityLabel="Choose destination"
            testID="gallery-destination"
          >
            <Text style={s.title}>{MODE_LABEL[mode][0] + MODE_LABEL[mode].slice(1).toLowerCase()}</Text>
            <Icon name="chevron-down" size={18} color={CP.white} />
          </Pressable>
        ) : (
          <Pressable style={s.titleBtn} onPress={() => { tap(); setAlbumPage(true); }} accessibilityRole="button" accessibilityLabel="Choose album" testID="gallery-album">
            <Text style={s.title}>{media.album.title}</Text>
            <Icon name="chevron-down" size={18} color={CP.white} />
          </Pressable>
        )}
        <View style={{ width: 44 }} />
      </View>

      <View style={s.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.id} onPress={() => { tap(); setTab(t.id); }} style={s.tab} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }} testID={`gallery-tab-${t.id}`}>
            <Text style={[s.tabText, { color: tab === t.id ? CP.white : CP.silverDim }]}>{t.label}</Text>
            <View style={[s.tabBar, { backgroundColor: tab === t.id ? CP.white : 'transparent' }]} />
          </Pressable>
        ))}
      </View>

      <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {media.permission === 'denied' ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>Allow access to your photos</Text>
            <Text style={s.emptyBody}>Brandthread needs access to show your photos and videos.</Text>
            <PillButton label="Allow access" onPress={media.requestAccess} flex={false} style={{ marginTop: 16, paddingHorizontal: 28 }} />
          </View>
        ) : media.permission === 'loading' ? (
          <View style={s.empty}><ActivityIndicator color={CP.white} /></View>
        ) : data.length === 0 && !media.loading ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>{media.isWeb ? 'Choose photos or videos' : tab === 'all' ? 'Nothing here yet' : `No ${tab} found`}</Text>
            <Text style={s.emptyBody}>{media.isWeb ? 'Pick files from this device to build your post.' : 'Photos and videos on your device will show up here.'}</Text>
            {media.isWeb ? <PillButton label="Browse files" onPress={() => fileInput.current?.click()} flex={false} style={{ marginTop: 16, paddingHorizontal: 28 }} testID="gallery-browse" /> : null}
          </View>
        ) : tile > 0 ? (
          <FlatList
            key={`cols-${cols}`}
            data={data}
            numColumns={cols}
            keyExtractor={(a) => a.id}
            renderItem={renderTile}
            columnWrapperStyle={{ gap: GAP }}
            onEndReached={media.loadMore}
            onEndReachedThreshold={0.6}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={media.isWeb ? (
              <Pressable onPress={() => fileInput.current?.click()} style={s.addMore} testID="gallery-add-files"><Text style={s.addMoreText}>+ Add more files</Text></Pressable>
            ) : media.loading ? <ActivityIndicator color={CP.white} style={{ margin: 16 }} /> : null}
          />
        ) : null}
      </View>

      {media.isWeb ? React.createElement('input', {
        ref: fileInput, type: 'file', multiple: true, accept: 'image/*,video/*', 'data-testid': 'gallery-file-input',
        style: { display: 'none' },
        onChange: (e: any) => { media.addWebFiles(Array.from(e.target.files ?? [])); e.target.value = ''; },
      }) : null}

      <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {selected.length > 0 ? (
          <ReorderStrip
            testID="gallery-tray"
            items={selected}
            itemW={60}
            itemH={80}
            onReorder={(from, to) => setSelected((prev) => { const next = [...prev]; const [m] = next.splice(from, 1); next.splice(to, 0, m); return next; })}
            renderItem={(a) => (
              <View style={s.trayItem}>
                <MediaThumb asset={a} style={{ width: 60, height: 80, borderRadius: 4 }} />
                {a.kind === 'video' ? <Text style={s.trayDuration}>{formatDuration(a.duration)}</Text> : null}
                <Pressable
                  onPress={() => { tap(); setMessage(null); setSelected((prev) => prev.filter((x) => x.id !== a.id)); }}
                  hitSlop={8}
                  style={s.trayX}
                  accessibilityRole="button"
                  accessibilityLabel="Remove"
                  testID={`gallery-remove-${a.id}`}
                >
                  <Icon name="x" size={12} color={CP.black} />
                </Pressable>
              </View>
            )}
          />
        ) : null}
        <Text style={[s.helper, message ? { color: CP.white, fontFamily: FONT.semibold } : null]} testID="gallery-helper" accessibilityLiveRegion="polite">
          {message ?? (selected.length > 1 ? `${selected.length} of ${cap} selected · hold and drag to reorder` : helper)}
        </Text>
        <View style={s.buttons}>
          {selected.length > 0 ? (
            <PillButton label="Clear" variant="secondary" onPress={() => { setSelected([]); setMessage(null); }} testID="gallery-clear" />
          ) : null}
          <PillButton
            label={selected.length > 0 ? `Next (${selected.length})` : 'Next'}
            disabled={selected.length === 0}
            onPress={() => onNext(selected)}
            testID="gallery-next"
            style={selected.length === 0 ? { flex: 0, minWidth: 140, alignSelf: 'flex-end', marginLeft: 'auto' } : undefined}
          />
        </View>
      </View>

      {albumPage ? (
        <SubPage title={media.isWeb ? 'Post to' : 'Albums'} onBack={() => setAlbumPage(false)} testID="gallery-album-page">
          {(media.isWeb ? (destinationOptions ?? []).map((d) => ({ key: d.id, title: d.label, on: d.id === mode, press: () => { onPickDestination?.(d.id); setAlbumPage(false); } }))
            : media.albums.map((a) => ({ key: a.id ?? 'recents', title: a.title, on: a.id === media.album.id, press: () => { media.selectAlbum(a); setAlbumPage(false); } }))
          ).map((row) => (
            <Pressable key={row.key} style={s.albumRow} onPress={() => { tap(); row.press(); }} accessibilityRole="button" testID={`gallery-option-${row.key}`}>
              <Text style={s.albumTitle}>{row.title}</Text>
              {row.on ? <Icon name="check" size={20} color={CP.white} /> : null}
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
  titleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  title: { color: CP.white, fontFamily: FONT.bold, fontSize: 17 },
  tabs: { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: 16 },
  tab: { flex: 1, alignItems: 'center', paddingTop: 6 },
  tabText: { fontFamily: FONT.semibold, fontSize: 15, paddingBottom: 8 },
  tabBar: { height: 2, alignSelf: 'stretch', marginHorizontal: 24 },
  duration: { position: 'absolute', right: 6, bottom: 5, color: CP.white, fontFamily: FONT.semibold, fontSize: 12 },
  circle: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: CP.white, alignItems: 'center', justifyContent: 'center' },
  circleOn: { backgroundColor: CP.white },
  circleNum: { color: CP.black, fontFamily: FONT.bold, fontSize: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyTitle: { color: CP.white, fontFamily: FONT.bold, fontSize: 18, textAlign: 'center' },
  emptyBody: { color: CP.silver, fontFamily: FONT.regular, fontSize: 14, textAlign: 'center', marginTop: 8 },
  addMore: { alignItems: 'center', paddingVertical: 16 },
  addMoreText: { color: CP.silver, fontFamily: FONT.semibold, fontSize: 14 },
  bottom: { backgroundColor: CP.black, paddingTop: 8 },
  trayItem: { flex: 1 },
  trayDuration: { position: 'absolute', left: 4, bottom: 3, color: CP.white, fontFamily: FONT.semibold, fontSize: 10 },
  trayX: { position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: CP.white, alignItems: 'center', justifyContent: 'center' },
  helper: { color: CP.silverDim, fontFamily: FONT.regular, fontSize: 13, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  buttons: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  albumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 18 },
  albumTitle: { color: CP.white, fontFamily: FONT.semibold, fontSize: 16 },
});
