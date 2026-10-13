import { describe, expect, it } from "vitest";
import { isPostLabel, MAX_PRODUCT_MENTIONS, parseProductMentions } from "../productMentions";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const caption = "Wearing the Silver Dress with the Wool Coat";

describe("parseProductMentions", () => {
  it("orders by caption position and dedupes by product", () => {
    const r = parseProductMentions([
      { productId: B, label: "Wool Coat" },
      { productId: A, label: " Silver   Dress " },
      { productId: B, label: "Wool Coat" },
    ], caption);
    expect(r).toEqual({ ok: true, mentions: [
      { productId: A, label: "Silver Dress", position: 0 },
      { productId: B, label: "Wool Coat", position: 1 },
    ] });
  });

  it("accepts an empty list (clears)", () => {
    expect(parseProductMentions([], caption)).toEqual({ ok: true, mentions: [] });
  });

  it("rejects bad shapes, missing labels and labels not in the caption", () => {
    expect(parseProductMentions("x", caption)).toMatchObject({ ok: false, code: "INVALID_MENTIONS" });
    expect(parseProductMentions([{ productId: "nope", label: "Wool Coat" }], caption)).toMatchObject({ ok: false, code: "INVALID_MENTIONS" });
    expect(parseProductMentions([{ productId: A, label: "" }], caption)).toMatchObject({ ok: false, code: "INVALID_MENTIONS" });
    expect(parseProductMentions([{ productId: A, label: "x".repeat(81) }], caption)).toMatchObject({ ok: false, code: "INVALID_MENTIONS" });
    expect(parseProductMentions([{ productId: A, label: "wool coat" }], caption)).toMatchObject({ ok: false, code: "LABEL_NOT_IN_CAPTION" });
  });

  it("caps the number of mentions", () => {
    const words = Array.from({ length: MAX_PRODUCT_MENTIONS + 1 }, (_, i) => `item${i}`);
    const ids = words.map((_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
    const r = parseProductMentions(words.map((label, i) => ({ productId: ids[i], label })), words.join(" "));
    expect(r).toMatchObject({ ok: false, code: "TOO_MANY_MENTIONS" });
  });
});

describe("isPostLabel", () => {
  it("knows bts only", () => {
    expect(isPostLabel("bts")).toBe(true);
    expect(isPostLabel("ad")).toBe(false);
    expect(isPostLabel("toString")).toBe(false);
  });
});
