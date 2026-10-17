import { z } from "@workspace/api-zod";

/** Max lengths for the public profile extras (migration 271). */
export const PRONOUNS_MAX = 30;
export const STYLE_BADGE_LABEL_MAX = 24;
export const STYLE_BADGE_EMOJI_MAX = 8;

/** PATCH /api/auth/profile `pronouns`: trimmed, "" clears it. */
export const pronounsSchema = z.string().trim().max(PRONOUNS_MAX);

/** PATCH /api/auth/profile `styleBadge`: null clears it. */
export const styleBadgeSchema = z.object({
  label: z.string().trim().max(STYLE_BADGE_LABEL_MAX),
  emoji: z.string().trim().max(STYLE_BADGE_EMOJI_MAX),
  enabled: z.boolean(),
}).strict().nullable();

export type StyleBadge = { label: string; emoji: string; enabled: boolean };

/** Stored value for `pronouns` — blank becomes null. */
export function pronounsForStorage(value: string): string | null {
  const v = value.trim();
  return v ? v : null;
}

/** Stored value for `style_badge` — a badge with no label is the same as none. */
export function styleBadgeForStorage(value: StyleBadge | null): StyleBadge | null {
  if (!value) return null;
  const label = value.label.trim();
  if (!label) return null;
  return { label, emoji: value.emoji.trim(), enabled: value.enabled === true };
}

/**
 * The badge other people may see: only an enabled badge with a label, and
 * only well-formed values (the column is jsonb, so never trust its shape).
 */
export function publicStyleBadge(raw: unknown): { label: string; emoji: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (b.enabled !== true) return null;
  const label = typeof b.label === "string" ? b.label.trim().slice(0, STYLE_BADGE_LABEL_MAX) : "";
  if (!label) return null;
  const emoji = typeof b.emoji === "string" ? b.emoji.trim().slice(0, STYLE_BADGE_EMOJI_MAX) : "";
  return { label, emoji };
}

/** Public pronouns, never longer than the limit even for legacy rows. */
export function publicPronouns(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().slice(0, PRONOUNS_MAX);
  return v || null;
}
