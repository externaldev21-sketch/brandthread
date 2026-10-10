import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The presets router was imported but never mounted, so every
// /api/package-presets call 404'd. Importing the full API router needs the
// whole app's env, so check the mount in the source instead.
describe("package presets route", () => {
  it("is mounted under /api/package-presets", () => {
    const src = readFileSync(path.join(__dirname, "..", "index.ts"), "utf8");
    expect(src).toMatch(/router\.use\(\s*"\/package-presets",\s*packagePresetsRouter\s*\)/);
  });
});
