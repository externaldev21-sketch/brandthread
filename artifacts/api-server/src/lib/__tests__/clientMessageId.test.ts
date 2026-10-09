import { describe, expect, it } from "vitest";
import { parseClientMessageId } from "../clientMessageId";

describe("parseClientMessageId", () => {
  it("accepts short opaque tokens", () => {
    expect(parseClientMessageId("cm_lz3k9a_4f8e2b1c")).toBe("cm_lz3k9a_4f8e2b1c");
    expect(parseClientMessageId("ABCDEFGH")).toBe("ABCDEFGH");
    expect(parseClientMessageId("a".repeat(64))).toBe("a".repeat(64));
  });

  it("ignores non-strings", () => {
    expect(parseClientMessageId(undefined)).toBeNull();
    expect(parseClientMessageId(null)).toBeNull();
    expect(parseClientMessageId(12345678)).toBeNull();
    expect(parseClientMessageId({ id: "abcdefgh" })).toBeNull();
  });

  it("ignores values that are too short or too long", () => {
    expect(parseClientMessageId("")).toBeNull();
    expect(parseClientMessageId("abc1234")).toBeNull();
    expect(parseClientMessageId("a".repeat(65))).toBeNull();
  });

  it("ignores values with characters outside the token alphabet", () => {
    expect(parseClientMessageId("abc def gh")).toBeNull();
    expect(parseClientMessageId("abcdefgh;x")).toBeNull();
    expect(parseClientMessageId("abcdefgh\n")).toBeNull();
  });
});
