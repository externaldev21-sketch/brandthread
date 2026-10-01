/**
 * Who may see a saved live replay, and how a live_streams row is shaped for
 * the client. Pure (no db) so the rules are unit-tested in
 * lib/__tests__/liveReplayAccess.test.ts.
 *
 * A replay exists only once lib/liveReplay.ts has confirmed an uploaded
 * recording (replay_url + replay_post_id set). Rules:
 *  - no replay_url, or soft-deleted (replay_deleted_at)  -> nobody, not even the owner
 *  - owner                                              -> always (public or hidden)
 *  - everyone else                                      -> only when 'public', the linked
 *    post is still published + moderation-visible, and no block exists either way.
 */
export type ReplayVisibility = "public" | "hidden";

export interface ReplayRow {
  id: string;
  seller_id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  replay_url: string | null;
  replay_post_id: string | null;
  replay_visibility: string | null;
  replay_deleted_at: string | Date | null;
  peak_viewer_count?: number | null;
  started_at?: string | Date | null;
  ended_at?: string | Date | null;
  post_status?: string | null;
  post_moderation_status?: string | null;
}

export function normalizeVisibility(value: unknown): ReplayVisibility | null {
  return value === "public" || value === "hidden" ? value : null;
}

export function replayExists(row: ReplayRow): boolean {
  return !!row.replay_url && !!row.replay_post_id && !row.replay_deleted_at;
}

export function canViewReplay(
  viewerId: string | null,
  row: ReplayRow,
  opts: { blocked?: boolean } = {},
): boolean {
  if (!replayExists(row)) return false;
  if (viewerId && viewerId === row.seller_id) return true;
  if (opts.blocked) return false;
  if ((row.replay_visibility ?? "public") !== "public") return false;
  if (row.post_status != null && row.post_status !== "published") return false;
  if (row.post_moderation_status != null && row.post_moderation_status !== "visible") return false;
  return true;
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function replayDurationSeconds(row: Pick<ReplayRow, "started_at" | "ended_at">): number | null {
  const a = toIso(row.started_at);
  const b = toIso(row.ended_at);
  if (!a || !b) return null;
  const secs = Math.round((Date.parse(b) - Date.parse(a)) / 1000);
  return secs > 0 ? secs : null;
}

export function shapeReplay(row: ReplayRow, viewerId: string | null) {
  const isOwner = !!viewerId && viewerId === row.seller_id;
  return {
    streamId: row.id,
    sellerId: row.seller_id,
    postId: row.replay_post_id,
    title: row.title,
    description: row.description ?? null,
    thumbnailUrl: row.thumbnail_url ?? null,
    replayUrl: row.replay_url,
    peakViewerCount: row.peak_viewer_count ?? 0,
    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),
    durationSeconds: replayDurationSeconds(row),
    isOwner,
    // Owner-only: buyers never learn a replay is hidden.
    ...(isOwner ? { visibility: normalizeVisibility(row.replay_visibility) ?? "public" } : {}),
  };
}
