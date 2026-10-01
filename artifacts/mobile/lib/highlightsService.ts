/**
 * Story Highlights — CRUD with a local cache (AsyncStorage) that syncs to the
 * server (/api/social/highlights). Each highlight holds a display emoji,
 * label, and cover colour; the server adds the saved stories (items).
 * The list is ordered as stored (drag-to-reorder writes the new order back).
 *
 * Signed out / dev preview: purely local, exactly as before. Signed in: the
 * server list is the source of truth and is cached here; highlights created
 * while offline (or before server sync existed) keep an `hl_` id and are
 * uploaded the next time the list loads, then swap to their server id.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceRequest } from '@/lib/serviceConfig';
import { canSyncSocialServer } from '@/services/socialService';
import type { ServerHighlight } from '@/lib/api';

const KEY = 'bt:highlights:v1';

export interface Highlight {
  id: string;
  emoji: string;
  label: string;
  coverColor: string;   // hex — shown as solid ring
  createdAt: string;    // ISO
  /** Server-synced highlights only: cover photo (first saved story unless set) and story count. */
  coverUrl?: string | null;
  itemCount?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isServerId = (id: string) => UUID_RE.test(id);
const DEFAULT_COVER = '#1C1C1E';

export function highlightFromServer(h: ServerHighlight): Highlight {
  return {
    id: h.id,
    emoji: h.coverEmoji || '✨',
    label: h.title || 'Highlight',
    coverColor: h.coverColor || DEFAULT_COVER,
    createdAt: new Date(h.createdAt).toISOString(),
    coverUrl: h.coverUrl,
    itemCount: h.itemCount,
  };
}

const hexColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : null);

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  return serviceRequest<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, false);
}

function uid() {
  return 'hl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function readLocal(): Promise<Highlight[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Local list, refreshed from the server when signed in (uploads any local-only highlights once). */
export async function loadHighlights(): Promise<Highlight[]> {
  const local = await readLocal();
  if (!canSyncSocialServer()) return local;
  try {
    const remote = await api<ServerHighlight[]>('/api/social/highlights/me');
    if (!Array.isArray(remote)) return local;
    const merged = remote.map(highlightFromServer);
    for (const h of local.filter((x) => !isServerId(x.id))) {
      try {
        const created = await api<ServerHighlight>('/api/social/highlights', 'POST', {
          title: h.label, coverEmoji: h.emoji, coverColor: hexColor(h.coverColor),
        });
        merged.push(highlightFromServer(created));
      } catch { merged.push(h); }
    }
    await saveHighlights(merged);
    return merged;
  } catch {
    return local;
  }
}

export async function saveHighlights(items: Highlight[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export async function createHighlight(params: {
  emoji: string;
  label: string;
  coverColor: string;
}): Promise<Highlight> {
  const item: Highlight = {
    id: uid(),
    emoji: params.emoji.trim() || '✨',
    label: params.label.trim() || 'Highlight',
    coverColor: params.coverColor,
    createdAt: new Date().toISOString(),
  };
  const existing = await readLocal();
  if (canSyncSocialServer()) {
    try {
      const created = await api<ServerHighlight>('/api/social/highlights', 'POST', {
        title: item.label, coverEmoji: item.emoji, coverColor: hexColor(item.coverColor),
      });
      const synced = highlightFromServer(created);
      await saveHighlights([...existing, synced]);
      return synced;
    } catch { /* offline: keep it local, uploaded on the next load */ }
  }
  await saveHighlights([...existing, item]);
  return item;
}

export async function updateHighlight(
  id: string,
  patch: Partial<Pick<Highlight, 'emoji' | 'label' | 'coverColor'>>,
): Promise<void> {
  const items = await readLocal();
  const updated = items.map(h => (h.id === id ? { ...h, ...patch } : h));
  await saveHighlights(updated);
  if (isServerId(id) && canSyncSocialServer()) {
    await api(`/api/social/highlights/${encodeURIComponent(id)}`, 'PATCH', {
      ...(patch.label !== undefined ? { title: patch.label.trim() || 'Highlight' } : {}),
      ...(patch.emoji !== undefined ? { coverEmoji: patch.emoji.trim() || null } : {}),
      ...(patch.coverColor !== undefined ? { coverColor: hexColor(patch.coverColor) } : {}),
    }).catch(() => {});
  }
}

export async function deleteHighlight(id: string): Promise<void> {
  const items = await readLocal();
  await saveHighlights(items.filter(h => h.id !== id));
  if (isServerId(id) && canSyncSocialServer()) {
    await api(`/api/social/highlights/${encodeURIComponent(id)}`, 'DELETE').catch(() => {});
  }
}

export async function reorderHighlights(ids: string[]): Promise<void> {
  const items = await readLocal();
  const map = new Map(items.map(h => [h.id, h]));
  const ordered = ids.map(id => map.get(id)).filter(Boolean) as Highlight[];
  await saveHighlights(ordered);
  if (canSyncSocialServer()) {
    await Promise.all(ordered.map((h, position) => isServerId(h.id)
      ? api(`/api/social/highlights/${encodeURIComponent(h.id)}`, 'PATCH', { position }).catch(() => {})
      : Promise.resolve()));
  }
}
