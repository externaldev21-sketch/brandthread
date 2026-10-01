import { describe, expect, it } from "vitest";
import { normalizeShortcut, validateQuickReply, QUICK_REPLY_BODY_MAX, QUICK_REPLY_TITLE_MAX } from "../quickReplies";

describe("normalizeShortcut", () => {
  it("adds one leading slash and lowercases", () => {
    expect(normalizeShortcut("Shipping")).toBe("/shipping");
    expect(normalizeShortcut("//Shipping ")).toBe("/shipping");
  });
  it("treats empty as no shortcut", () => {
    expect(normalizeShortcut("")).toBeNull();
    expect(normalizeShortcut("  / ")).toBeNull();
    expect(normalizeShortcut(undefined)).toBeNull();
    expect(normalizeShortcut(null)).toBeNull();
  });
  it("rejects non-strings", () => expect(normalizeShortcut(5)).toBeUndefined());
});

describe("validateQuickReply", () => {
  it("accepts and trims", () => {
    expect(validateQuickReply({ title: " Shipping ", body: " Ships in 3 days ", shortcut: "shipping" }))
      .toEqual({ ok: true, value: { title: "Shipping", body: "Ships in 3 days", shortcut: "/shipping" } });
  });
  it("shortcut is optional", () => {
    expect(validateQuickReply({ title: "Hi", body: "Hello" })).toEqual({ ok: true, value: { title: "Hi", body: "Hello", shortcut: null } });
  });
  it("requires title and body", () => {
    expect(validateQuickReply({ title: "", body: "x" }).ok).toBe(false);
    expect(validateQuickReply({ title: "x", body: "  " }).ok).toBe(false);
  });
  it("enforces length limits", () => {
    expect(validateQuickReply({ title: "x".repeat(QUICK_REPLY_TITLE_MAX + 1), body: "x" }).ok).toBe(false);
    expect(validateQuickReply({ title: "x", body: "x".repeat(QUICK_REPLY_BODY_MAX + 1) }).ok).toBe(false);
    expect(validateQuickReply({ title: "x", body: "x", shortcut: "a".repeat(25) }).ok).toBe(false);
  });
  it("rejects shortcuts with spaces or symbols", () => {
    expect(validateQuickReply({ title: "x", body: "x", shortcut: "ship now" }).ok).toBe(false);
    expect(validateQuickReply({ title: "x", body: "x", shortcut: "a!b" }).ok).toBe(false);
  });
});
