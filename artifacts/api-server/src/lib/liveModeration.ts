/**
 * Live chat moderation — pure decision logic (no DB, no I/O) so it can be
 * unit tested. routes/live.ts and routes/live-moderation.ts load the state
 * and call these.
 */

export const MAX_BANNED_WORDS = 100;
export const MAX_BANNED_WORD_LENGTH = 40;
export const MAX_SLOW_MODE_SECONDS = 300;

export type RestrictionKind = "mute" | "ban";

/** Lowercase, strip diacritics, collapse whitespace. */
export function normalizeForMatch(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalises a host-supplied list: trims, lowercases, dedupes, caps size. */
export function normalizeBannedWords(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const w = normalizeForMatch(raw).slice(0, MAX_BANNED_WORD_LENGTH);
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= MAX_BANNED_WORDS) break;
  }
  return out;
}

export function clampSlowMode(input: unknown): number {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_SLOW_MODE_SECONDS, Math.floor(n));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns the first banned word/phrase found in `message`, or null.
 * Matches whole words (so "ass" does not block "class"), case- and
 * accent-insensitively; a phrase matches across any run of whitespace.
 * Punctuation between words is treated as a boundary.
 */
export function findBannedWord(message: string, bannedWords: readonly string[]): string | null {
  if (!bannedWords.length) return null;
  const text = normalizeForMatch(message);
  for (const word of bannedWords) {
    const w = normalizeForMatch(word);
    if (!w) continue;
    const pattern = w.split(" ").map(escapeRegExp).join("\\s+");
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "u");
    if (re.test(text)) return word;
  }
  return null;
}

/** Seconds (rounded up) the viewer still has to wait, or 0 when they may post. */
export function slowModeWaitSeconds(
  lastCommentAt: Date | number | null | undefined,
  now: Date | number,
  slowModeSeconds: number,
): number {
  if (!slowModeSeconds || slowModeSeconds <= 0 || lastCommentAt == null) return 0;
  const last = typeof lastCommentAt === "number" ? lastCommentAt : lastCommentAt.getTime();
  const current = typeof now === "number" ? now : now.getTime();
  const remainingMs = last + slowModeSeconds * 1000 - current;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

export type CommentDecision =
  | { ok: true }
  | { ok: false; status: number; code: "BANNED" | "MUTED" | "BANNED_WORD" | "SLOW_MODE"; error: string; retryAfterSeconds?: number };

export interface CommentCheckInput {
  isHost: boolean;
  restriction: RestrictionKind | null;
  bannedWords: readonly string[];
  slowModeSeconds: number;
  lastCommentAt: Date | number | null;
  now: Date | number;
  message: string;
}

/** Order: ban, mute, banned word, slow mode. The host is never restricted. */
export function checkCommentAllowed(i: CommentCheckInput): CommentDecision {
  if (i.isHost) return { ok: true };
  if (i.restriction === "ban") {
    return { ok: false, status: 403, code: "BANNED", error: "You can't take part in this live." };
  }
  if (i.restriction === "mute") {
    return { ok: false, status: 403, code: "MUTED", error: "The host has muted you in this live." };
  }
  if (findBannedWord(i.message, i.bannedWords)) {
    return { ok: false, status: 422, code: "BANNED_WORD", error: "This comment contains a word the host has blocked." };
  }
  const wait = slowModeWaitSeconds(i.lastCommentAt, i.now, i.slowModeSeconds);
  if (wait > 0) {
    return {
      ok: false, status: 422, code: "SLOW_MODE", retryAfterSeconds: wait,
      error: `Slow mode is on. Try again in ${wait}s.`,
    };
  }
  return { ok: true };
}

/** A banned viewer may not join the stream at all. */
export function canJoinStream(restriction: RestrictionKind | null, isHost: boolean): boolean {
  return isHost || restriction !== "ban";
}
