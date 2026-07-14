/**
 * Brandthread — Background Removal Service
 *
 * Handles result persistence for the Remove Background feature.
 * Results are cached to the device's document directory (survives app restarts).
 * AsyncStorage holds metadata only — never raw base64.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';

// ─── Types ───────────────────────────────────────────────────────────────────

export type BgRemovalStatus = 'completed' | 'failed';
export type BgRemovalSource = 'design_studio' | 'direct';

export interface BgRemovalResult {
  /** UUID returned by the API */
  id: string;
  status: BgRemovalStatus;
  /** Original image local URI (from ImagePicker — may become invalid after app reinstall) */
  originalUri: string;
  /** Persistent local file path for the transparent PNG result */
  localPath: string;
  /** GCS object key — can be used to re-fetch if local file is lost */
  storageKey: string | null;
  /** PNG file size in bytes */
  size: number;
  mime: 'image/png';
  createdAt: string;
  sourceScreen: BgRemovalSource;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'bt:bg-removal:results:v1';
const MAX_RESULTS = 20;
const BG_RESULTS_DIR = 'bg-results';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function load(): Promise<BgRemovalResult[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BgRemovalResult[];
  } catch {
    return [];
  }
}

async function persist(results: BgRemovalResult[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(results));
}

/**
 * Build the local file path for a result.
 * Uses Paths.document so the file survives app restarts.
 */
function buildLocalPath(id: string): string {
  const dir = new File(Paths.document, BG_RESULTS_DIR);
  if (!dir.exists) {
    // Create directory synchronously — expo-file-system v19 supports this
    try { dir.create(); } catch {}
  }
  return new File(dir, `${id}.png`).uri;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Write a base64-encoded PNG to the local document directory
 * and save its metadata to AsyncStorage.
 */
export async function saveResult(params: {
  id: string;
  b64Json: string;
  originalUri: string;
  storageKey: string | null;
  size: number;
  createdAt: string;
  sourceScreen: BgRemovalSource;
}): Promise<BgRemovalResult> {
  // Write PNG to local filesystem
  const localPath = buildLocalPath(params.id);
  const file = new File(localPath);
  file.write(params.b64Json, { encoding: 'base64' });

  const result: BgRemovalResult = {
    id: params.id,
    status: 'completed',
    originalUri: params.originalUri,
    localPath,
    storageKey: params.storageKey,
    size: params.size,
    mime: 'image/png',
    createdAt: params.createdAt,
    sourceScreen: params.sourceScreen,
  };

  // Prepend and enforce max-results limit
  const existing = await load();
  const updated = [result, ...existing].slice(0, MAX_RESULTS);
  await persist(updated);

  return result;
}

/** Retrieve all saved results, most-recent first. */
export async function getResults(): Promise<BgRemovalResult[]> {
  return load();
}

/** Get a single result by ID. */
export async function getResult(id: string): Promise<BgRemovalResult | null> {
  const all = await load();
  return all.find((r) => r.id === id) ?? null;
}

/** Delete a result — removes local file and AsyncStorage entry. */
export async function deleteResult(id: string): Promise<void> {
  const all = await load();
  const result = all.find((r) => r.id === id);
  if (result) {
    try {
      const file = new File(result.localPath);
      if (file.exists) file.delete();
    } catch {}
  }
  await persist(all.filter((r) => r.id !== id));
}

/**
 * Check whether the local cached file for a result is still accessible.
 * If not, the app should prompt the user to re-process.
 */
export function isLocalFileAvailable(result: BgRemovalResult): boolean {
  try {
    const file = new File(result.localPath);
    return file.exists;
  } catch {
    return false;
  }
}

/**
 * Restore a result's local file from a base64 string.
 * Used when the local file is missing but we have the b64 in memory.
 */
export async function restoreLocalFile(id: string, b64Json: string): Promise<string> {
  const localPath = buildLocalPath(id);
  const file = new File(localPath);
  file.write(b64Json, { encoding: 'base64' });

  // Update persisted record
  const all = await load();
  const idx = all.findIndex((r) => r.id === id);
  if (idx !== -1) {
    all[idx] = { ...all[idx], localPath };
    await persist(all);
  }
  return localPath;
}

/** Clear all results and delete all local files. */
export async function clearAllResults(): Promise<void> {
  const all = await load();
  for (const r of all) {
    try {
      const file = new File(r.localPath);
      if (file.exists) file.delete();
    } catch {}
  }
  await AsyncStorage.removeItem(STORAGE_KEY);
}
