/**
 * Who can see a Note (the bubble above the Messages stories tray).
 *
 * Instagram's Notes offer two audiences, and the compose sheet copies them:
 *  - 'friends'       "Followers you follow back" (mutual follows)
 *  - 'close_friends' the author's Close Friends list
 * 'followers' is what every note was before audiences existed (visible to
 * anyone following the author). Existing rows keep it, and a client that
 * doesn't send an audience gets it too, so nothing becomes more visible or
 * less visible than it was.
 *
 * The checks reuse the story audience rules in storyAccess.ts, so a Close
 * Friends note and a Close Friends story are gated identically.
 */
import { audienceAllows, type ViewerRelations } from "./storyAccess";

export type NoteAudience = "followers" | "friends" | "close_friends";

export const NOTE_AUDIENCES: readonly NoteAudience[] = ["followers", "friends", "close_friends"];

/** Parses a request's `audience`. Missing means 'followers'; anything
 *  else that isn't a known audience is rejected (null). */
export function parseNoteAudience(value: unknown): NoteAudience | null {
  if (value === undefined || value === null || value === "") return "followers";
  return typeof value === "string" && (NOTE_AUDIENCES as readonly string[]).includes(value)
    ? (value as NoteAudience)
    : null;
}

/** Stored value → a known audience (unknown/legacy values read as 'followers'). */
export function normalizeNoteAudience(value: string | null | undefined): NoteAudience {
  return value === "friends" || value === "close_friends" ? value : "followers";
}

/**
 * Whether `viewerId` may see a note by `authorId`. Callers have already
 * limited candidates to authors the viewer follows and removed blocks, so
 * 'followers' passes here.
 */
export function noteVisibleTo(
  audience: string | null | undefined, authorId: string, viewerId: string, rel: ViewerRelations,
): boolean {
  const a = normalizeNoteAudience(audience);
  return audienceAllows(a === "followers" ? "public" : a, authorId, viewerId, rel);
}
