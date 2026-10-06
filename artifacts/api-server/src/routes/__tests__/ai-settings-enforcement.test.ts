/**
 * ai-settings-enforcement.test.ts
 *
 * QA-0041: AI Settings must be enforced server-side, not only stored on the
 * device. Mounts only the ai router with every boundary mocked (no real DB):
 *
 *  - requireAuth        → fixed authenticated seller
 *  - aiSettingsStore    → in-memory per-account settings row
 *  - sellerSnapshot     → snapshot with a distinctive marker per section
 *  - @workspace/db      → chain stub; records which suggestion queries ran
 *  - openai             → captures the system prompt sent to the model
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

const state = vi.hoisted(() => ({
  stored: null as Record<string, unknown> | null,
  saved: [] as Array<{ userId: string; raw: unknown }>,
  capturedSystem: null as string | null,
  openaiCalls: 0,
  modelReply: "Reply",
  dbSelects: 0,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "user_seller";
    next();
  },
}));

vi.mock("../../lib/aiSettingsStore", async () => {
  const { normalizeAiSettings } = await vi.importActual<typeof import("../../lib/aiSettings")>("../../lib/aiSettings");
  return {
    loadAiSettings: async () => ({ settings: normalizeAiSettings(state.stored), updatedAt: state.stored ? "2026-01-01T00:00:00.000Z" : null }),
    loadAiSettingsForEnforcement: async () => normalizeAiSettings(state.stored),
    saveAiSettings: async (userId: string, raw: unknown) => {
      state.saved.push({ userId, raw });
      state.stored = normalizeAiSettings(raw) as unknown as Record<string, unknown>;
      return { settings: normalizeAiSettings(raw), updatedAt: "2026-01-02T00:00:00.000Z" };
    },
  };
});

vi.mock("../../lib/sellerSnapshot", () => ({
  buildSellerSnapshot: async () => ({
    snapshotAt: "2026-01-01T00:00:00.000Z",
    seller: { brandName: "MARK_SELLER" },
    storefront: { title: "MARK_STOREFRONT" },
    products: { recent: [{ name: "MARK_PRODUCTS" }] },
    inventory: { lowStockItems: [{ productName: "MARK_INVENTORY" }] },
    orders: { recentOrders: [{ orderNumber: "MARK_ORDERS" }] },
    revenue: { note: "MARK_REVENUE" },
    content: { recentPublished: [{ caption: "MARK_CONTENT" }] },
    customers: { topSpendBracket: "MARK_CUSTOMERS" },
    conversations: { recentConversations: [{ type: "MARK_CONVERSATIONS" }] },
    boosts: { note: "MARK_BOOSTS" },
    manufacturerOrders: { recentRequests: [{ productName: "MARK_MANUFACTURERS" }] },
    discountCodes: { note: "MARK_DISCOUNTS" },
    shipping: { note: "MARK_SHIPPING" },
  }),
}));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (...args: unknown[]) => args,
    and: (...args: unknown[]) => args,
    desc: (c: unknown) => c,
    asc: (c: unknown) => c,
    inArray: (...args: unknown[]) => args,
    sql: Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }), { raw: (s: string) => s }),
  };
});

vi.mock("@workspace/db", () => {
  const chain = (): any => {
    const c: any = {
      from: () => c, where: () => c, innerJoin: () => c, leftJoin: () => c,
      groupBy: () => c, orderBy: () => c,
      limit: () => Promise.resolve([]),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve([]).then(res, rej),
    };
    return c;
  };
  const table = () => new Proxy({}, { get: (_t, k) => String(k) });
  return {
    db: { select: () => { state.dbSelects += 1; return chain(); } },
    products: table(), productVariants: table(), orders: table(), posts: table(), storefronts: table(),
  };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: async (opts: { messages: Array<{ role: string; content: string }>; stream?: boolean }) => {
          state.openaiCalls += 1;
          state.capturedSystem = opts.messages.find(m => m.role === "system")?.content
            ?? opts.messages[0]?.content ?? null;
          if (opts.stream) {
            const reply = state.modelReply;
            return { [Symbol.asyncIterator]: async function* () { yield { choices: [{ delta: { content: reply } }] }; } };
          }
          return { choices: [{ message: { content: state.modelReply } }], usage: { total_tokens: 1 } };
        },
      },
    },
  },
}));

vi.mock("@clerk/express", () => ({ clerkClient: { sessions: { getSessionList: async () => ({ data: [] }) } } }));

import aiRouter from "../ai";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/ai", aiRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  state.stored = null;
  state.saved = [];
  state.capturedSystem = null;
  state.openaiCalls = 0;
  state.modelReply = "Reply";
  state.dbSelects = 0;
});

const userMsg = [{ role: "user", content: "How is my business doing?" }];

function post(path: string, body: unknown) {
  return fetch(`${base}/api/ai${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/PUT /api/ai/settings", () => {
  it("returns defaults when the account has no stored row", async () => {
    const res = await fetch(`${base}/api/ai/settings`);
    expect(res.status).toBe(200);
    const body = await res.json() as { settings: { enabled: boolean; dataSources: { customers: boolean } }; updatedAt: string | null };
    expect(body.settings.enabled).toBe(true);
    expect(body.settings.dataSources.customers).toBe(true);
    expect(body.updatedAt).toBeNull();
  });

  it("persists the settings for the authenticated account", async () => {
    const res = await fetch(`${base}/api/ai/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { enabled: true, dataSources: { customers: false } } }),
    });
    expect(res.status).toBe(200);
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0].userId).toBe("user_seller");
    const body = await res.json() as { settings: { dataSources: { customers: boolean; orders: boolean } } };
    expect(body.settings.dataSources.customers).toBe(false);
    expect(body.settings.dataSources.orders).toBe(true);
  });

  it("rejects a PUT without a settings object", async () => {
    const res = await fetch(`${base}/api/ai/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: "off" }),
    });
    expect(res.status).toBe(400);
    expect(state.saved).toHaveLength(0);
  });
});

describe("Enable AI assistant", () => {
  it("refuses assistant chat when the account has the assistant turned off", async () => {
    state.stored = { enabled: false };
    const res = await post("/chat", { messages: userMsg, context: { screen: "home" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "AI_DISABLED" });
    expect(state.openaiCalls).toBe(0);
  });

  it("refuses the streaming endpoint too", async () => {
    state.stored = { enabled: false };
    const res = await post("/chat/stream", { messages: userMsg, context: { screen: "home" } });
    expect(res.status).toBe(403);
    expect(state.openaiCalls).toBe(0);
  });

  it("refuses when the client reports it off even if the account row has not synced yet", async () => {
    const res = await post("/chat", { messages: userMsg, context: { screen: "home" }, aiSettings: { enabled: false } });
    expect(res.status).toBe(403);
  });

  it("a client cannot turn the assistant back on by sending enabled: true", async () => {
    state.stored = { enabled: false };
    const res = await post("/chat", { messages: userMsg, context: { screen: "home" }, aiSettings: { enabled: true } });
    expect(res.status).toBe(403);
  });

  it("refuses brand memory rebuild", async () => {
    state.stored = { enabled: false };
    const res = await post("/brand-memory/rebuild", {});
    expect(res.status).toBe(403);
    expect(state.openaiCalls).toBe(0);
  });
});

describe("Data sources", () => {
  it("sends every section when all sources are on", async () => {
    const res = await post("/chat", { messages: userMsg, context: { screen: "home" } });
    expect(res.status).toBe(200);
    for (const m of ["MARK_CUSTOMERS", "MARK_CONVERSATIONS", "MARK_ORDERS", "MARK_PRODUCTS", "MARK_REVENUE"]) {
      expect(state.capturedSystem).toContain(m);
    }
  });

  it("excludes customer data from the model when Customers is off (stored setting)", async () => {
    state.stored = { dataSources: { customers: false } };
    const res = await post("/chat", { messages: userMsg, context: { screen: "order_detail", orderNumber: "A-1", status: "paid", customerName: "Jane Buyer" } });
    expect(res.status).toBe(200);
    const sys = state.capturedSystem ?? "";
    expect(sys).not.toContain("MARK_CUSTOMERS");
    expect(sys).not.toContain("MARK_CONVERSATIONS");
    expect(sys).not.toContain("Jane Buyer");
    expect(sys).toContain("MARK_ORDERS");
    expect(sys).toMatch(/turned off AI access to: customers/);
  });

  it("excludes a source the client turned off on the streaming endpoint", async () => {
    const res = await post("/chat/stream", {
      messages: userMsg,
      context: { screen: "home" },
      aiSettings: { dataSources: { orders: false, marketing: false } },
    });
    await res.text();
    const sys = state.capturedSystem ?? "";
    expect(sys).not.toContain("MARK_ORDERS");
    expect(sys).not.toContain("MARK_REVENUE");
    expect(sys).not.toContain("MARK_BOOSTS");
    expect(sys).not.toContain("MARK_DISCOUNTS");
    expect(sys).toContain("MARK_PRODUCTS");
  });

  it("applies data sources to one-off /chat calls without a screen context", async () => {
    state.stored = { enabled: false, dataSources: { products: false } };
    const res = await post("/chat", { messages: userMsg });
    expect(res.status).toBe(200);
    expect(state.capturedSystem).not.toContain("MARK_PRODUCTS");
  });
});

describe("Brand Memory", () => {
  it("is sent to the model when on", async () => {
    await post("/chat", { messages: userMsg, context: { screen: "home" }, brandMemory: { brandVoice: "MARK_VOICE" } });
    expect(state.capturedSystem).toContain("MARK_VOICE");
  });

  it("is dropped server-side when off, even if the client sends it", async () => {
    state.stored = { brandMemoryEnabled: false };
    await post("/chat", { messages: userMsg, context: { screen: "home" }, brandMemory: { brandVoice: "MARK_VOICE" } });
    expect(state.capturedSystem).not.toContain("MARK_VOICE");
  });
});

describe("Confirm-before-action", () => {
  const card = '{"type":"edit","title":"Update price","description":"Lower the price","requiresConfirmation":false,"isDestructive":false,"canUndo":true,"payload":{}}';

  it("marks a data-changing action as requiring confirmation when the toggle is on", async () => {
    state.modelReply = `Here you go.\n\`\`\`json:action\n${card}\n\`\`\``;
    const res = await post("/chat", { messages: userMsg, context: { screen: "home" } });
    const body = await res.json() as { actionCard?: { requiresConfirmation: boolean } };
    expect(body.actionCard?.requiresConfirmation).toBe(true);
  });

  it("clears the requirement when the seller turned that confirmation off", async () => {
    state.stored = { confirmSensitiveActions: false };
    state.modelReply = `Here you go.\n\`\`\`json:action\n${card}\n\`\`\``;
    const res = await post("/chat", { messages: userMsg, context: { screen: "home" } });
    const body = await res.json() as { actionCard?: { requiresConfirmation: boolean } };
    expect(body.actionCard?.requiresConfirmation).toBe(false);
  });
});

describe("Dashboard suggestions", () => {
  it("returns nothing and runs no queries when suggestions are off", async () => {
    state.stored = { suggestionsEnabled: false };
    const res = await fetch(`${base}/api/ai/suggestions`);
    expect(await res.json()).toEqual({ suggestions: [] });
    expect(state.dbSelects).toBe(0);
  });

  it("returns nothing when the assistant is off", async () => {
    state.stored = { enabled: false };
    const res = await fetch(`${base}/api/ai/suggestions`);
    expect(await res.json()).toEqual({ suggestions: [] });
    expect(state.dbSelects).toBe(0);
  });

  it("skips categories whose data source is off", async () => {
    state.stored = { dataSources: { inventory: false, orders: false } };
    const res = await fetch(`${base}/api/ai/suggestions`);
    const body = await res.json() as { suggestions: Array<{ category: string }> };
    // Only the content query ran (posts); with no posts it yields the
    // "start posting" content suggestion and nothing from inventory/orders.
    expect(state.dbSelects).toBe(1);
    expect(body.suggestions.every((s) => s.category === "content")).toBe(true);
  });
});
