// ─── Media grid picker (Instagram-style) ───────────────────────────────────
// Self-contained: owns permission state, the "Recents" album switcher and
// asset pagination via expo-media-library. `create-post.tsx` only reacts to
// its selection callbacks — it never touches MediaLibrary directly.
//
// expo-media-library has no web implementation, so every MediaLibrary call
// is gated behind `Platform.OS !== 'web'`. On web the grid renders just the
// camera tile plus a single "Choose from files" tile that calls back into
// the existing `pickFromLibrary()` system-picker flow in create-post.tsx.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Dimensions, FlatList, Image, Platform,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Button } from '@/components/ui/Button';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { FONT, FS } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { SPACING } from '@/constants/spacing';

// expo-media-library is imported lazily (require) only when not on web, so
// bundling/executing this file on web never touches its native module.
// The imperative getAssetsAsync/getAlbumsAsync/SortBy API this grid uses
// lives under the `/legacy` subpath in expo-media-library 57 — the package's
// top-level export is its newer class-based (Query/Asset/Album) API, which
// doesn't have them.
let MediaLibrary: typeof import('expo-media-library/legacy') | null = null;
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  MediaLibrary = require('expo-media-library/legacy');
}

const { width: SCREEN_W } = Dimensions.get('window');
const NUM_COLUMNS = 3;
const GRID_GAP = 2;
const TILE_SIZE = (SCREEN_W - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;
const PAGE_SIZE = 60;

export interface MediaGridAsset {
  id: string;
  uri: string;
  mediaType: 'photo' | 'video';
  duration: number; // seconds; 0 for photos
}

interface AlbumOption { id: string | null; title: string; }

type GridRow =
  | { key: 'camera' }
  | { key: 'web-upload' }
  | { key: `asset-${string}`; asset: MediaGridAsset };

export interface MediaGridProps {
  selectedPhotoUris: string[];
  selectedVideoUri: string | null;
  onTogglePhoto: (asset: MediaGridAsset) => void;
  onSelectVideo: (asset: MediaGridAsset) => void;
  onPressCamera: () => void;
  /** Web-only fallback: opens the system file picker (existing `pickFromLibrary`). */
  onPressWebUpload: () => void;
}

export function MediaGrid({
  selectedPhotoUris, selectedVideoUri, onTogglePhoto, onSelectVideo, onPressCamera, onPressWebUpload,
}: MediaGridProps) {
  const { theme } = useAppTheme();
  const FG = theme.text;
  const MUTED = theme.muted;
  const CARD = theme.cardElevated;

  const [permission, setPermission] = useState<'loading' | 'granted' | 'denied'>(
    Platform.OS === 'web' ? 'granted' : 'loading',
  );
  const [albums, setAlbums] = useState<AlbumOption[]>([{ id: null, title: 'Recents' }]);
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [albumTitle, setAlbumTitle] = useState('Recents');
  const [assets, setAssets] = useState<MediaGridAsset[]>([]);
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showAlbumSheet, setShowAlbumSheet] = useState(false);

  const loadPage = useCallback(async (targetAlbumId: string | null, reset: boolean, cursor?: string) => {
    if (Platform.OS === 'web' || !MediaLibrary) return;
    setLoadingMore(true);
    try {
      const page = await MediaLibrary.getAssetsAsync({
        album: targetAlbumId ?? undefined,
        mediaType: ['photo', 'video'],
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        first: PAGE_SIZE,
        after: reset ? undefined : cursor,
      });
      const mapped: MediaGridAsset[] = page.assets.map(a => ({
        id: a.id,
        uri: a.uri,
        mediaType: a.mediaType === 'video' ? 'video' : 'photo',
        duration: a.duration ?? 0,
      }));
      setAssets(prev => (reset ? mapped : [...prev, ...mapped]));
      setEndCursor(page.endCursor);
      setHasNextPage(page.hasNextPage);
    } catch {
      setHasNextPage(false);
    } finally {
      setLoadingMore(false);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    if (Platform.OS === 'web' || !MediaLibrary) { setPermission('granted'); return; }
    const current = await MediaLibrary.getPermissionsAsync();
    const result = current.granted ? current : await MediaLibrary.requestPermissionsAsync();
    setPermission(result.granted ? 'granted' : 'denied');
    if (result.granted) {
      const albumList = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
      setAlbums([
        { id: null, title: 'Recents' },
        ...albumList
          .filter(a => a.assetCount > 0)
          .map(a => ({ id: a.id, title: a.title })),
      ]);
      loadPage(null, true);
    }
  }, [loadPage]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  async function requestAccess() {
    if (Platform.OS === 'web' || !MediaLibrary) return;
    const result = await MediaLibrary.requestPermissionsAsync();
    setPermission(result.granted ? 'granted' : 'denied');
    if (result.granted) {
      const albumList = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
      setAlbums([
        { id: null, title: 'Recents' },
        ...albumList
          .filter(a => a.assetCount > 0)
          .map(a => ({ id: a.id, title: a.title })),
      ]);
      loadPage(null, true);
    }
  }

  function selectAlbum(option: AlbumOption) {
    Haptics.selectionAsync();
    setAlbumId(option.id);
    setAlbumTitle(option.title);
    setShowAlbumSheet(false);
    loadPage(option.id, true);
  }

  function handleEndReached() {
    if (Platform.OS === 'web' || loadingMore || !hasNextPage) return;
    loadPage(albumId, false, endCursor);
  }

  // ── Grid data ──
  const rows: GridRow[] = Platform.OS === 'web'
    ? [{ key: 'camera' }, { key: 'web-upload' }]
    : [{ key: 'camera' }, ...assets.map(a => ({ key: `asset-${a.id}` as const, asset: a }))];

  function renderItem({ item }: { item: GridRow }) {
    if (item.key === 'camera') {
      return (
        <TouchableOpacity
          style={styles.tile}
          activeOpacity={0.85}
          onPress={onPressCamera}
          accessibilityLabel="Open camera"
          accessibilityRole="button"
        >
          <View style={[styles.tileInner, { backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' }]}>
            <Feather name="camera" size={26} color={FG} />
          </View>
        </TouchableOpacity>
      );
    }
    if (item.key === 'web-upload') {
      return (
        <TouchableOpacity
          style={styles.tile}
          activeOpacity={0.85}
          onPress={onPressWebUpload}
          accessibilityLabel="Choose from files"
          accessibilityRole="button"
        >
          <View style={[styles.tileInner, { backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', gap: 6 }]}>
            <Feather name="folder" size={24} color={FG} />
            <Text style={{ color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium }}>Choose from files</Text>
          </View>
        </TouchableOpacity>
      );
    }
    const { asset } = item;
    const isVideo = asset.mediaType === 'video';
    const photoIndex = selectedPhotoUris.indexOf(asset.uri);
    const isVideoSelected = isVideo && selectedVideoUri === asset.uri;
    const selected = photoIndex >= 0 || isVideoSelected;
    return (
      <TouchableOpacity
        style={styles.tile}
        activeOpacity={0.85}
        onPress={() => {
          Haptics.selectionAsync();
          if (isVideo) onSelectVideo(asset);
          else onTogglePhoto(asset);
        }}
        accessibilityLabel={isVideo ? 'Select video' : 'Select photo'}
        accessibilityRole="button"
      >
        <View style={styles.tileInner}>
          <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          {isVideo && (
            <View style={styles.videoBadge}>
              <Feather name="video" size={11} color="#fff" />
              {asset.duration > 0 && (
                <Text style={styles.videoBadgeText}>{Math.round(asset.duration)}s</Text>
              )}
            </View>
          )}
          {selected && (
            <View style={styles.selectedDim} pointerEvents="none" />
          )}
          {selected && (
            <View style={[styles.selectionBadge, { backgroundColor: FG }]}>
              {photoIndex >= 0 ? (
                <Text style={[styles.selectionBadgeText, { color: theme.background }]}>{photoIndex + 1}</Text>
              ) : (
                <Feather name="check" size={12} color={theme.background} />
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  if (permission === 'loading') {
    return (
      <View style={[styles.gateWrap]}>
        <ActivityIndicator color={FG} />
      </View>
    );
  }

  if (permission === 'denied') {
    return (
      <View style={styles.gateWrap}>
        <View style={[styles.gateIconWrap, { backgroundColor: theme.cardElevated }]}>
          <Feather name="image" size={28} color={MUTED} />
        </View>
        <Text style={[styles.gateTitle, { color: FG }]}>Photo access needed</Text>
        <Text style={[styles.gateSub, { color: MUTED }]}>
          Brandthread needs access to your photos and videos to build a Thread.
        </Text>
        <Button label="Grant access" variant="primary" onPress={requestAccess} accessibilityLabel="Grant photo access" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {Platform.OS !== 'web' && (
        <TouchableOpacity
          style={styles.recentsRow}
          onPress={() => setShowAlbumSheet(true)}
          activeOpacity={0.7}
          accessibilityLabel="Choose album"
          accessibilityRole="button"
        >
          <Text style={[styles.recentsText, { color: FG }]}>{albumTitle}</Text>
          <Feather name="chevron-down" size={16} color={FG} />
        </TouchableOpacity>
      )}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        numColumns={NUM_COLUMNS}
        columnWrapperStyle={{ gap: GRID_GAP }}
        contentContainerStyle={{ gap: GRID_GAP, paddingBottom: 24 }}
        renderItem={renderItem}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.6}
        ListFooterComponent={loadingMore ? (
          <View style={{ paddingVertical: 16 }}>
            <ActivityIndicator color={FG} />
          </View>
        ) : null}
        showsVerticalScrollIndicator={false}
      />

      <BottomSheet visible={showAlbumSheet} onClose={() => setShowAlbumSheet(false)}>
        <View style={{ paddingHorizontal: SPACING.md, paddingBottom: SPACING.md }}>
          <Text style={[styles.sheetTitle, { color: FG }]}>Choose album</Text>
          {albums.map(option => (
            <TouchableOpacity
              key={option.id ?? 'recents'}
              style={styles.albumRow}
              onPress={() => selectAlbum(option)}
              accessibilityLabel={option.title}
              accessibilityRole="button"
            >
              <Text style={[styles.albumRowText, { color: FG }]}>{option.title}</Text>
              {albumId === option.id && <Feather name="check" size={16} color={FG} />}
            </TouchableOpacity>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { width: TILE_SIZE, height: TILE_SIZE },
  tileInner: { flex: 1, overflow: 'hidden', position: 'relative' },
  videoBadge: {
    position: 'absolute', bottom: 4, right: 4,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2,
  },
  videoBadgeText: { color: '#fff', fontSize: 10, fontFamily: FONT.medium },
  selectedDim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.28)' },
  selectionBadge: {
    position: 'absolute', top: 5, right: 5, minWidth: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  selectionBadgeText: { fontSize: 10, fontFamily: FONT.bold },
  recentsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs,
  },
  recentsText: { fontSize: FS.sm, fontFamily: FONT.bold },
  gateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xxl, gap: SPACING.sm },
  gateIconWrap: { width: 64, height: 64, borderRadius: RADII.full, alignItems: 'center', justifyContent: 'center' },
  gateTitle: { fontSize: FS.md, fontFamily: FONT.bold, textAlign: 'center' },
  gateSub: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', lineHeight: 20, marginBottom: SPACING.xs },
  sheetTitle: { fontSize: FS.md, fontFamily: FONT.bold, marginBottom: SPACING.sm },
  albumRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
  },
  albumRowText: { fontSize: FS.sm, fontFamily: FONT.regular },
});
