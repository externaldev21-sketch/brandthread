/**
 * DB loaders for live moderation. A stream with no moderation rows (or a
 * database that has not run migration 125 yet) resolves to "no restrictions",
 * i.e. exactly the behaviour live chat had before moderation existed.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { normalizeBannedWords, clampSlowMode, type RestrictionKind } from "./liveModeration";

export interface EffectiveSettings {
  bannedWords: string[];
  slowModeSeconds: number;
  pinnedCommentId: string | null;
  /** true when the stream has its own row; false when falling back to the seller default. */
  custom: boolean;
}

export const EMPTY_SETTINGS: EffectiveSettings = { bannedWords: [], slowModeSeconds: 0, pinnedCommentId: null, custom: false };

function isMissingRelation(err: unknown): boolean {
  const e = err as any;
  return e?.code === "42P01" || e?.cause?.code === "42P01" || e?.code === "42703" || e?.cause?.code === "42703";
}

/** Stream's own settings, else the host's saved defaults, else empty. */
export async function loadEffectiveSettings(streamId: string, sellerId: string): Promise<EffectiveSettings> {
  try {
    const r = await db.execute(sql`
      SELECT ms.banned_words AS ms_words, ms.slow_mode_seconds AS ms_slow, ms.pinned_comment_id,
             (ms.stream_id IS NOT NULL) AS has_row,
             d.banned_words AS d_words, d.slow_mode_seconds AS d_slow
      FROM (SELECT 1) one
      LEFT JOIN live_moderation_settings ms ON ms.stream_id = ${streamId}::uuid
      LEFT JOIN seller_live_moderation_defaults d ON d.seller_id = ${sellerId}
    `);
    const row = r.rows[0] as any;
    if (!row) return EMPTY_SETTINGS;
    if (row.has_row) {
      return {
        bannedWords: normalizeBannedWords(row.ms_words),
        slowModeSeconds: clampSlowMode(row.ms_slow),
        pinnedCommentId: row.pinned_comment_id ?? null,
        custom: true,
      };
    }
    return {
      bannedWords: normalizeBannedWords(row.d_words),
      slowModeSeconds: clampSlowMode(row.d_slow),
      pinnedCommentId: null,
      custom: false,
    };
  } catch (err) {
    if (isMissingRelation(err)) return EMPTY_SETTINGS;
    throw err;
  }
}

export async function loadRestriction(streamId: string, userId: string): Promise<RestrictionKind | null> {
  try {
    const r = await db.execute(sql`
      SELECT kind FROM live_stream_restrictions
      WHERE stream_id = ${streamId}::uuid AND user_id = ${userId} LIMIT 1
    `);
    const kind = (r.rows[0] as any)?.kind;
    return kind === "ban" || kind === "mute" ? kind : null;
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
}

export async function loadLastCommentAt(streamId: string, userId: string): Promise<Date | null> {
  const r = await db.execute(sql`
    SELECT created_at FROM live_comments
    WHERE stream_id = ${streamId}::uuid AND user_id = ${userId}
    ORDER BY created_at DESC LIMIT 1
  `);
  const v = (r.rows[0] as any)?.created_at;
  return v ? new Date(v) : null;
}
