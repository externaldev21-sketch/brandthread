import { describe, expect, it } from "vitest";
import { AI_TOOL_RULES, CREDIT_PACKS, creditToolPrices, findToolRule, packsForPlan, unitsFor } from "../catalogue";
import { creditsForTool } from "../costTable";
import { createLowPriorityQueue } from "../lowPriority";

describe("AI tool rules", () => {
  it("prices generations from the provider cost table", () => {
    const cost = (path: string) => findToolRule("POST", path)?.cost;
    expect(cost("/bg-removal/remove")).toBe(creditsForTool("bg_remove"));
    expect(cost("/bg-removal/replace")).toBe(creditsForTool("bg_replace"));
    expect(cost("/photography/generate")).toBe(creditsForTool("photoshoot"));
    expect(cost("/photography/mockup-to-model")).toBe(creditsForTool("model_photo"));
    expect(cost("/photography/outfit-swap")).toBe(creditsForTool("model_photo"));
    expect(cost("/photography/mockup-to-model/retry")).toBe(creditsForTool("model_photo"));
    expect(cost("/photography/outfit-swap/retry")).toBe(creditsForTool("model_photo"));
    expect(cost("/mockup/generate")).toBe(creditsForTool("mockup"));
    expect(cost("/logo/generate")).toBe(creditsForTool("logo"));
    expect(cost("/video/generate")).toBe(creditsForTool("video_gen"));
    // gpt-image high quality with a visual-QA retry is tens of cents a call, never 2-8 credits.
    expect(cost("/bg-removal/remove")).toBeGreaterThanOrEqual(40);
    expect(cost("/logo/generate")).toBeGreaterThanOrEqual(40);
  });

  it("charges Mockup to Model per reference and Outfit Swap per garment, within the route maximum", () => {
    const m2m = findToolRule("POST", "/photography/mockup-to-model")!;
    expect(unitsFor(m2m, { references: ["a", "b", "c"] })).toBe(3);
    expect(unitsFor(m2m, { references: Array(9).fill("a") })).toBe(5);
    expect(unitsFor(m2m, {})).toBe(1);
    const swap = findToolRule("POST", "/photography/outfit-swap")!;
    expect(unitsFor(swap, { garmentImages: ["a", "b"] })).toBe(2);
    expect(unitsFor(swap, { garmentImages: Array(9).fill("a") })).toBe(4);
    expect(unitsFor(findToolRule("POST", "/logo/generate")!, { references: ["a", "b"] })).toBe(1);
  });

  it("makes text free on every plan", () => {
    for (const path of ["/ai/chat", "/ai/chat/stream", "/ai/brand-memory/rebuild", "/brandthread-agent/chat", "/ai-helpers/caption", "/ai-helpers/product-description", "/ai-helpers/size-chart"]) {
      const rule = findToolRule("POST", path);
      expect(rule, path).toMatchObject({ kind: "text", cost: 0 });
    }
  });

  it("meters support chat, store AI and the onboarding sample", () => {
    for (const [path, tool] of [
      ["/support-chat/message", "support_chat"], ["/store/ai/generate", "store_ai"], ["/store/ai/from-logo", "store_ai"],
      ["/onboarding-sample/logo", "onboarding_sample"],
    ] as const) {
      const rule = findToolRule("POST", path);
      expect(rule, path).toMatchObject({ kind: "metered", tool });
      expect(rule!.cost, path).toBeGreaterThan(0);
      expect(rule!.dailyLimit!(), path).toBeGreaterThan(0);
    }
    expect(findToolRule("POST", "/onboarding-sample/logo")!.cost).toBe(creditsForTool("logo"));
  });

  it("matches trailing-slash, double-slash and case variants of every gated path", () => {
    for (const path of ["/logo/generate", "/photography/mockup-to-model", "/support-chat/message", "/onboarding-sample/logo", "/ai/chat"]) {
      const rule = findToolRule("POST", path);
      for (const variant of [`${path}/`, path.toUpperCase(), path.replace(/\//g, "//"), `${path}//`, `/${path.slice(1, 2).toUpperCase()}${path.slice(2)}`]) {
        expect(findToolRule("POST", variant), variant).toBe(rule);
      }
    }
  });

  it("leaves other endpoints alone", () => {
    expect(findToolRule("GET", "/ai/sessions")).toBeNull();
    expect(findToolRule("GET", "/ai/credits")).toBeNull();
    expect(findToolRule("POST", "/onboarding-sample/generate")).toBeNull();
    expect(findToolRule("GET", "/photography/generate")).toBeNull();
  });

  it("charges generation rules positive integer costs and never charges text", () => {
    for (const r of AI_TOOL_RULES) {
      if (r.kind === "text") expect(r.cost).toBe(0);
      else expect(Number.isInteger(r.cost) && r.cost > 0).toBe(true);
    }
  });

  it("lists each credit tool once for display", () => {
    const tools = creditToolPrices().map((t) => t.tool);
    expect(tools).toEqual([...new Set(tools)]);
    expect(tools).toContain("model_photo");
    expect(tools).not.toContain("support_chat");
  });
});

describe("credit packs", () => {
  it("offers three packs to Starter and Growth only (Pro unchanged)", () => {
    expect(CREDIT_PACKS.map((p) => p.credits)).toEqual([500, 1500, 5000]);
    expect(packsForPlan("starter")).toHaveLength(3);
    expect(packsForPlan("growth")).toHaveLength(3);
    expect(packsForPlan("pro")).toEqual([]);
    expect(packsForPlan("free")).toEqual([]);
  });
});

describe("low-priority queue", () => {
  it("limits concurrency and releases in FIFO order", async () => {
    const q = createLowPriorityQueue();
    const order: number[] = [];
    const a = await q.acquire({ max: 1, waitMs: 5_000 });
    const b = q.acquire({ max: 1, waitMs: 5_000 }).then((r) => { order.push(2); return r; });
    const c = q.acquire({ max: 1, waitMs: 5_000 }).then((r) => { order.push(3); return r; });
    expect(q.stats()).toEqual({ running: 1, waiting: 2 });
    a!();
    const rb = await b;
    expect(order).toEqual([2]);
    rb!();
    (await c)!();
    expect(order).toEqual([2, 3]);
    expect(q.stats()).toEqual({ running: 0, waiting: 0 });
  });

  it("runs a job anyway once the wait is over, so it still completes", async () => {
    const q = createLowPriorityQueue();
    await q.acquire({ max: 1, waitMs: 5_000 });
    const late = await q.acquire({ max: 1, waitMs: 20 });
    expect(late).toBeTypeOf("function");
  });

  it("drops a waiter whose client left", async () => {
    const q = createLowPriorityQueue();
    const first = await q.acquire({ max: 1, waitMs: 5_000 });
    let abort = () => {};
    const waiting = q.acquire({ max: 1, waitMs: 5_000, onAbort: (cb) => { abort = cb; } });
    abort();
    expect(await waiting).toBeNull();
    first!();
    expect(q.stats()).toEqual({ running: 0, waiting: 0 });
  });
});
