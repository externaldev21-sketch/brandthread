import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routeSources = [
  path.resolve(__dirname, "..", "ai.ts"),
  path.resolve(__dirname, "..", "support-chat.ts"),
].map((filePath) => fs.readFileSync(filePath, "utf8"));

describe("GPT-5.4-mini request contract", () => {
  it("uses completion-token limits and no legacy sampling fields", () => {
    // Match both patterns:
    //   model: "gpt-5.4-mini"           (literal in the call)
    //   model: CHAT_MODEL               (constant reference in the call)
    // We verify each openai.create() call block individually.
    const migratedCalls = routeSources.flatMap((source) =>
      [
        // Pattern 1: literal model name in the create call
        ...source.matchAll(/model:\s+["']gpt-5\.4-mini["'][\s\S]*?\n\s*\}\);/g),
        // Pattern 2: named constant reference in the create call
        ...source.matchAll(/model:\s+CHAT_MODEL[\s\S]*?\n\s*\}\);/g),
      ].map((match) => match[0]),
    );

    // ai.ts: 3 create() calls using CHAT_MODEL (chat, chat/stream, brand-memory/rebuild);
    // support-chat.ts: 1 literal
    expect(migratedCalls).toHaveLength(4);
    for (const call of migratedCalls) {
      expect(call).toContain("max_completion_tokens:");
      expect(call).not.toContain("max_tokens:");
      expect(call).not.toContain("temperature:");
    }
  });

  it("ai.ts constant resolves to gpt-5.4-mini and is not a legacy model", () => {
    const aiSource = routeSources[0];
    // The CHAT_MODEL constant must be defined and set to a current model
    expect(aiSource).toMatch(/CHAT_MODEL\s*=\s*["']gpt-5\.4-mini["']/);
    // Must not reference legacy gpt-4o-* models
    expect(aiSource).not.toContain("gpt-4o");
    expect(aiSource).not.toContain("gpt-4o-mini");
  });
});
