import { describe, expect, it } from "vitest";
import { generateGiftCardCode, giftCardLast4, hashGiftCardCode, looksLikeGiftCardCode, normalizeGiftCardCode } from "../codes";
import { trimGiftCardsForMinimumCharge } from "../checkout";

describe("gift card codes", () => {
  it("generates 16 unambiguous characters in four groups", () => {
    const code = generateGiftCardCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    expect(looksLikeGiftCardCode(code)).toBe(true);
  });

  it("does not repeat across many codes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i++) seen.add(generateGiftCardCode());
    expect(seen.size).toBe(5_000);
  });

  it("hashes the same code the same way however it is typed, and never stores the plaintext", () => {
    const code = "ABCD-EFGH-JKLM-NPQR";
    expect(hashGiftCardCode(code)).toBe(hashGiftCardCode("abcd efgh jklm npqr"));
    expect(hashGiftCardCode(code)).toBe(hashGiftCardCode("ABCDEFGHJKLMNPQR"));
    expect(hashGiftCardCode(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGiftCardCode(code)).not.toContain("ABCD");
    expect(giftCardLast4(code)).toBe("NPQR");
    expect(normalizeGiftCardCode(" ab-cd ")).toBe("ABCD");
  });

  it("rejects input that can't be a code before any lookup", () => {
    expect(looksLikeGiftCardCode("SAVE10")).toBe(false);
    expect(looksLikeGiftCardCode("0000-0000-0000-0000")).toBe(false); // 0 and 1 are not in the alphabet
  });
});

describe("trimGiftCardsForMinimumCharge", () => {
  it("gives back just enough gift card so the card charge reaches the minimum", () => {
    const groups = [
      { totalCents: 10, giftCardCents: 2_000 },
      { totalCents: 0, giftCardCents: 500 },
    ];
    trimGiftCardsForMinimumCharge(groups, 50);
    expect(groups.reduce((s, g) => s + g.totalCents, 0)).toBe(50);
    expect(groups[1]).toEqual({ totalCents: 50 - 10, giftCardCents: 500 - 40 });
    expect(groups[0]).toEqual({ totalCents: 10, giftCardCents: 2_000 });
  });

  it("leaves a cart alone when the charge already meets the minimum", () => {
    const groups = [{ totalCents: 800, giftCardCents: 1_000 }];
    trimGiftCardsForMinimumCharge(groups, 50);
    expect(groups).toEqual([{ totalCents: 800, giftCardCents: 1_000 }]);
  });
});
