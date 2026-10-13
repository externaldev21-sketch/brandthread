import { describe, expect, it } from "vitest";
import { brandNames, buildOrderAnniversaryCopy, buildWeeklyDigestCopy } from "./retentionPushCopy";

const b = (name: string, products = 0, posts = 0, drops = 0) => ({ sellerId: name, name, products, posts, drops });
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe("brandNames", () => {
  it("names up to two brands, then counts the rest", () => {
    expect(brandNames(["Acme"])).toBe("Acme");
    expect(brandNames(["Acme", "Nori"])).toBe("Acme and Nori");
    expect(brandNames(["Acme", "Nori", "Lune"])).toBe("Acme, Nori and 1 more");
    expect(brandNames(["Acme", "Nori", "Lune", "Oro", "Kai"])).toBe("Acme, Nori and 3 more");
  });
});

describe("buildWeeklyDigestCopy", () => {
  it("never builds an empty digest", () => {
    expect(buildWeeklyDigestCopy([])).toBeNull();
    expect(buildWeeklyDigestCopy([b("Acme"), b("Nori")])).toBeNull();
  });

  it("lists the most active brands first", () => {
    const copy = buildWeeklyDigestCopy([b("Nori", 2), b("Acme Studio", 6), b("Lune", 1), b("Oro", 2), b("Kai", 1), b("Quiet")]);
    expect(copy).toEqual({
      title: "This week from brands you follow",
      body: "Acme Studio, Nori and 3 more added 12 new pieces.",
    });
  });

  it("singular forms", () => {
    expect(buildWeeklyDigestCopy([b("Acme", 1)])?.body).toBe("Acme added 1 new piece.");
    expect(buildWeeklyDigestCopy([b("Acme", 0, 1)])?.body).toBe("Acme shared 1 post.");
  });

  it("mixes pieces, drops and posts", () => {
    expect(buildWeeklyDigestCopy([b("Acme", 3, 2, 1), b("Nori", 0, 1)])?.body)
      .toBe("Acme and Nori shared 3 new pieces, 1 drop and 3 posts.");
  });

  it("is short, plain and emoji-free", () => {
    const copy = buildWeeklyDigestCopy([b("A", 40, 20, 3), b("B", 1), b("C", 1), b("D", 1)])!;
    expect(copy.body).not.toMatch(EMOJI);
    expect(copy.body).not.toContain("!");
    expect(copy.body.length).toBeLessThan(110);
  });
});

describe("buildOrderAnniversaryCopy", () => {
  it("follows the On this day pattern", () => {
    expect(buildOrderAnniversaryCopy({ productName: "Wool Overshirt", brandName: "Acme Studio" })).toEqual({
      title: "One year ago today",
      body: "You got Wool Overshirt from Acme Studio. See what's new from Acme Studio.",
    });
  });
  it("never shows an empty name", () => {
    expect(buildOrderAnniversaryCopy({ productName: " ", brandName: "Acme" }).body)
      .toBe("You got your order from Acme. See what's new from Acme.");
  });
});
