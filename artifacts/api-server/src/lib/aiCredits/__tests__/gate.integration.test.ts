/**
 * The route gate end to end: chat is never charged, generations are debited
 * (per reference for multi-output tools) and refunded on failure, 402 carries
 * balance + cost, metered tools (support chat, onboarding sample) are capped
 * per day and count toward the global cap, path variants cannot skip the gate,
 * and hidden limits answer generically.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { aiCreditAccounts, aiCreditLedger, aiProUsage, aiSpendDaily, db } from "@workspace/db";

vi.mock("@clerk/express", () => ({ getAuth: (req: any) => ({ userId: req.headers["x-test-user"] ?? null }) }));
vi.mock("../../nativeEntitlements", () => ({
  getEffectiveEntitlement: vi.fn(async (id: string) => {
    if (id.includes("-pro-")) return { planId: "pro", provider: "revenuecat", status: "active" };
    if (id.includes("-free-")) return { planId: "starter", provider: "none", status: "none" };
    if (id.includes("-trial-")) return { planId: "pro", provider: "stripe", status: "trialing" };
    return { planId: "starter", provider: "stripe", status: "active" };
  }),
}));

import { aiCreditsGate } from "../gate";
import { AI_FAILED_UNITS_LOCAL, PLAN_CREDIT_POLICY, findToolRule, trialAllowance } from "../catalogue";
import { currentDay, getAccount } from "../ledger";

const users: string[] = [];
const newUser = (tag: "starter" | "free" | "pro" | "trial") => { const id = `ai-credits-test-${tag}-${crypto.randomUUID()}`; users.push(id); return id; };
const STARTER = PLAN_CREDIT_POLICY.starter.monthlyAllowance;
const PHOTOSHOOT = findToolRule("POST", "/photography/generate")!.cost;
const MODEL_PHOTO = findToolRule("POST", "/photography/mockup-to-model")!.cost;

let server: Server;
let base = "";
let failNext = false;
let failedUnits = 0;
let handlerCalls = 0;

beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use(aiCreditsGate);
  // Case-insensitive, non-strict like the real API router.
  const router = express.Router({ caseSensitive: false, strict: false });
  router.post("/ai/chat", (_req, res) => res.json({ reply: "hi" }));
  router.post("/photography/generate", (_req, res) => {
    handlerCalls += 1;
    if (failNext) { failNext = false; res.status(500).json({ error: "provider down" }); return; }
    res.json({ ok: true });
  });
  router.post("/photography/mockup-to-model", (_req, res) => {
    res.locals[AI_FAILED_UNITS_LOCAL] = failedUnits;
    res.json({ ok: true });
  });
  router.post("/support-chat/message", (_req, res) => res.json({ content: "hello" }));
  router.post("/onboarding-sample/logo", (_req, res) => {
    if (failNext) { failNext = false; res.status(502).json({ error: "provider down" }); return; }
    res.json({ b64_json: "x" });
  });
  app.use(router);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  delete process.env.AI_TEXT_DAILY_LIMIT_PER_USER;
  delete process.env.AI_SUPPORT_CHAT_DAILY_LIMIT_PER_USER;
  delete process.env.AI_GLOBAL_DAILY_CREDIT_CAP;
  failNext = false;
  failedUnits = 0;
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

const post = (path: string, user: string, body: unknown = {}) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-test-user": user }, body: JSON.stringify(body) });
const globalSpent = async () => {
  const [row] = await db.select().from(aiSpendDaily).where(and(eq(aiSpendDaily.clerkUserId, "*"), eq(aiSpendDaily.day, currentDay())));
  return row?.spent ?? 0;
};

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
    expect(r.headers.get("x-ai-credits-charged")).toBe(String(PHOTOSHOOT));
    expect((await getAccount(u)).balance).toBe(STARTER - PHOTOSHOOT);
  });

  it.each(["/photography/generate/", "/Photography/Generate", "/PHOTOGRAPHY/GENERATE/"])(
    "charges the path variant %s like the canonical path", async (path) => {
      const u = newUser("starter");
      const r = await post(path, u);
      expect(r.status).toBe(200);
      expect(r.headers.get("x-ai-credits-charged")).toBe(String(PHOTOSHOOT));
      expect((await getAccount(u)).balance).toBe(STARTER - PHOTOSHOOT);
    },
  );

  it.each(["/photography//generate", "/PHOTOGRAPHY/GENERATE//"])(
    "never runs the handler for free on %s", async (path) => {
      const u = newUser("starter");
      const calls = handlerCalls;
      const r = await post(path, u);
      // The gate charges first; if the router then serves it, it was paid for,
      // and if the router does not (404), the charge is given back.
      expect(r.headers.get("x-ai-credits-charged")).toBe(String(PHOTOSHOOT));
      if (r.status === 200) {
        expect((await getAccount(u)).balance).toBe(STARTER - PHOTOSHOOT);
      } else {
        expect(handlerCalls).toBe(calls);
        await vi.waitFor(async () => expect((await getAccount(u)).balance).toBe(STARTER));
      }
    },
  );

  it("refunds when the handler fails", async () => {
    const u = newUser("starter");
    failNext = true;
    expect((await post("/photography/generate", u)).status).toBe(500);
    await vi.waitFor(async () => expect((await getAccount(u)).balance).toBe(STARTER));
  });

  it("answers 402 with balance and cost when credits run out, and for accounts without a plan", async () => {
    const free = newUser("free");
    const r = await post("/photography/generate", free);
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ code: "insufficient_credits", cost: PHOTOSHOOT, balance: 0, toolKey: "photoshoot" });
    const u = newUser("starter");
    await db.insert(aiCreditAccounts).values({ clerkUserId: u, monthlyBalance: 5, monthlyAllowance: STARTER, monthlyPeriod: currentDay().slice(0, 7) });
    const low = await post("/photography/generate", u);
    expect(low.status).toBe(402);
    expect(await low.json()).toMatchObject({ balance: 5, cost: PHOTOSHOOT });
  });

  it("charges Mockup to Model per reference and gives back the failed ones", async () => {
    const u = newUser("pro");
    const before = (await getAccount(u)).balance;
    const r = await post("/photography/mockup-to-model", u, { references: ["a", "b", "c"] });
    expect(r.status).toBe(200);
    expect(r.headers.get("x-ai-credits-charged")).toBe(String(3 * MODEL_PHOTO));
    expect((await getAccount(u)).balance).toBe(before - 3 * MODEL_PHOTO);

    failedUnits = 2;
    await post("/photography/mockup-to-model", u, { references: ["a", "b", "c"] });
    await vi.waitFor(async () => expect((await getAccount(u)).balance).toBe(before - 4 * MODEL_PHOTO));
  });

  it("caps the billed references at the route's maximum", async () => {
    const u = newUser("pro");
    const r = await post("/photography/mockup-to-model", u, { references: Array(50).fill("a") });
    expect(r.headers.get("x-ai-credits-charged")).toBe(String(5 * MODEL_PHOTO));
  });

  it("gives Pro a finite balance with credit headers", async () => {
    const u = newUser("pro");
    const r = await post("/photography/generate", u);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-ai-credits-charged")).toBe(String(PHOTOSHOOT));
    expect((await getAccount(u)).balance).toBe(PLAN_CREDIT_POLICY.pro.monthlyAllowance - PHOTOSHOOT);
  });

  it("gives a trial only the reduced allowance", async () => {
    const u = newUser("trial");
    expect((await getAccount(u)).balance).toBe(trialAllowance("pro"));
  });
});

describe("metered tools", () => {
  it("caps support chat per user per day, never charges credits, and counts toward the global cap", async () => {
    process.env.AI_SUPPORT_CHAT_DAILY_LIMIT_PER_USER = "2";
    const buyer = newUser("free");
    const cost = findToolRule("POST", "/support-chat/message")!.cost;
    expect((await post("/support-chat/message", buyer)).status).toBe(200);
    expect((await post("/Support-Chat/Message/", buyer)).status).toBe(200);
    const third = await post("/support-chat/message", buyer);
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({ error: "Too many requests, try again later" });
    expect(await globalSpent()).toBe(2 * cost);
    expect((await getAccount(buyer)).balance).toBe(0);
  });

  it("stops support chat at the global emergency cap", async () => {
    const cost = findToolRule("POST", "/support-chat/message")!.cost;
    process.env.AI_GLOBAL_DAILY_CREDIT_CAP = String(cost);
    const u = newUser("starter");
    expect((await post("/support-chat/message", u)).status).toBe(200);
    expect((await post("/support-chat/message", u)).status).toBe(503);
  });

  it("allows one onboarding sample a day and gives a failed attempt back", async () => {
    const u = newUser("free");
    failNext = true;
    expect((await post("/onboarding-sample/logo", u)).status).toBe(502);
    await vi.waitFor(async () => expect(await globalSpent()).toBe(0));
    expect((await post("/onboarding-sample/logo/", u)).status).toBe(200);
    expect((await post("/onboarding-sample/logo", u)).status).toBe(429);
  });
});
