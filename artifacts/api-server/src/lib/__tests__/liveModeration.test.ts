import { describe, expect, it } from "vitest";
import {
  canJoinStream, checkCommentAllowed, clampSlowMode, findBannedWord,
  normalizeBannedWords, slowModeWaitSeconds, MAX_BANNED_WORDS, MAX_SLOW_MODE_SECONDS,
} from "../liveModeration";

describe("normalizeBannedWords", () => {
  it("trims, lowercases, strips accents, dedupes and drops junk", () => {
    expect(normalizeBannedWords(["  Spam ", "SPAM", "Café", "", 5, null, "two  words"]))
      .toEqual(["spam", "cafe", "two words"]);
  });
  it("returns [] for non arrays and caps the list", () => {
    expect(normalizeBannedWords("x")).toEqual([]);
    expect(normalizeBannedWords(Array.from({ length: 500 }, (_, i) => `w${i}`))).toHaveLength(MAX_BANNED_WORDS);
  });
});

describe("findBannedWord", () => {
  it("matches whole words case- and accent-insensitively", () => {
    expect(findBannedWord("Buy my SPAM now", ["spam"])).toBe("spam");
    expect(findBannedWord("so cafe!", ["café"])).toBe("café");
    expect(findBannedWord("spam, spam", ["spam"])).toBe("spam");
  });
  it("does not match inside other words", () => {
    expect(findBannedWord("a classy class", ["ass"])).toBeNull();
    expect(findBannedWord("spammer", ["spam"])).toBeNull();
  });
  it("matches phrases across whitespace and ignores regex metacharacters", () => {
    expect(findBannedWord("go to   my page", ["go to my page"])).toBe("go to my page");
    expect(findBannedWord("hello", ["h.llo"])).toBeNull();
  });
  it("returns null with no list", () => {
    expect(findBannedWord("anything", [])).toBeNull();
  });
});

describe("slow mode", () => {
  const t0 = 1_000_000;
  it("is off for 0 or no previous comment", () => {
    expect(slowModeWaitSeconds(t0, t0 + 1, 0)).toBe(0);
    expect(slowModeWaitSeconds(null, t0, 10)).toBe(0);
  });
  it("rounds the remaining wait up", () => {
    expect(slowModeWaitSeconds(t0, t0 + 1, 10)).toBe(10);
    expect(slowModeWaitSeconds(t0, t0 + 9_500, 10)).toBe(1);
    expect(slowModeWaitSeconds(t0, t0 + 10_000, 10)).toBe(0);
    expect(slowModeWaitSeconds(new Date(t0), new Date(t0 + 4_000), 10)).toBe(6);
  });
  it("clamps input", () => {
    expect(clampSlowMode(-4)).toBe(0);
    expect(clampSlowMode("abc")).toBe(0);
    expect(clampSlowMode(7.9)).toBe(7);
    expect(clampSlowMode(99999)).toBe(MAX_SLOW_MODE_SECONDS);
  });
});

describe("checkCommentAllowed", () => {
  const base = {
    isHost: false, restriction: null, bannedWords: [] as string[], slowModeSeconds: 0,
    lastCommentAt: null, now: 1000, message: "hi",
  };
  it("allows a plain comment on a stream with no settings", () => {
    expect(checkCommentAllowed(base)).toEqual({ ok: true });
  });
  it("blocks banned and muted viewers but never the host", () => {
    expect(checkCommentAllowed({ ...base, restriction: "ban" })).toMatchObject({ ok: false, status: 403, code: "BANNED" });
    expect(checkCommentAllowed({ ...base, restriction: "mute" })).toMatchObject({ ok: false, status: 403, code: "MUTED" });
    expect(checkCommentAllowed({ ...base, restriction: "ban", isHost: true })).toEqual({ ok: true });
  });
  it("blocks banned words", () => {
    expect(checkCommentAllowed({ ...base, bannedWords: ["hi"] })).toMatchObject({ ok: false, status: 422, code: "BANNED_WORD" });
  });
  it("enforces slow mode with a retry hint", () => {
    const d = checkCommentAllowed({ ...base, slowModeSeconds: 10, lastCommentAt: 0, now: 4000 });
    expect(d).toMatchObject({ ok: false, status: 422, code: "SLOW_MODE", retryAfterSeconds: 6 });
    expect(checkCommentAllowed({ ...base, slowModeSeconds: 10, lastCommentAt: 0, now: 10_000 })).toEqual({ ok: true });
    expect(checkCommentAllowed({ ...base, isHost: true, slowModeSeconds: 10, lastCommentAt: 0, now: 1 })).toEqual({ ok: true });
  });
});

describe("canJoinStream", () => {
  it("rejects only banned non-hosts (muted viewers can still watch)", () => {
    expect(canJoinStream("ban", false)).toBe(false);
    expect(canJoinStream("mute", false)).toBe(true);
    expect(canJoinStream(null, false)).toBe(true);
    expect(canJoinStream("ban", true)).toBe(true);
  });
});
