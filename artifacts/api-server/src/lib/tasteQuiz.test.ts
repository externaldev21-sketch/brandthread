import { describe, expect, it } from "vitest";
import { deriveStyleKeys, pickerLabelsToKeys, pickQuizProducts, STYLE_KEYS } from "./tasteQuiz";

describe("deriveStyleKeys", () => {
  it("keeps explicit canonical styleTags first and drops unknown ones", () => {
    expect(deriveStyleKeys({ name: "Coat", styleTags: ["minimalist", "made-up"], tags: [] })).toEqual(["minimalist"]);
  });

  it("finds styles from tags, name and category by whole word", () => {
    expect(deriveStyleKeys({ name: "Washed Archive Hoodie", tags: ["graphic"], category: "hoodies" }))
      .toEqual(["streetwear", "vintage"]);
  });

  it("does not match inside other words", () => {
    // "street" must not match "streetlight", "tee" must not match "steel"
    expect(deriveStyleKeys({ name: "Streetlight steel ring", tags: [] })).toEqual([]);
  });

  it("returns at most three keys", () => {
    const keys = deriveStyleKeys({ name: "Vintage linen polo fleece hoodie", tags: ["silk", "y2k"] });
    expect(keys.length).toBeLessThanOrEqual(3);
    for (const k of keys) expect(STYLE_KEYS).toContain(k);
  });
});

describe("pickerLabelsToKeys", () => {
  it("maps the onboarding picker labels onto ranking keys", () => {
    expect(pickerLabelsToKeys(["Minimal", "Graphic tees", "Basics", "Accessories", "Sustainable fashion"]))
      .toEqual(["minimalist", "streetwear", "basics"]);
  });
});

describe("pickQuizProducts", () => {
  const mk = (id: string, ownerId: string, styleKeys: any[]) => ({ id, ownerId, styleKeys });

  it("spreads across styles and sellers before repeating either", () => {
    const picked = pickQuizProducts([
      mk("1", "a", ["streetwear"]), mk("2", "a", ["streetwear"]), mk("3", "b", ["streetwear"]),
      mk("4", "c", ["vintage"]), mk("5", "d", []),
    ], 3);
    expect(picked.map((p) => p.id)).toEqual(["1", "4", "5"]);
  });

  it("fills from repeated sellers when the catalog is small", () => {
    const picked = pickQuizProducts([mk("1", "a", ["basics"]), mk("2", "a", ["basics"])], 15);
    expect(picked.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("is deterministic and never repeats a product", () => {
    const pool = Array.from({ length: 40 }, (_, i) => mk(String(i), `s${i % 9}`, [STYLE_KEYS[i % 5]]));
    const a = pickQuizProducts(pool, 15).map((p) => p.id);
    expect(a).toEqual(pickQuizProducts(pool, 15).map((p) => p.id));
    expect(new Set(a).size).toBe(15);
  });
});
