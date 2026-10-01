import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../cursor";

const id = "550e8400-e29b-41d4-a716-446655440000";

describe("keyset cursor", () => {
  it("round-trips a microsecond timestamp exactly", () => {
    const c = { ts: "2026-09-30 23:43:13.879552", id };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("accepts whole-second timestamps", () => {
    expect(decodeCursor(encodeCursor({ ts: "2026-09-30 23:43:13", id }))).toEqual({ ts: "2026-09-30 23:43:13", id });
  });

  it.each([
    undefined, null, 42, "", "not-base64!!", "x".repeat(300),
    Buffer.from("{}").toString("base64url"),
    Buffer.from(JSON.stringify(["2026-09-30 23:43:13", "not-a-uuid"])).toString("base64url"),
    Buffer.from(JSON.stringify(["'; drop table posts; --", id])).toString("base64url"),
    Buffer.from(JSON.stringify(["2026-09-30 23:43:13", id, "extra"])).toString("base64url"),
  ])("rejects %s", (value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});
