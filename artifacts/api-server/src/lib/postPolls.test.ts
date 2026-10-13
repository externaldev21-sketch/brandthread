import { describe, expect, it } from "vitest";
import {
  percentages, pollEndsAt, pollStartsAt, summarizePoll, validatePollInput,
  POLL_DEFAULT_MINUTES, POLL_MAX_MINUTES,
} from "./postPolls";

describe("validatePollInput", () => {
  it("accepts 2-4 trimmed choices and defaults to 1 day", () => {
    const r = validatePollInput({ options: ["  Red  ", "Blue\n dress"] });
    expect(r).toEqual({ ok: true, options: ["Red", "Blue dress"], durationMinutes: POLL_DEFAULT_MINUTES });
    expect(validatePollInput({ options: ["a", "b", "c", "d"], durationMinutes: 5 }).ok).toBe(true);
    expect(validatePollInput({ options: ["a", "b"], durationMinutes: POLL_MAX_MINUTES }).ok).toBe(true);
  });

  it("rejects bad shapes, counts, empty or long choices and out-of-range lengths", () => {
    for (const body of [
      null, {}, { options: "a,b" }, { options: ["only"] }, { options: ["a", "b", "c", "d", "e"] },
      { options: ["a", "  "] }, { options: ["a", 3] }, { options: ["a", "x".repeat(26)] },
      { options: ["a", "b"], durationMinutes: 4 }, { options: ["a", "b"], durationMinutes: POLL_MAX_MINUTES + 1 },
      { options: ["a", "b"], durationMinutes: 60.5 }, { options: ["a", "b"], durationMinutes: "60" },
    ]) {
      expect(validatePollInput(body).ok, JSON.stringify(body)).toBe(false);
    }
    expect(validatePollInput({ options: ["a", "x".repeat(25)] }).ok).toBe(true);
  });
});

describe("poll clock", () => {
  const created = new Date("2026-10-01T10:00:00Z");
  it("starts when the post goes live", () => {
    const published = new Date("2026-10-01T11:00:00Z");
    const scheduled = new Date("2026-10-02T09:00:00Z");
    expect(pollStartsAt({ postStatus: "published", publishedAt: published, scheduledAt: null, createdAt: created })).toEqual(published);
    expect(pollStartsAt({ postStatus: "published", publishedAt: null, scheduledAt: null, createdAt: created })).toEqual(created);
    expect(pollStartsAt({ postStatus: "scheduled", publishedAt: null, scheduledAt: scheduled, createdAt: created })).toEqual(scheduled);
    expect(pollStartsAt({ postStatus: "draft", publishedAt: null, scheduledAt: null, createdAt: created })).toBeNull();
    expect(pollEndsAt(created, 90)?.toISOString()).toBe("2026-10-01T11:30:00.000Z");
    expect(pollEndsAt(null, 90)).toBeNull();
  });
});

describe("percentages", () => {
  it("always totals 100 and handles zero votes", () => {
    expect(percentages([0, 0])).toEqual([0, 0]);
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentages([2, 1])).toEqual([67, 33]);
    expect(percentages([1, 0, 0, 0])).toEqual([100, 0, 0, 0]);
    expect(percentages([3, 3, 1]).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("summarizePoll", () => {
  const start = new Date("2026-10-01T10:00:00Z");
  const base = {
    postId: "p1", options: ["Linen", "Denim", "Silk"], durationMinutes: 60, startsAt: start,
    counts: [3, 1, 0], myVote: null as number | null, isAuthor: false,
  };
  const during = new Date("2026-10-01T10:30:00Z");
  const after = new Date("2026-10-01T11:00:00Z");

  it("hides results from someone who hasn't voted while the poll is open, but shows the total", () => {
    const s = summarizePoll({ ...base, now: during });
    expect(s.showResults).toBe(false);
    expect(s.canVote).toBe(true);
    expect(s.totalVotes).toBe(4);
    expect(s.options.map((o) => o.percent)).toEqual([null, null, null]);
    expect(s.options.map((o) => o.votes)).toEqual([null, null, null]);
    expect(s.endsAt).toBe("2026-10-01T11:00:00.000Z");
    expect(s.isEnded).toBe(false);
    expect(s.winner).toBeNull();
  });

  it("shows results after voting, and no second vote", () => {
    const s = summarizePoll({ ...base, myVote: 1, now: during });
    expect(s.showResults).toBe(true);
    expect(s.canVote).toBe(false);
    expect(s.options.map((o) => o.percent)).toEqual([75, 25, 0]);
    expect(s.myVote).toBe(1);
  });

  it("always shows the author the results and never lets them vote", () => {
    const s = summarizePoll({ ...base, isAuthor: true, now: during });
    expect(s.showResults).toBe(true);
    expect(s.canVote).toBe(false);
  });

  it("ends exactly at the end time with final results and a winner", () => {
    const s = summarizePoll({ ...base, now: after });
    expect(s.isEnded).toBe(true);
    expect(s.canVote).toBe(false);
    expect(s.showResults).toBe(true);
    expect(s.winner).toBe(0);
    expect(summarizePoll({ ...base, counts: [2, 2, 0], now: after }).winner).toBeNull();
    expect(summarizePoll({ ...base, counts: [0, 0, 0], now: after }).winner).toBeNull();
  });

  it("can't be voted on before the post is live (draft or future schedule)", () => {
    const draft = summarizePoll({ ...base, startsAt: null, now: during });
    expect(draft.canVote).toBe(false);
    expect(draft.endsAt).toBeNull();
    expect(draft.isEnded).toBe(false);
    const future = summarizePoll({ ...base, startsAt: new Date("2026-10-02T00:00:00Z"), now: during });
    expect(future.canVote).toBe(false);
  });

  it("pads missing tallies with zero", () => {
    const s = summarizePoll({ ...base, counts: [5], myVote: 0, now: during });
    expect(s.options.map((o) => o.votes)).toEqual([5, 0, 0]);
    expect(s.totalVotes).toBe(5);
  });
});
