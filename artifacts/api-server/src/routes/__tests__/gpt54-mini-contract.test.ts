import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routeSources = [
  path.resolve(__dirname, "..", "ai.ts"),
  path.resolve(__dirname, "..", "support-chat.ts"),
].map((filePath) => fs.readFileSync(filePath, "utf8"));

describe("GPT-5.4-mini request contract", () => {
  it("uses completion-token limits and no legacy sampling fields", () => {
    const migratedCalls = routeSources.flatMap((source) =>
      [...source.matchAll(/model:\s+["']gpt-5\.4-mini["'][\s\S]*?\n\s*\}\);/g)]
        .map((match) => match[0]),
    );

    expect(migratedCalls).toHaveLength(3);
    for (const call of migratedCalls) {
      expect(call).toContain("max_completion_tokens:");
      expect(call).not.toContain("max_tokens:");
      expect(call).not.toContain("temperature:");
    }
  });
});