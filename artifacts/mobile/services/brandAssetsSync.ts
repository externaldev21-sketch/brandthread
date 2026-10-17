/**
 * Brand Assets library ↔ server (GET/PUT /api/seller/brand-assets).
 * Pure helpers so the mapping is testable without React Native.
 */
import type { BrandAsset } from './designTypes';

/** URIs that only exist on this device — never send these to the server. */
export function isDeviceLocalUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  return /^(file|content|ph|assets-library|data|blob):/i.test(uri.trim());
}

export interface ServerBrandAsset {
  id: string;
  name: string;
  type: BrandAsset['type'];
  objectPath?: string;
  remoteUrl?: string;
  color?: string;
  fontFamily?: string;
  tags: string[];
  createdAt: string;
}

/**
 * The persisted shape of an asset. Images must already be uploaded
 * (objectPath) — a device-local URI throws instead of being saved.
 */
export function toServerBrandAsset(asset: BrandAsset): ServerBrandAsset {
  const out: ServerBrandAsset = {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    tags: asset.tags ?? [],
    createdAt: asset.createdAt,
  };
  if (asset.objectPath) out.objectPath = asset.objectPath;
  else if (asset.remoteUrl) out.remoteUrl = asset.remoteUrl;
  else if (asset.uri && /^https:\/\//i.test(asset.uri) && !isDeviceLocalUri(asset.uri)) out.remoteUrl = asset.uri;
  if (asset.color) out.color = asset.color;
  if (asset.fontFamily) out.fontFamily = asset.fontFamily;
  const needsImage = asset.type !== 'color' && asset.type !== 'font' && asset.type !== 'text_style';
  if (needsImage && !out.objectPath && !out.remoteUrl) {
    throw new Error('This image has not been uploaded yet. Add it again to save it to your account.');
  }
  return out;
}

/** Server response row → screen model (uri is a fresh signed display URL). */
export function fromServerBrandAsset(row: ServerBrandAsset & { uri?: string | null }): BrandAsset {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    uri: row.uri ?? undefined,
    objectPath: row.objectPath,
    remoteUrl: row.remoteUrl,
    color: row.color,
    fontFamily: row.fontFamily,
    tags: row.tags ?? [],
    createdAt: row.createdAt,
  };
}
