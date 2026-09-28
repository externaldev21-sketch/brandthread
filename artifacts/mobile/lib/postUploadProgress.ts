/**
 * Shared "posting in progress" state for the feed header pill (item 118).
 *
 * A module-level singleton (not React state) so it survives the composer
 * screen unmounting the moment the user taps Post and is returned to the
 * feed — the actual `POST /api/posts` (or PATCH for an edit) call keeps
 * running in the background after that, updating this store, which
 * `components/feed/UploadProgressPill.tsx` subscribes to via
 * `useSyncExternalStore`. The same start/update/end calls also drive the
 * iOS Live Activity (`lib/uploadLiveActivity.ts`) — one real progress
 * source for both surfaces, not a forked model.
 */
import { useSyncExternalStore } from 'react';

export type PostUploadStatus = 'uploading' | 'success' | 'failed';

export interface PostUploadEntry {
  id: string;
  kind: 'thread';
  thumbnailUri?: string;
  status: PostUploadStatus;
  /** 0-1. Coarse but real — tied to actual request completion, not a fake timer. */
  progress: number;
  /** Present only when status === 'failed'; re-runs the same persist call. */
  retry?: () => void;
}

let entries: PostUploadEntry[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function startPostUpload(entry: Omit<PostUploadEntry, 'status' | 'progress'>) {
  entries = [...entries.filter((e) => e.id !== entry.id), { ...entry, status: 'uploading', progress: 0.1 }];
  emit();
}

export function updatePostUploadProgress(id: string, progress: number) {
  entries = entries.map((e) => (e.id === id ? { ...e, progress: Math.max(e.progress, Math.min(1, progress)) } : e));
  emit();
}

export function completePostUpload(id: string) {
  entries = entries.map((e) => (e.id === id ? { ...e, status: 'success', progress: 1 } : e));
  emit();
  // Auto-clear the success pill after it's had a moment to register.
  setTimeout(() => {
    entries = entries.filter((e) => e.id !== id);
    emit();
  }, 2500);
}

export function failPostUpload(id: string, retry?: () => void) {
  entries = entries.map((e) => (e.id === id ? { ...e, status: 'failed', retry } : e));
  emit();
}

export function dismissPostUpload(id: string) {
  entries = entries.filter((e) => e.id !== id);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return entries;
}

/** The most recent in-flight (or just-finished) upload, if any. One pill at a time. */
export function usePostUploadEntry(): PostUploadEntry | null {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return list.length > 0 ? list[list.length - 1] : null;
}
