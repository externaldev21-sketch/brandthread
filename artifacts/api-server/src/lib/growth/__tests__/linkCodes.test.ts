import { describe, expect, it } from "vitest";
import { LINK_CODE_ALPHABET, generateLinkCode, generateUniqueLinkCode, normalizeLinkCode } from "../linkCodes";

describe("link code generation", () => {
  it("only uses the unambiguous alphabet and the requested length", () => {
    for (let i = 0; i < 500; i++) {
      const c = generateLinkCode();
      expect(c).toHaveLength(8);
      expect([...c].every((ch) => LINK_CODE_ALPHABET.includes(ch))).toBe(true);
    }
    expect(LINK_CODE_ALPHABET).not.toMatch(/[01ilo]/);
  });

  it("produces no collisions across 50,000 codes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50_000; i++) seen.add(generateLinkCode());
    expect(seen.size).toBe(50_000);
  });

  it("retries until a free code is found", async () => {
    const taken = new Set(["aaaaaaaa", "bbbbbbbb"]);
    const seq = ["aaaaaaaa", "bbbbbbbb", "cccccccc"];
    let i = 0;
    const code = await generateUniqueLinkCode(async (c) => taken.has(c), 8, () => seq[i++]);
    expect(code).toBe("cccccccc");
    expect(i).toBe(3);
  });

  it("falls back to a longer code when every attempt collides", async () => {
    const code = await generateUniqueLinkCode(async () => true, 3);
    expect(code).toHaveLength(10);
  });

  it("normalises and rejects codes", () => {
    expect(normalizeLinkCode(" ABCDEFGH ")).toBe("abcdefgh");
    expect(normalizeLinkCode("abc")).toBeNull();
    expect(normalizeLinkCode("abcdefg1")).toBeNull(); // '1' is not in the alphabet
    expect(normalizeLinkCode("ab/../cd")).toBeNull();
    expect(normalizeLinkCode(42)).toBeNull();
  });
});
