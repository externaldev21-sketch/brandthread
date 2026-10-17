/**
 * AI Settings are persisted per account and enforced by the server:
 *  - GET/PUT /api/ai/settings round-trips through seller_settings (migration 270)
 *  - unknown keys / non-boolean values are never stored
 *  - "Enable AI assistant" off → /chat and /chat/stream answer 409 and the
 *    model is never called
 *  - a data source turned off is withheld from the model's snapshot
 *  - Brand Memory off → client-sent brand memory never reaches the model
 *  - "Dashboard suggestions" off → /suggestions returns []
 *  - suggestions never carry invented stats ("3× more", "~N lost sales")
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, productVariants, sellerSettings } from "@workspace/db";
import { eq } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `ai-settings-seller-${suffix}`;

const state = vi.hoisted(() => ({
  userId: "",
  captured: null as Array<{ role: string; content: string }> | null,
  calls: 0,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.userId;
    next();
  },
  requirePlan: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: async (args: any) => {
          state.calls += 1;
          state.captured = args.messages;
          return { choices: [{ message: { content: "ok" } }], usage: { total_tokens: 1 } };
        },
      },
    },
  },
}));

let server: Server;
let base = "";

beforeAll(async () => {
  state.userId = sellerId;
  const { default: aiRouter } = await import("../ai");
  const app = express();
  app.use(express.json());
  app.use("/api/ai", aiRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [product] = await db.insert(products).values({
    ownerId: sellerId, name: `Tee ${suffix}`, status: "active",
  }).returning({ id: products.id });
  await db.insert(productVariants).values({
    productId: product.id, sku: `ai-set-${suffix}`, priceCents: 2500, stock: 3, lowStockThreshold: 10,
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await db.delete(sellerSettings).where(eq(sellerSettings.ownerId, sellerId));
  await db.delete(products).where(eq(products.ownerId, sellerId));
});

beforeEach(() => {
  state.captured = null;
  state.calls = 0;
});

async function put(body: unknown) {
  return fetch(`${base}/api/ai/settings`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

async function chat(extra: Record<string, unknown> = {}) {
  return fetch(`${base}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "How is my store doing?" }], ...extra }),
  });
}

describe("AI settings persistence", () => {
  it("defaults to everything on before anything is saved", async () => {
    const res = await fetch(`${base}/api/ai/settings`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.settings.enabled).toBe(true);
    expect(body.settings.dataSources.customers).toBe(true);
  });

  it("saves known boolean keys and ignores anything else", async () => {
    const res = await put({ confirmSending: false, dataSources: { orders: false, bogus: false }, enabled: "no", extra: 1 });
    expect(res.status).toBe(200);
    const saved = ((await res.json()) as any).settings;
    expect(saved.confirmSending).toBe(false);
    expect(saved.dataSources.orders).toBe(false);
    expect(saved.enabled).toBe(true);
    expect(saved).not.toHaveProperty("extra");
    expect(saved.dataSources).not.toHaveProperty("bogus");

    const again = await (await fetch(`${base}/api/ai/settings`)).json() as any;
    expect(again.settings.confirmSending).toBe(false);
    expect(again.settings.dataSources.orders).toBe(false);
    await put({ confirmSending: true, dataSources: { orders: true } });
  });
});

describe("AI settings enforcement", () => {
  it("refuses chat with 409 and never calls the model when the assistant is off", async () => {
    await put({ enabled: false });
    const res = await chat();
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).code).toBe("AI_DISABLED");
    const stream = await fetch(`${base}/api/ai/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(stream.status).toBe(409);
    expect(state.calls).toBe(0);
    await put({ enabled: true });
  });

  it("withholds switched-off data sources from the model snapshot", async () => {
    await put({ dataSources: { products: false, inventory: false } });
    const res = await chat();
    expect(res.status).toBe(200);
    const system = state.captured?.[0]?.content ?? "";
    expect(system).toContain('"products":"excluded_by_seller_ai_settings"');
    expect(system).toContain('"inventory":"excluded_by_seller_ai_settings"');
    expect(system).not.toContain(`Tee ${suffix}`);
    expect(system).toContain("turned off these data sources in AI Settings: products, inventory");
    await put({ dataSources: { products: true, inventory: true } });
  });

  it("drops client brand memory when Brand Memory is off", async () => {
    const brandMemory = { brandVoice: `zany-voice-${suffix}` };
    await chat({ brandMemory });
    expect(state.captured?.[0]?.content).toContain(`zany-voice-${suffix}`);
    await put({ brandMemoryEnabled: false });
    await chat({ brandMemory });
    expect(state.captured?.[0]?.content).not.toContain(`zany-voice-${suffix}`);
    await put({ brandMemoryEnabled: true });
  });

  it("returns no suggestions when Dashboard suggestions are off, and no invented stats when on", async () => {
    const on = await (await fetch(`${base}/api/ai/suggestions`)).json() as any;
    expect(on.suggestions.length).toBeGreaterThan(0);
    for (const sug of on.suggestions) {
      const text = `${sug.reason} ${sug.expectedImpact}`;
      expect(text).not.toMatch(/\d\s*[×x]\s*more|lost sales|velocity|typically see/i);
    }
    await put({ suggestionsEnabled: false });
    const off = await (await fetch(`${base}/api/ai/suggestions`)).json() as any;
    expect(off.suggestions).toEqual([]);
    await put({ suggestionsEnabled: true });
  });
});
