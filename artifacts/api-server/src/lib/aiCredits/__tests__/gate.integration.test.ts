/**
 * The route gate end to end: chat is never charged, generations are debited
 * and refunded on failure, 402 carries balance + cost, Pro is never blocked and
 * uses the slow queue past the fair-use line, hidden limits answer generically.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray, like, sql } from "drizzle-orm";
import { aiCreditAccounts, aiCreditLedger, aiProUsage, aiSpendDaily, db } from "@workspace/db";

vi.mock("@clerk/express", () => ({ getAuth: (req: any) => ({ userId: req.headers["x-test-user"] ?? null }) }));
vi.mock("../../nativeEntitlements", () => ({
  getEffectiveEntitlement: vi.fn(async (id: string) => {
    if (id.includes("-pro-")) return { planId: "pro", provider: "revenuecat" };
    if (id.includes("-free-")) return { planId: "starter", provider: "none" };
    return { planId: "starter", provider: "stripe" };
  }),
}));

import { aiCreditsGate } from "../gate";
import { currentDay, getAccount } from "../ledger";

const users: string[] = [];
const newUser = (tag: "starter" | "free" | "pro") => { const id = `ai-credits-test-${tag}-${crypto.randomUUID()}`; users.push(id); return id; };

let server: Server;
let base = "";
let failNext = false;
const running = { now: 0, max: 0 };
let hold: Promise<void> = Promise.resolve();

beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use(aiCreditsGate);
  app.post("/ai/chat", (_req, res) => res.json({ reply: "hi" }));
  app.post("/photography/generate", (_req, res) => {
    if (failNext) { failNext = false; res.status(500).json({ error: "provider down" }); return; }
    res.json({ ok: true });
  });
  app.post("/video/generate", async (_req, res) => {
    running.now += 1; running.max = Math.max(running.max, running.now);
    await hold;
    running.now -= 1;
    res.json({ ok: true });
  });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  delete process.env.AI_TEXT_DAILY_LIMIT_PER_USER;
  delete process.env.AI_PRO_FAIR_USE_CREDITS;
  delete process.env.AI_LOW_PRIORITY_CONCURRENCY;
  if (users.length) {
    await db.delete(aiCreditLedger).where(inArray(aiCreditLedger.clerkUserId, users));
    await db.delete(aiCreditAccounts).where(inArray(aiCreditAccounts.clerkUserId, users));
    await db.delete(aiProUsage).where(inArray(aiProUsage.clerkUserId, users));
    await db.delete(aiSpendDaily).where(like(aiSpendDaily.clerkUserId, "%ai-credits-test-%"));
    users.length = 0;
  }
  await db.execute(sql`DELETE FROM ai_spend_daily WHERE clerk_user_id = '*'`);
});
afterAll(async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); });

const post = (path: string, user: string) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-test-user": user }, body: "{}" });

describe("chat", () => {
  it("is never charged on any plan", async () => {
    for (const tag of ["starter", "free", "pro"] as const) {
      const u = newUser(tag);
      expect((await post("/ai/chat", u)).status).toBe(200);
      const ledger = await db.select().from(aiCreditLedger).where(eq(aiCreditLedger.clerkUserId, u));
      expect(ledger.filter((r) => r.kind === "debit" || r.kind === "usage")).toHaveLength(0);
    }
  });

  it("applies a silent ceiling with a generic message that never mentions credits", async () => {
    process.env.AI_TEXT_DAILY_LIMIT_PER_USER = "2";
    const u = newUser("starter");
    await post("/ai/chat", u); await post("/ai/chat", u);
    const r = await post("/ai/chat", u);
    expect(r.status).toBe(429);
    const body = await r.json();
    expect(body).toEqual({ error: "Too many requests, try again later" });
    expect(JSON.stringify(body)).not.toMatch(/credit/i);
  });

  it("passes unauthenticated requests through untouched", async () => {
    const r = await fetch(`${base}/ai/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(200);
  });
});

describe("generations", () => {
  it("debits the tool cost and exposes it in headers", async () => {
    const u = newUser("starter");
    const r = await post("/photography/generate", u);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-ai-credits-charged")).toBe("8");
    expect((await getAccount(u)).balance).toBe(992);
  });

  it("refunds when the handler fails", async () => {
    const u = newUser("starter");
    failNext = true;
    expect((await post("/photography/generate", u)).status).toBe(500);
    await vi.waitFor(async () => expect((await getAccount(u)).balance).toBe(1000));
  });

  it("answers 402 with balance and cost when credits run out, and for accounts without a plan", async () => {
    const free = newUser("free");
    const r = await post("/photography/generate", free);
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ code: "insufficient_credits", cost: 8, balance: 0, toolKey: "photoshoot" });
    const u = newUser("starter");
    await db.insert(aiCreditAccounts).values({ clerkUserId: u, monthlyBalance: 5, monthlyAllowance: 1000, monthlyPeriod: currentDay().slice(0, 7) });
    const low = await post("/photography/generate", u);
    expect(low.status).toBe(402);
    expect(await low.json()).toMatchObject({ balance: 5, cost: 8 });
  });
});

describe("Pro", () => {
  it("is never blocked and sees no balance headers", async () => {
    const u = newUser("pro");
    const r = await post("/photography/generate", u);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-ai-credits-charged")).toBeNull();
  });

  it("queues jobs past the fair-use line instead of failing them", async () => {
    process.env.AI_PRO_FAIR_USE_CREDITS = "50";
    process.env.AI_LOW_PRIORITY_CONCURRENCY = "1";
    const u = newUser("pro");
    await db.insert(aiProUsage).values({ clerkUserId: u, period: currentDay().slice(0, 7), creditsUsed: 50, day: currentDay(), generationsToday: 0 });
    let release!: () => void;
    hold = new Promise((r) => { release = r; });
    running.now = 0; running.max = 0;
    // The user is already past the fair-use line: one job runs, the rest wait their turn.
    const first = post("/video/generate", u);
    await vi.waitFor(() => expect(running.now).toBe(1));
    const second = post("/video/generate", u);
    const third = post("/video/generate", u);
    await new Promise((r) => setTimeout(r, 300));
    expect(running.now).toBe(1);
    release();
    hold = Promise.resolve();
    const statuses = (await Promise.all([first, second, third])).map((r) => r.status);
    expect(statuses).toEqual([200, 200, 200]);
    expect(running.max).toBe(1);
  });
});
