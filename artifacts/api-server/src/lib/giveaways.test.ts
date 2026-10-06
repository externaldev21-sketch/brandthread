import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildRulesTemplate,
  classifyEntries,
  generateShareCode,
  giveawayPhase,
  hashEligible,
  isQualifyingComment,
  pickWinners,
  validateGiveawayInput,
  PLATFORM_SPONSOR_DISCLAIMER,
  withPlatformDisclaimer,
} from "./giveaways";

const SELLER = "seller_1";
const start = new Date("2026-06-01T00:00:00Z");
const end = new Date("2026-06-08T00:00:00Z");
const at = (iso: string) => new Date(iso);

describe("giveawayPhase", () => {
  const g = { status: "open", startsAt: start, endsAt: end };
  it("derives phase from dates and status", () => {
    expect(giveawayPhase(g, at("2026-05-31T00:00:00Z"))).toBe("upcoming");
    expect(giveawayPhase(g, at("2026-06-03T00:00:00Z"))).toBe("live");
    expect(giveawayPhase(g, at("2026-06-08T00:00:00Z"))).toBe("ended");
    expect(giveawayPhase({ ...g, status: "drawn" }, at("2026-06-03T00:00:00Z"))).toBe("drawn");
    expect(giveawayPhase({ ...g, status: "cancelled" }, at("2026-06-03T00:00:00Z"))).toBe("cancelled");
  });
});

describe("pickWinners", () => {
  it("never returns duplicates and respects count", () => {
    const pool = Array.from({ length: 50 }, (_, i) => `u${i}`);
    for (let n = 0; n < 200; n++) {
      const w = pickWinners(pool, 10);
      expect(w).toHaveLength(10);
      expect(new Set(w).size).toBe(10);
      for (const id of w) expect(pool).toContain(id);
    }
  });

  it("returns the whole pool when count exceeds it, and nothing for an empty pool", () => {
    expect(pickWinners(["a", "b"], 5).sort()).toEqual(["a", "b"]);
    expect(pickWinners([], 3)).toEqual([]);
    expect(pickWinners(["a"], 0)).toEqual([]);
  });

  it("does not mutate the input pool", () => {
    const pool = ["a", "b", "c", "d"];
    pickWinners(pool, 2);
    expect(pool).toEqual(["a", "b", "c", "d"]);
  });

  it("is uniform: every entrant wins about count/N of the time (chi-square)", () => {
    const N = 10;
    const pool = Array.from({ length: N }, (_, i) => `u${i}`);
    const trials = 30_000;
    const wins = new Map<string, number>(pool.map((p) => [p, 0]));
    for (let t = 0; t < trials; t++) {
      for (const w of pickWinners(pool, 3, crypto.randomInt)) wins.set(w, wins.get(w)! + 1);
    }
    const expected = (trials * 3) / N;
    const chi = [...wins.values()].reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
    // df = 9; critical value at p = 0.0001 is ~33.7, so this only fails on real bias.
    expect(chi).toBeLessThan(33.7);
  });

  it("uses the injected random source deterministically", () => {
    const seq = [2, 0, 1];
    let i = 0;
    const w = pickWinners(["a", "b", "c", "d"], 3, () => seq[i++]!);
    expect(w).toEqual(["c", "b", "d"]);
  });
});

