/**
 * Pure helpers for syncing Add Product drafts with /api/product-drafts.
 *
 * No I/O here — productService owns AsyncStorage and the network; this file
 * only decides what the merged list is and what needs writing where, so the
 * rules are unit-testable on their own.
 *
 * Rules:
 *  - Last write wins by the draft's own save time (`lastSavedAt` locally,
 *    `updatedAt` on the server — the server stores the client's timestamp).
 *    A tie is the same save on both sides: nothing to write either way.
 *  - A local draft the server doesn't have is pushed — unless we've synced
 *    it before and it hasn't changed since, which means another device
 *    discarded/published it: then it's removed locally too.
 *  - A pending local delete (tombstone) hides the server copy and retries
 *    the server delete, so an offline discard can't resurrect the draft.
 */
import type { ProductDraft } from '@/services/productTypes';

export interface ServerDraftRow {
  clientDraftId: string;
  data: Record<string, unknown>;
  updatedAt: string;
}

/** Per-draft sync bookkeeping, kept beside (not inside) the draft. */
export interface DraftSyncMeta {
  /** Server `updatedAt` of the last copy confirmed in sync. */
  syncedAt?: string;
  /** Discarded locally; server delete not yet confirmed. */
  deleted?: boolean;
}

export type DraftSyncMetaMap = Record<string, DraftSyncMeta>;

export interface DraftMergeResult {
  /** What the drafts list should show, newest first. */
  drafts: ProductDraft[];
  /** Server copies that won and must be written to the local cache. */
  cacheWrites: ProductDraft[];
  /** Local drafts removed elsewhere — drop from the local cache. */
  localDeletes: string[];
  /** Local drafts newer than (or missing from) the server — push them. */
  pushIds: string[];
  /** Tombstoned ids whose server delete should be retried. */
  retryDeleteIds: string[];
  /** Meta after the merge. */
  meta: DraftSyncMetaMap;
}

export function timeOf(value: string | undefined | null): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

/** Turns a server row into the local ProductDraft shape. */
export function draftFromServer(row: ServerDraftRow): ProductDraft {
  return {
    ...(row.data as Partial<ProductDraft>),
    id: row.clientDraftId,
    isDraft: true,
    currentStep: typeof row.data.currentStep === 'number' ? row.data.currentStep : 1,
    lastSavedAt: row.updatedAt,
  } as ProductDraft;
}

export function mergeDrafts(
  local: ProductDraft[],
  server: ServerDraftRow[],
  meta: DraftSyncMetaMap,
): DraftMergeResult {
  const nextMeta: DraftSyncMetaMap = { ...meta };
  const localById = new Map(local.map(d => [d.id, d]));
  const serverById = new Map(server.map(r => [r.clientDraftId, r]));
  const out = new Map<string, ProductDraft>();
  const cacheWrites: ProductDraft[] = [];
  const localDeletes: string[] = [];
  const pushIds: string[] = [];
  const retryDeleteIds: string[] = [];

  // deleteDraft removes the local copy before tombstoning, so a tombstone
  // with a local copy present means the draft was saved again afterwards —
  // that newer local save is live and supersedes the discard.
  const tombstoned = (id: string) => !!meta[id]?.deleted && !localById.has(id);

  for (const [id, m] of Object.entries(meta)) {
    if (!m.deleted) continue;
    if (!tombstoned(id)) delete nextMeta[id];
    else if (serverById.has(id)) retryDeleteIds.push(id);
    else delete nextMeta[id]; // server already gone — tombstone done
  }

  for (const row of server) {
    const id = row.clientDraftId;
    if (tombstoned(id)) continue;
    const mine = localById.get(id);
    if (!mine || timeOf(row.updatedAt) >= timeOf(mine.lastSavedAt)) {
      if (!mine || timeOf(row.updatedAt) > timeOf(mine.lastSavedAt)) {
        const fromServer = draftFromServer(row);
        out.set(id, fromServer);
        cacheWrites.push(fromServer);
      } else {
        // Same save on both sides: keep this device's copy (its local image
        // URIs still resolve here).
        out.set(id, mine);
      }
      nextMeta[id] = { syncedAt: row.updatedAt };
    } else {
      out.set(id, mine);
      pushIds.push(id);
    }
  }

  for (const d of local) {
    if (serverById.has(d.id)) continue;
    const syncedAt = meta[d.id]?.syncedAt;
    if (syncedAt && timeOf(d.lastSavedAt) <= timeOf(syncedAt)) {
      // Was on the server, unchanged here since, now gone there: removed on
      // another device (discarded or published).
      localDeletes.push(d.id);
      delete nextMeta[d.id];
      continue;
    }
    out.set(d.id, d);
    pushIds.push(d.id);
  }

  const drafts = [...out.values()].sort((a, b) => timeOf(b.lastSavedAt) - timeOf(a.lastSavedAt));
  return { drafts, cacheWrites, localDeletes, pushIds, retryDeleteIds, meta: nextMeta };
}

// ─── Images ──────────────────────────────────────────────────────────────────

/** A URI only readable on this device (can't be shown on another one). */
export function isDeviceLocalUri(uri: unknown): uri is string {
  return typeof uri === 'string' && /^(file|content|ph|assets-library|blob|data):/i.test(uri);
}

/** Every device-local image URI a draft references (deduplicated). */
export function collectLocalImageUris(draft: Partial<ProductDraft>): string[] {
  const found = new Set<string>();
  for (const m of draft.media ?? []) {
    if (isDeviceLocalUri(m?.uri)) found.add(m.uri);
    if (isDeviceLocalUri(m?.cutoutUri)) found.add(m.cutoutUri);
    if (isDeviceLocalUri(m?.thumbnailUri)) found.add(m.thumbnailUri);
  }
  if (isDeviceLocalUri(draft.sizeChartImageUrl)) found.add(draft.sizeChartImageUrl);
  return [...found];
}

/** Copy of `draft` with any uploaded local URIs swapped for remote ones. */
export function withRemoteImageUris<T extends Partial<ProductDraft>>(draft: T, remoteFor: Record<string, string>): T {
  const swap = (uri: string | undefined) => (uri && remoteFor[uri]) || uri;
  return {
    ...draft,
    ...(draft.media
      ? {
          media: draft.media.map(m => ({
            ...m,
            uri: swap(m.uri) as string,
            ...(m.cutoutUri !== undefined ? { cutoutUri: swap(m.cutoutUri) } : {}),
            ...(m.thumbnailUri !== undefined ? { thumbnailUri: swap(m.thumbnailUri) } : {}),
          })),
        }
      : {}),
    ...(typeof draft.sizeChartImageUrl === 'string'
      ? { sizeChartImageUrl: swap(draft.sizeChartImageUrl) }
      : {}),
  };
}
