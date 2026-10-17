import { describe, expect, it } from "vitest";
import {
  ASSISTANT_LINKS, BUYER_APP_GUIDE, buildInboxAssistantPrompt, parseAssistantReply,
} from "../brandthreadAssistant";

describe("parseAssistantReply", () => {
  it("strips the token and returns the allowlisted link", () => {
    expect(parseAssistantReply("Add your first piece. [[open:add_product]]", "seller")).toEqual({
      text: "Add your first piece.",
      link: { id: "add_product", label: "Add a product", route: "/add-product" },
    });
  });

  it("ignores unknown ids and ids for the other role", () => {
    expect(parseAssistantReply("Try this [[open:admin_panel]]", "buyer")).toEqual({ text: "Try this" });
    expect(parseAssistantReply("Go live [[open:go_live]]", "buyer")).toEqual({ text: "Go live" });
  });

  it("keeps only the first valid link and removes /ai-brain action blocks", () => {
    const raw = "Do both. [[open:discover]] [[open:saved]]\n```json:action\n{\"type\":\"edit\"}\n```";
    expect(parseAssistantReply(raw, "buyer")).toEqual({
      text: "Do both.",
      link: { id: "discover", label: "Open Discover", route: "/(buyer)/discover" },
    });
  });
});

describe("buildInboxAssistantPrompt", () => {
  it("gives buyers the app guide and only buyer links", async () => {
    const prompt = await buildInboxAssistantPrompt("u", "buyer");
    expect(prompt).toContain(BUYER_APP_GUIDE);
    expect(prompt).toContain("[[open:discover]]");
    expect(prompt).not.toContain("[[open:store_builder]]");
  });

  it("gives sellers the Brandthread AI (/ai-brain) prompt plus seller links", async () => {
    const prompt = await buildInboxAssistantPrompt("u", "seller", { sellerPrompt: async () => "AI BRAIN PROMPT" });
    expect(prompt.startsWith("AI BRAIN PROMPT")).toBe(true);
    expect(prompt).toContain("[[open:store_builder]]");
    expect(prompt).toContain("[[open:brandthread_ai]]");
    expect(prompt).not.toContain("[[open:discover]]");
  });

  it("falls back to the feature reference when the seller snapshot fails", async () => {
    const prompt = await buildInboxAssistantPrompt("u", "seller", { sellerPrompt: async () => { throw new Error("db down"); } });
    expect(prompt).toContain("Account data is unavailable");
  });

  it("only links to routes under artifacts/mobile/app", async () => {
    const { existsSync } = await import("node:fs");
    const path = await import("node:path");
    const appDir = path.resolve(__dirname, "../../../../mobile/app");
    for (const link of Object.values(ASSISTANT_LINKS)) {
      const route = link.route.split("?")[0].replace(/^\//, "");
      expect(existsSync(path.join(appDir, `${route}.tsx`)), link.route).toBe(true);
    }
  });
});
