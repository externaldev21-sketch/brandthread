/**
 * Photos (and one optional video) for a listing. Depop's picker: multi-select
 * from the library, up to MAX_PHOTOS photos, one short video. Each photo
 * uploads as soon as it's picked so Post listing doesn't wait on it.
 */
import * as ImagePicker from 'expo-image-picker';
import type { BrandthreadApi } from '@/lib/api';
import { getListing, patchListingQuietly, updateListing, type ListingPhoto } from './listingStore';
import { MAX_PHOTOS } from './taxonomy';
import { notify } from './notify';

const MAX_VIDEO_SECONDS = 60;

function uid() { return Math.random().toString(36).slice(2, 11); }

export async function uploadListingPhoto(api: BrandthreadApi, photo: ListingPhoto) {
  patchListingQuietly(prev => ({ photos: prev.photos.map(p => p.id === photo.id ? { ...p, status: 'uploading' } : p) }));
  try {
    const uploaded = await api.products.uploadImage({ uri: photo.uri });
    const remoteUri = (uploaded as { objectPath?: string; url?: string })?.objectPath
      ?? (uploaded as { url?: string })?.url;
    if (!remoteUri) throw new Error('No image path returned');
    patchListingQuietly(prev => ({ photos: prev.photos.map(p => p.id === photo.id ? { ...p, remoteUri, status: 'done' } : p) }));
  } catch {
    patchListingQuietly(prev => ({ photos: prev.photos.map(p => p.id === photo.id ? { ...p, status: 'error' } : p) }));
  }
}

function addAssets(api: BrandthreadApi, assets: ImagePicker.ImagePickerAsset[]) {
  const form = getListing();
  const images = assets.filter(a => a.type !== 'video');
  const video = assets.find(a => a.type === 'video');
  const room = Math.max(0, MAX_PHOTOS - form.photos.length);
  const added: ListingPhoto[] = images.slice(0, room).map(a => ({ id: uid(), uri: a.uri, status: 'uploading' }));
  const patch: Parameters<typeof updateListing>[0] = {};
  if (added.length) patch.photos = [...form.photos, ...added];
  if (video) {
    const seconds = (video.duration ?? 0) / 1000;
    if (seconds > MAX_VIDEO_SECONDS) {
      notify('Video too long', `Choose a video up to ${MAX_VIDEO_SECONDS} seconds.`);
    } else {
      patch.video = { uri: video.uri, mimeType: video.mimeType };
    }
  }
  if (images.length > room) notify('Photo limit', `You can add up to ${MAX_PHOTOS} photos.`);
  if (Object.keys(patch).length) updateListing(patch);
  added.forEach(p => { void uploadListingPhoto(api, p); });
}

export async function pickFromLibrary(api: BrandthreadApi) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    notify('Allow photo access', 'Turn on photo library access for Brandthread in Settings to add photos.');
    return;
  }
  const form = getListing();
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: form.video ? ['images'] : ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, MAX_PHOTOS - form.photos.length + (form.video ? 0 : 1)),
    orderedSelection: true,
    quality: 0.9,
    videoMaxDuration: MAX_VIDEO_SECONDS,
  });
  if (result.canceled || !result.assets.length) return;
  addAssets(api, result.assets);
}

export async function takePhoto(api: BrandthreadApi) {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    notify('Allow camera access', 'Turn on camera access for Brandthread in Settings to take photos.');
    return;
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
  if (result.canceled || !result.assets.length) return;
  addAssets(api, result.assets);
}

export function removePhoto(id: string) {
  updateListing(prev => ({ photos: prev.photos.filter(p => p.id !== id) }));
}

export function makeCover(id: string) {
  updateListing(prev => {
    const photo = prev.photos.find(p => p.id === id);
    if (!photo) return {};
    return { photos: [photo, ...prev.photos.filter(p => p.id !== id)] };
  });
}

export function movePhoto(from: number, to: number) {
  updateListing(prev => {
    if (from === to || from < 0 || to < 0 || from >= prev.photos.length || to >= prev.photos.length) return {};
    const next = [...prev.photos];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return { photos: next };
  });
}

export function retryUploads(api: BrandthreadApi) {
  getListing().photos.filter(p => p.status === 'error').forEach(p => { void uploadListingPhoto(api, p); });
}
