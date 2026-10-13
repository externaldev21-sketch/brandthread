import { describe, expect, it } from "vitest";
import { giftColumns, giftResponse, giftSchema, moderateGift } from "./giftOptions";

describe("giftSchema", () => {
  it("trims and drops empty strings", () => {
    expect(giftSchema.parse({ to: "  Sam ", from: "   ", message: " Hi " })).toEqual({ to: "Sam", message: "Hi" });
  });
  it("enforces the limits after trimming", () => {
    expect(giftSchema.safeParse({ to: "x".repeat(60) }).success).toBe(true);
    expect(giftSchema.safeParse({ to: "x".repeat(61) }).success).toBe(false);
    expect(giftSchema.safeParse({ from: "x".repeat(61) }).success).toBe(false);
    expect(giftSchema.safeParse({ message: ` ${"x".repeat(250)} ` }).success).toBe(true);
    expect(giftSchema.safeParse({ message: "x".repeat(251) }).success).toBe(false);
    expect(giftSchema.safeParse({ note: "x" }).success).toBe(false);
  });
});

describe("giftColumns / giftResponse", () => {
  it("marks a gift with no fields as a gift", () => {
    expect(giftColumns({})).toEqual({ isGift: true, giftTo: null, giftFrom: null, giftMessage: null });
    expect(giftColumns(undefined)).toEqual({});
  });
  it("only exposes gift fields on gift orders", () => {
    expect(giftResponse({ isGift: false, giftMessage: "stale" })).toEqual({ isGift: false, gift: null });
    expect(giftResponse({ isGift: true, giftTo: "Sam", giftFrom: null, giftMessage: "Hi" }))
      .toEqual({ isGift: true, gift: { to: "Sam", from: null, message: "Hi" } });
  });
});

describe("moderateGift", () => {
  it("allows a normal note and casual language", () => {
    expect(moderateGift({ message: "Happy birthday, damn you're old" }).ok).toBe(true);
  });
  it("rejects harassment in any field", () => {
    expect(moderateGift({ message: "kill yourself" }).ok).toBe(false);
    expect(moderateGift({ to: "kys" }).ok).toBe(false);
  });
});

describe("giftNoteForShopify", () => {
  it("adds nothing for a regular order", async () => {
    const { giftNoteForShopify } = await import("./shopify/orderForwarding");
    expect(giftNoteForShopify({ isGift: false, giftMessage: "x" })).toBe("");
  });
  it("asks for a gift receipt and carries the note", async () => {
    const { giftNoteForShopify } = await import("./shopify/orderForwarding");
    expect(giftNoteForShopify({ isGift: true, giftTo: "Sam", giftFrom: null, giftMessage: "Happy birthday" }))
      .toBe("\nGift order: pack a gift receipt with prices hidden.\nTo: Sam\nGift message: Happy birthday");
  });
});
