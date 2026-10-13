import { describe, expect, it } from "vitest";
import { MYSTERY_BOX_MAX_ITEMS, parsePoolInput, pickWeighted } from "../mysteryBox";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

describe("pickWeighted", () => {
  const pool = [
    { variantId: A, weight: 1, stock: 5 },
    { variantId: B, weight: 3, stock: 5 },
  ];

  it("maps each roll to a candidate by cumulative weight", () => {
    expect(pickWeighted(pool, () => 0)).toBe(A);
    expect(pickWeighted(pool, () => 1)).toBe(B);
    expect(pickWeighted(pool, () => 3)).toBe(B);
  });

  it("asks the rng for the total eligible weight", () => {
    const asked: number[] = [];
    pickWeighted(pool, (max) => { asked.push(max); return 0; });
    expect(asked).toEqual([4]);
  });

  it("excludes zero-stock candidates", () => {
    const withEmpty = [{ variantId: C, weight: 100, stock: 0 }, ...pool];
    const asked: number[] = [];
    expect(pickWeighted(withEmpty, (max) => { asked.push(max); return 0; })).toBe(A);
    expect(asked).toEqual([4]);
  });

  it("returns null when nothing has stock", () => {
    expect(pickWeighted([{ variantId: A, weight: 1, stock: 0 }], () => 0)).toBeNull();
    expect(pickWeighted([], () => 0)).toBeNull();
  });

  it("is deterministic with an injected rng and follows the weights", () => {
    const counts = { [A]: 0, [B]: 0 } as Record<string, number>;
    for (let roll = 0; roll < 4; roll++) counts[pickWeighted(pool, () => roll)!]++;
    expect(counts).toEqual({ [A]: 1, [B]: 3 });
  });

  it("works with the default crypto rng", () => {
    for (let i = 0; i < 50; i++) expect([A, B]).toContain(pickWeighted(pool));
  });
});

describe("parsePoolInput", () => {
  it("defaults reveal and weight, drops duplicates", () => {
    const r = parsePoolInput({ items: [{ variantId: A }, { variantId: A, weight: 4 }, { variantId: B, weight: 2 }] });
    expect(r).toEqual({ ok: true, value: { reveal: "at_purchase", showOdds: false, items: [{ variantId: A, weight: 1 }, { variantId: B, weight: 2 }] } });
  });

  it("rejects bad reveal, weights, ids and too many items", () => {
    expect(parsePoolInput({ reveal: "never", items: [] })).toMatchObject({ ok: false, code: "INVALID_REVEAL" });
    expect(parsePoolInput({ items: [{ variantId: A, weight: 0 }] })).toMatchObject({ ok: false, code: "INVALID_WEIGHT" });
    expect(parsePoolInput({ items: [{ variantId: A, weight: 1.5 }] })).toMatchObject({ ok: false, code: "INVALID_WEIGHT" });
    expect(parsePoolInput({ items: [{ variantId: "x" }] })).toMatchObject({ ok: false, code: "INVALID_ITEMS" });
    const many = Array.from({ length: MYSTERY_BOX_MAX_ITEMS + 1 }, () => ({ variantId: A }));
    expect(parsePoolInput({ items: many })).toMatchObject({ ok: false, code: "TOO_MANY_ITEMS" });
  });
});