describe("hashEligible", () => {
  it("is order independent and changes with the pool", () => {
    expect(hashEligible(["b", "a", "c"])).toBe(hashEligible(["c", "b", "a"]));
    expect(hashEligible(["a", "b"])).not.toBe(hashEligible(["a", "b", "c"]));
    expect(hashEligible(["a"])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isQualifyingComment", () => {
  it("rejects empty, mention-only and link-only comments", () => {
    expect(isQualifyingComment("   ")).toBe(false);
    expect(isQualifyingComment("@friend @other")).toBe(false);
    expect(isQualifyingComment("https://spam.example/win")).toBe(false);
    expect(isQualifyingComment("a")).toBe(false);
  });
  it("accepts real text", () => {
    expect(isQualifyingComment("Love this!")).toBe(true);
    expect(isQualifyingComment("@friend check this out")).toBe(true);
  });
});

describe("classifyEntries", () => {
  const base = {
    sellerId: SELLER, startsAt: start, endsAt: end,
    blocked: new Set<string>(), inactive: new Set<string>(),
  };
  const c = (id: string, body: string, iso: string) => ({ id, body, createdAt: at(iso) });

  it("dedupes to one entry per person even with many comments", () => {
    const comments = new Map([["a", [c("1", "first!", "2026-06-02T00:00:00Z"), c("2", "second", "2026-06-03T00:00:00Z")]]]);
    const out = classifyEntries({ ...base, userIds: ["a", "a", "a"], following: new Set(["a"]), comments });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ eligible: true, commentId: "1" });
  });

  it("excludes the seller, blocked and inactive accounts", () => {
    const comments = new Map(["a", "b", "c", SELLER].map((u) => [u, [c(`c-${u}`, "nice one", "2026-06-02T00:00:00Z")]]));
    const out = classifyEntries({
      ...base, userIds: ["a", "b", "c", SELLER], following: new Set(["a", "b", "c", SELLER]),
      blocked: new Set(["b"]), inactive: new Set(["c"]), comments,
    });
    const by = Object.fromEntries(out.map((e) => [e.userId, e]));
    expect(by.a!.eligible).toBe(true);
    expect(by.b).toMatchObject({ eligible: false, excludedReason: "blocked" });
    expect(by.c).toMatchObject({ eligible: false, excludedReason: "inactive_account" });
    expect(by[SELLER]).toMatchObject({ eligible: false, excludedReason: "seller" });
  });

  it("requires a follow and, for post giveaways, an in-window real comment", () => {
    const comments = new Map([
      ["nofollow", [c("1", "great", "2026-06-02T00:00:00Z")]],
      ["early", [c("2", "great", "2026-05-01T00:00:00Z")]],
      ["late", [c("3", "great", "2026-06-09T00:00:00Z")]],
      ["spam", [c("4", "@a @b", "2026-06-02T00:00:00Z")]],
      ["ok", [c("5", "great", "2026-06-02T00:00:00Z")]],
    ]);
    const ids = ["nofollow", "early", "late", "spam", "ok", "silent"];
    const out = classifyEntries({ ...base, userIds: ids, following: new Set(["early", "late", "spam", "ok", "silent"]), comments });
    const by = Object.fromEntries(out.map((e) => [e.userId, e.excludedReason]));
    expect(by).toMatchObject({
      nofollow: "not_following", early: "no_comment", late: "no_comment",
      spam: "spam_comment", ok: null, silent: "no_comment",
    });
  });

  it("follow-only giveaways need just a follow", () => {
    const out = classifyEntries({ ...base, userIds: ["a", "b"], following: new Set(["a"]), comments: null });
    expect(out.find((e) => e.userId === "a")!.eligible).toBe(true);
    expect(out.find((e) => e.userId === "b")!.excludedReason).toBe("not_following");
  });
});

describe("Apple / Google sponsor disclaimer (QA-0100)", () => {
  const base = {
    title: "Spring drop", prizeText: "A hoodie", startsAt: new Date("2030-06-01T00:00:00Z").toISOString(),
    endsAt: new Date("2030-06-08T00:00:00Z").toISOString(), winnerCount: 1,
  };
  it("is in the generated rules", () => {
    expect(buildRulesTemplate({ sellerName: "A", prizeText: "B", startsAt: start, endsAt: end, winnerCount: 1, postEntry: false }))
      .toContain(PLATFORM_SPONSOR_DISCLAIMER);
  });
  it("is added to seller-written rules exactly once", () => {
    expect(withPlatformDisclaimer("My rules.")).toBe(`My rules.\n${PLATFORM_SPONSOR_DISCLAIMER}`);
    expect(withPlatformDisclaimer(`My rules.\n${PLATFORM_SPONSOR_DISCLAIMER}`)).toBe(`My rules.\n${PLATFORM_SPONSOR_DISCLAIMER}`);
  });
  it("survives a seller deleting it before saving", () => {
    const r = validateGiveawayInput({ ...base, rulesText: "No purchase necessary. Sponsor: me." }, new Date("2030-05-01T00:00:00Z"));
    expect(r.ok && r.value.rulesText).toContain("Apple Inc. and Google LLC are not sponsors");
  });
});

describe("buildRulesTemplate", () => {
  const input = {
    sellerName: "Atelier Nord", prizeText: "A $200 store credit", startsAt: start, endsAt: end,
    winnerCount: 2, postEntry: true,
  };
  it("always states no purchase necessary and names the prize, dates and winner count", () => {
    const t = buildRulesTemplate(input);
    expect(t).toMatch(/NO PURCHASE NECESSARY/);
    expect(t).toContain("A $200 store credit");
    expect(t).toContain("June 1, 2026");
    expect(t).toContain("June 8, 2026");
    expect(t).toContain("2 winners");
    expect(t).toContain("comment on the featured post");
  });
  it("uses supplied eligibility/region and follow-only wording", () => {
    const t = buildRulesTemplate({ ...input, winnerCount: 1, postEntry: false, region: "the United States", eligibility: "Open to residents 18+" });
    expect(t).toContain("Open to residents 18+");
    expect(t).toContain("Open in the United States");
    expect(t).toContain("1 winner");
    expect(t).not.toContain("comment on the featured post");
  });
});

describe("validateGiveawayInput", () => {
  const now = new Date("2026-05-30T00:00:00Z");
  const ok = {
    title: "Summer giveaway", prizeText: "A hoodie", startsAt: start.toISOString(), endsAt: end.toISOString(),
    rulesText: "NO PURCHASE NECESSARY", winnerCount: 2,
  };
  it("accepts a valid payload", () => {
    expect(validateGiveawayInput(ok, now).ok).toBe(true);
  });
  it("rejects bad dates, counts and over-long runs", () => {
    expect(validateGiveawayInput({ ...ok, endsAt: start.toISOString() }, now).ok).toBe(false);
    expect(validateGiveawayInput({ ...ok, winnerCount: 0 }, now).ok).toBe(false);
    expect(validateGiveawayInput({ ...ok, winnerCount: 51 }, now).ok).toBe(false);
    expect(validateGiveawayInput({ ...ok, endsAt: "2027-01-01T00:00:00Z" }, now).ok).toBe(false);
    expect(validateGiveawayInput({ ...ok, startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-02T00:00:00Z" }, now).ok).toBe(false);
    expect(validateGiveawayInput({ ...ok, title: "" }, now).ok).toBe(false);
  });
});

describe("generateShareCode", () => {
  it("is 8 unambiguous characters", () => {
    for (let i = 0; i < 50; i++) expect(generateShareCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });
});
