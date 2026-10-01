import { describe, expect, it } from "vitest";
import { cleanOverlay, percentages, MAX_OVERLAYS_PER_SLIDE } from "../storyStickers";

const clean = (raw: unknown, taken = new Set<string>()) => cleanOverlay(raw, taken);
const UUID = "11111111-1111-4111-8111-111111111111";

describe("cleanOverlay (story sticker sanitizer)", () => {
  it("keeps every field existing sticker types already used", () => {
    const text = clean({
      id: "a", type: "text", x: 10, y: 20, rotation: 5, scale: 1.2, opacity: 0.9,
      text: "hi @bob", color: "#FFF", size: 28, align: "center", fontKey: "serif", bgStyle: "solid",
      textEffect: "glow", textAnimation: "drift", bogus: "gone", nested: { a: 1 },
    })!.overlay;
    expect(text).toMatchObject({ id: "a", type: "text", x: 10, y: 20, rotation: 5, scale: 1.2, opacity: 0.9, text: "hi @bob", fontKey: "serif", textAnimation: "drift" });
    expect(text).not.toHaveProperty("bogus");
    expect(text).not.toHaveProperty("nested");

    expect(clean({ id: "m", type: "mention", x: 1, y: 2, mentionUserId: "u1", mentionHandle: "@u", mentionStyle: "neon" })!.overlay)
      .toMatchObject({ mentionUserId: "u1", mentionStyle: "neon" });
    expect(clean({ id: "l", type: "link", x: 1, y: 2, linkUrl: "https://a.b", linkText: "A" })!.overlay).toMatchObject({ linkUrl: "https://a.b" });
    expect(clean({ id: "g", type: "gif", x: 1, y: 2, gifUrl: "https://g", gifW: 10, gifH: 20 })!.overlay).toMatchObject({ gifW: 10 });
    expect(clean({ id: "r", type: "reshare_card", x: 1, y: 2, cardImageUri: "https://c", cardRadius: 12 })!.overlay).toMatchObject({ cardRadius: 12 });
    expect(clean({ id: "t", type: "threadcash", x: 1, y: 2, text: "Thread Cash" })!.overlay).toMatchObject({ text: "Thread Cash" });
    expect(clean({ id: "s", type: "shop", x: 1, y: 2, shopUrl: "https://s", shopLabel: "Shop" })!.overlay).toMatchObject({ shopLabel: "Shop" });
    expect(clean({ id: "p", type: "location", x: 1, y: 2, locationLabel: "NYC" })!.overlay).toMatchObject({ locationLabel: "NYC" });
    expect(clean({ id: "t2", type: "time", x: 1, y: 2, text: "10:00" })!.overlay).toMatchObject({ text: "10:00" });
  });

  it("drops unknown types, non-objects and script-ish garbage", () => {
    for (const raw of [null, "x", 7, [], { type: "script" }, { type: "__proto__" }, { id: "a" }]) expect(clean(raw)).toBeNull();
  });

  it("gives missing or duplicate ids a fresh unique id (votes are keyed by it)", () => {
    const taken = new Set<string>();
    const a = clean({ type: "text", text: "a" }, taken)!.overlay.id as string;
    const b = clean({ id: "dup", type: "text", text: "b" }, taken)!.overlay.id as string;
    const c = clean({ id: "dup", type: "text", text: "c" }, taken)!.overlay.id as string;
    expect(new Set([a, b, c]).size).toBe(3);
    expect(b).toBe("dup");
    expect(a.startsWith("ov_")).toBe(true);
  });

  it("polls: 2-4 trimmed options, votes reset to 0, invalid polls dropped", () => {
    const ok = clean({
      id: "p", type: "poll", x: 1, y: 2, pollQuestion: "  This   or that? ",
      pollOptions: [{ label: " This ", votes: 99 }, "That", { label: "" }, { label: "Third" }, { label: "4" }, { label: "5" }],
    })!.overlay as any;
    expect(ok.pollQuestion).toBe("This or that?");
    expect(ok.pollOptions).toEqual([{ label: "This", votes: 0 }, { label: "That", votes: 0 }, { label: "Third", votes: 0 }, { label: "4", votes: 0 }]);
    expect(clean({ type: "poll", pollQuestion: "q", pollOptions: [{ label: "only" }] })).toBeNull();
    expect(clean({ type: "poll", pollQuestion: "", pollOptions: ["a", "b"] })).toBeNull();
    const long = clean({ type: "poll", pollQuestion: "x".repeat(300), pollOptions: ["y".repeat(100), "b"] })!.overlay as any;
    expect(long.pollQuestion).toHaveLength(80);
    expect(long.pollOptions[0].label).toHaveLength(30);
  });

  it("questions need a prompt; product / countdown need a uuid and carry no client facts", () => {
    expect(clean({ type: "question", questionPrompt: " Ask me " })!.overlay.questionPrompt).toBe("Ask me");
    expect(clean({ type: "question", questionPrompt: "  " })).toBeNull();
    const product = clean({ type: "product", productId: UUID, productName: "Fake", productPriceCents: 1 });
    expect(product?.productId).toBe(UUID);
    expect(product!.overlay).not.toHaveProperty("productName");
    expect(product!.overlay).not.toHaveProperty("productPriceCents");
    expect(clean({ type: "product", productId: "nope" })).toBeNull();
    expect(clean({ type: "countdown", dropId: UUID, dropName: "x", dropReleaseAt: "2099-01-01" })!.dropId).toBe(UUID);
    expect(clean({ type: "countdown", dropId: "1" })).toBeNull();
  });

  it("exposes the per-slide cap", () => {
    expect(MAX_OVERLAYS_PER_SLIDE).toBe(12);
  });
});

describe("percentages", () => {
  it("always adds up to 100", () => {
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentages([3, 1])).toEqual([75, 25]);
    expect(percentages([0, 0])).toEqual([0, 0]);
    for (const counts of [[5, 3, 2], [1, 2, 4, 7], [9, 1]]) {
      expect(percentages(counts).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });
});
