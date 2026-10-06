import { describe, expect, it } from "vitest";

const { parseRange } = require("./serve.js") as {
  parseRange: (header: string, size: number) => { start: number; end: number } | "unsatisfiable" | null;
};

describe("byte ranges for demo video", () => {
  it("parses the ranges browsers send for <video>", () => {
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=0-1", 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange("bytes=50-200", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });
  it("rejects ranges past the end and ignores junk", () => {
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("items=0-1", 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
  });
});
