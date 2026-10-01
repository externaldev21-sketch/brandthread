import { describe, expect, it } from "vitest";
import { AI_TOOL_RULES, CREDIT_PACKS, findToolRule, packsForPlan } from "../catalogue";
import { createLowPriorityQueue } from "../lowPriority";

describe("AI tool rules", () => {
  it("prices generations at their real cost", () => {
    const cost = (path: string) => findToolRule("POST", path)?.cost;
    expect(cost("/bg-removal/remove")).toBe(2);
    expect(cost("/bg-removal/replace")).toBe(4);
    expect(cost("/photography/generate")).toBe(8);
    expect(cost("/photography/mockup-to-model")).toBe(8);
    expect(cost("/mockup/generate")).toBe(5);
    expect(cost("/logo/generate")).toBe(5);
    expect(cost("/ai-design/generate")).toBe(5);
    expect(cost("/ai-design/refine")).toBe(4);
    expect(cost("/campaign/generate")).toBe(10);
    expect(cost("/video/generate")).toBe(50);
  });

  it("makes text free on every plan", () => {
    for (const path of ["/ai/chat", "/ai/chat/stream", "/ai/brand-memory/rebuild", "/brandthread-agent/chat", "/store/ai/improve-copy", "/ai-helpers/caption", "/ai-helpers/product-description", "/ai-helpers/size-chart"]) {
      const rule = findToolRule("POST", path);
      expect(rule, path).toMatchObject({ kind: "text", cost: 0 });
    }
  });

  it("leaves other endpoints alone", () => {
    expect(findToolRule("GET", "/ai/sessions")).toBeNull();
    expect(findToolRule("GET", "/ai/credits")).toBeNull();
    expect(findToolRule("POST", "/onboarding-sample/generate")).toBeNull();
    expect(findToolRule("GET", "/photography/generate")).toBeNull();
  });

  it("only charges generation rules, with positive integer costs", () => {
    for (const r of AI_TOOL_RULES) {
      if (r.kind === "credits") expect(Number.isInteger(r.cost) && r.cost > 0).toBe(true);
      else expect(r.cost).toBe(0);
    }
  });
});

describe("credit packs", () => {
  it("offers three packs to Starter and Growth only", () => {
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
