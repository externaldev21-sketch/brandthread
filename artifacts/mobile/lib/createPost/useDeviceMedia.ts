/**
 * The device's photo/video library for the create flow.
 *
 * Native: paged expo-media-library (permission, albums, newest first).
 * Web: there is no library to enumerate, so the grid is filled from files the
 * user chooses with the browser's file input (`addWebFiles`).
 * expo-media-library is required lazily so web never touches its native module.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { PickedAsset } from '@/lib/createPost/types';
import { getMediaLibrary } from '@/lib/mediaLibraryCompat';

const PAGE_SIZE = 60;
export interface AlbumOption { id: string | null; title: string }

function probeWebFile(file: File, index: number): Promise<PickedAsset> {
  const uri = URL.createObjectURL(file);
  const id = `web-${Date.now()}-${index}`;
  if (file.type.startsWith('video/')) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => resolve({
        id, uri, kind: 'video', duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth, height: video.videoHeight, mimeType: file.type,
      });
      video.onerror = () => resolve({ id, uri, kind: 'video', duration: 0, mimeType: file.type });
      video.src = uri;
    });
  }
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ id, uri, kind: 'photo', duration: 0, width: img.naturalWidth, height: img.naturalHeight, mimeType: file.type });
    img.onerror = () => resolve({ id, uri, kind: 'photo', duration: 0, mimeType: file.type });
    img.src = uri;
  });
}

export function useDeviceMedia({ pageSize = PAGE_SIZE }: { pageSize?: number } = {}) {
  const isWeb = Platform.OS === 'web';
  const [permission, setPermission] = useState<'loading' | 'granted' | 'denied'>(isWeb ? 'granted' : 'loading');
  const [assets, setAssets] = useState<PickedAsset[]>([]);
  const [albums, setAlbums] = useState<AlbumOption[]>([{ id: null, title: 'Recents' }]);
  const [album, setAlbum] = useState<AlbumOption>({ id: null, title: 'Recents' });
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasNext, setHasNext] = useState(!isWeb);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const loadPage = useCallback(async (target: string | null, reset: boolean, after?: string) => {
    const MediaLibrary = isWeb ? null : getMediaLibrary();
    if (!MediaLibrary || busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const page = await MediaLibrary.getAssetsAsync({
        album: target ?? undefined,
        mediaType: ['photo', 'video'],
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        first: pageSize,
        after: reset ? undefined : after,
      });
      const mapped: PickedAsset[] = page.assets.map((a) => ({
        id: a.id, uri: a.uri, kind: a.mediaType === 'video' ? 'video' : 'photo',
        duration: a.duration ?? 0, width: a.width, height: a.height,
      }));
      setAssets((prev) => (reset ? mapped : [...prev, ...mapped]));
      setCursor(page.endCursor);
      setHasNext(page.hasNextPage);
    } catch {
      setHasNext(false);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [isWeb, pageSize]);

  const requestAccess = useCallback(async () => {
    const MediaLibrary = isWeb ? null : getMediaLibrary();
    if (!MediaLibrary) {
      setPermission('denied');
      return;
    }
    const current = await MediaLibrary.getPermissionsAsync();
    const result = current.granted ? current : await MediaLibrary.requestPermissionsAsync();
    setPermission(result.granted ? 'granted' : 'denied');
    if (result.granted) {
      const list = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
      setAlbums([{ id: null, title: 'Recents' }, ...list.filter((a) => a.assetCount > 0).map((a) => ({ id: a.id, title: a.title }))]);
      loadPage(null, true);
    }
  }, [isWeb, loadPage]);

  useEffect(() => { requestAccess(); }, [requestAccess]);

  const selectAlbum = useCallback((next: AlbumOption) => {
    setAlbum(next);
    setAssets([]);
    loadPage(next.id, true);
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (hasNext && !loading) loadPage(album.id, false, cursor);
  }, [album.id, cursor, hasNext, loadPage, loading]);

  const addWebFiles = useCallback(async (files: File[]) => {
    const probed = await Promise.all(files.filter((f) => /^(image|video)\//.test(f.type)).map(probeWebFile));
    setAssets((prev) => [...probed.reverse(), ...prev]);
  }, []);

  return { permission, assets, albums, album, selectAlbum, loadMore, hasNext, loading, requestAccess, addWebFiles, isWeb };
}
