import { describe, expect, it } from "vitest";
import { AI_TOOL_RULES, findToolRule } from "../catalogue";

describe("AI tool rules", () => {
  it("prices every paid AI endpoint", () => {
    expect(findToolRule("POST", "/photography/generate")?.cost).toBe(8);
    expect(findToolRule("POST", "/ai/chat/stream")?.tool).toBe("ai_chat");
    expect(findToolRule("POST", "/store/ai/improve-copy")?.tool).toBe("store_ai");
    expect(findToolRule("POST", "/bg-removal/remove")?.cost).toBe(2);
  });
  it("leaves free endpoints alone", () => {
    expect(findToolRule("GET", "/ai/sessions")).toBeNull();
    expect(findToolRule("GET", "/ai/credits")).toBeNull();
    expect(findToolRule("POST", "/onboarding-sample/generate")).toBeNull();
    expect(findToolRule("GET", "/photography/generate")).toBeNull();
  });
  it("only has positive integer costs", () => {
    for (const r of AI_TOOL_RULES) expect(Number.isInteger(r.cost) && r.cost > 0).toBe(true);
  });
});
