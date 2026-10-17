import { describe, expect, it } from "vitest";
import { parseSkipAllBody } from "../firstRunTipsSkipAll";

describe("parseSkipAllBody", () => {
  it("defaults to turning skip-all on for an empty or missing body (older clients)", () => {
    expect(parseSkipAllBody(undefined)).toEqual({ ok: true, skipAll: true });
    expect(parseSkipAllBody({})).toEqual({ ok: true, skipAll: true });
  });

  it("accepts an explicit boolean so the toggle can be turned back off", () => {
    expect(parseSkipAllBody({ skipAll: false })).toEqual({ ok: true, skipAll: false });
    expect(parseSkipAllBody({ skipAll: true })).toEqual({ ok: true, skipAll: true });
  });

  it("rejects non-boolean values", () => {
    expect(parseSkipAllBody({ skipAll: "false" })).toEqual({ ok: false, error: "skipAll must be a boolean" });
    expect(parseSkipAllBody({ skipAll: 0 })).toMatchObject({ ok: false });
  });
});
