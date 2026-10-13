/**
 * Pure rules for polls on Threads (X/Twitter poll pattern, see
 * routes/post-polls.ts): 2-4 choices of up to 25 characters, a poll length
 * between 5 minutes and 7 days (default 1 day), one vote per person with no
 * changing it, the author can't vote, and results stay hidden until you vote
 * or the poll ends (the author always sees them). The total vote count and the
 * time left are shown to everyone, as on X.
 */

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;
export const POLL_OPTION_MAX = 25;
export const POLL_MIN_MINUTES = 5;
export const POLL_MAX_MINUTES = 7 * 24 * 60;
export const POLL_DEFAULT_MINUTES = 24 * 60;

export type PollInputResult =
  | { ok: true; options: string[]; durationMinutes: number }
  | { ok: false; error: string; code: "VALIDATION_ERROR" };

/** Validates and normalises a `{ options, durationMinutes }` request body. */
export function validatePollInput(body: unknown): PollInputResult {
  const raw = (body ?? {}) as { options?: unknown; durationMinutes?: unknown };
  if (!Array.isArray(raw.options)) {
    return { ok: false, error: "options must be an array of choices", code: "VALIDATION_ERROR" };
  }
  const options = raw.options.map((o) => (typeof o === "string" ? o.replace(/\s+/g, " ").trim() : ""));
  if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS) {
    return { ok: false, error: `A poll needs ${POLL_MIN_OPTIONS}-${POLL_MAX_OPTIONS} choices`, code: "VALIDATION_ERROR" };
  }
  if (options.some((o) => o.length === 0)) {
    return { ok: false, error: "Choices can't be empty", code: "VALIDATION_ERROR" };
  }
  if (options.some((o) => [...o].length > POLL_OPTION_MAX)) {
    return { ok: false, error: `Choices can be up to ${POLL_OPTION_MAX} characters`, code: "VALIDATION_ERROR" };
  }
  const minutes = raw.durationMinutes === undefined ? POLL_DEFAULT_MINUTES : raw.durationMinutes;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < POLL_MIN_MINUTES || minutes > POLL_MAX_MINUTES) {
    return { ok: false, error: "Poll length must be between 5 minutes and 7 days", code: "VALIDATION_ERROR" };
  }
  return { ok: true, options, durationMinutes: minutes };
}

/**
 * When the poll clock starts: the moment the post went live. Drafts (and
 * anything not live) have no start yet, so their poll has no end time.
 */
export function pollStartsAt(post: {
  postStatus: string; publishedAt: Date | null; scheduledAt: Date | null; createdAt: Date;
}): Date | null {
  if (post.postStatus === "published") return post.publishedAt ?? post.createdAt;
  if (post.postStatus === "scheduled") return post.scheduledAt;
  return null;
}

export function pollEndsAt(startsAt: Date | null, durationMinutes: number): Date | null {
  return startsAt ? new Date(startsAt.getTime() + durationMinutes * 60_000) : null;
}

/**
 * Whole-number percentages that always add up to 100 (largest remainder),
 * so "33% / 33% / 33%" never shows for three equal choices.
 */
export function percentages(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c * 100) / total);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, r: v - Math.floor(v) }))
    .sort((a, b) => b.r - a.r || counts[b.i] - counts[a.i] || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

export interface PollSummary {
  postId: string;
  options: Array<{ text: string; votes: number | null; percent: number | null }>;
  totalVotes: number;
  durationMinutes: number;
  /** ISO time the poll ends; null while the post is a draft. */
  endsAt: string | null;
  isEnded: boolean;
  /** Option index the viewer picked, or null. */
  myVote: number | null;
  isAuthor: boolean;
  canVote: boolean;
  showResults: boolean;
  /** Index of the leading choice once the poll has ended (null on a tie or no votes). */
  winner: number | null;
}

export function summarizePoll(input: {
  postId: string;
  options: string[];
  durationMinutes: number;
  startsAt: Date | null;
  counts: number[];
  myVote: number | null;
  isAuthor: boolean;
  now?: Date;
}): PollSummary {
  const now = input.now ?? new Date();
  const counts = input.options.map((_, i) => Math.max(0, input.counts[i] ?? 0));
  const totalVotes = counts.reduce((a, b) => a + b, 0);
  const ends = pollEndsAt(input.startsAt, input.durationMinutes);
  const live = !!input.startsAt && input.startsAt.getTime() <= now.getTime();
  const isEnded = !!ends && ends.getTime() <= now.getTime();
  const showResults = input.isAuthor || input.myVote !== null || isEnded;
  const pct = percentages(counts);
  let winner: number | null = null;
  if (isEnded && totalVotes > 0) {
    const max = Math.max(...counts);
    const leaders = counts.filter((c) => c === max).length;
    winner = leaders === 1 ? counts.indexOf(max) : null;
  }
  return {
    postId: input.postId,
    options: input.options.map((text, i) => ({
      text,
      votes: showResults ? counts[i] : null,
      percent: showResults ? pct[i] : null,
    })),
    totalVotes,
    durationMinutes: input.durationMinutes,
    endsAt: ends ? ends.toISOString() : null,
    isEnded,
    myVote: input.myVote,
    isAuthor: input.isAuthor,
    canVote: live && !isEnded && !input.isAuthor && input.myVote === null,
    showResults,
    winner,
  };
}
