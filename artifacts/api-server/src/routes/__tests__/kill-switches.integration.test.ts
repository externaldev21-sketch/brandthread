/**
 * Kill switches: which requests each switch guards, pausing / resuming from the
 * admin API (audited), and fail-open behaviour. Real DB; the guarded feature
 * routes are stand-ins so only the gate is under test.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { and, eq, like } from "drizzle-orm";
import { adminAuditLog, db, pool, users } from "@workspace/db";

vi.hoisted(() => {
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-key";
});
vi.mock("../../middlewares/requireAuth", async (orig) => ({
  ...(await orig<typeof import("../../middlewares/requireAuth")>()),
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
}));

import adminRouter from "../admin";
import { KILL_SWITCH_KEYS, killSwitchGate, killSwitchStates, resetKillSwitchCache, switchFor } from "../../lib/killSwitches";

const P = `ks${process.pid}`;
const ADMIN = `${P}-admin`, SELLER = `${P}-seller`;
let server: Server;
let base = "";
let original: { key: string; enabled: boolean }[] = [];

const call = (user: string | null, path: string, init: RequestInit = {}) =>
  fetch(`${base}/api${path}`, { ...init, headers: { "content-type": "application/json", ...(user ? { "x-test-acting-as": user } : {}) } });
const post = (user: string | null, path: string, body: unknown = {}) => call(user, path, { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  original = (await pool.query("SELECT key, enabled FROM feature_flags WHERE key = ANY($1)", [KILL_SWITCH_KEYS])).rows;
  await db.insert(users).values([
    { clerkId: ADMIN, email: `${ADMIN}@example.test`, name: "Admin", role: "admin" },
    { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Seller", accountType: "seller" },
  ]);
  const api = express.Router();
  api.use(killSwitchGate);
  api.use("/admin", adminRouter);
  // Stand-ins for the guarded feature routes.
  api.all(/.*/, (_req, res) => { res.json({ ok: true }); });
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error() {}, warn() {}, info() {} }; next(); });
  app.use("/api", api);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const key of KILL_SWITCH_KEYS) {
    const before = original.find((r) => r.key === key);
    if (before) await pool.query("UPDATE feature_flags SET enabled = $2 WHERE key = $1", [key, before.enabled]);
    else await pool.query("DELETE FROM feature_flags WHERE key = $1", [key]);
  }
  resetKillSwitchCache();
  await db.delete(users).where(like(users.clerkId, `${P}-%`));
});

describe("switchFor", () => {
  it("guards only the entry points that start something", () => {
    expect(switchFor("POST", "/live/start")).toBe("liveEnabled");
    expect(switchFor("POST", "/live/abc-123/join")).toBe("liveEnabled");
    expect(switchFor("POST", "/live-tips/send")).toBe("liveEnabled");
    expect(switchFor("POST", "/live/abc-123/end")).toBeNull();
    expect(switchFor("POST", "/live/abc-123/leave")).toBeNull();
    expect(switchFor("GET", "/live/abc-123")).toBeNull();

    expect(switchFor("POST", "/buyer/checkout/session")).toBe("paymentsEnabled");
    expect(switchFor("POST", "/buyer/checkout/payment-intent")).toBe("paymentsEnabled");
    expect(switchFor("POST", "/guest/checkout/session")).toBe("paymentsEnabled");
    expect(switchFor("POST", "/gift-cards/purchase")).toBe("paymentsEnabled");
    expect(switchFor("POST", "/buyer/checkout/payment-intent/pi_1/cancel")).toBeNull();
    expect(switchFor("POST", "/webhooks/stripe")).toBeNull();
    expect(switchFor("POST", "/orders/123/refund")).toBeNull();

    expect(switchFor("POST", "/ai/chat")).toBe("aiEnabled");
    expect(switchFor("POST", "/photography/generate")).toBe("aiEnabled");
    expect(switchFor("POST", "/store/ai/generate")).toBe("aiEnabled");
    expect(switchFor("POST", "/ai-helpers/caption")).toBe("aiEnabled");
    expect(switchFor("POST", "/ai/credits/purchase")).toBeNull();
    expect(switchFor("POST", "/aid/thing")).toBeNull();
    expect(switchFor("GET", "/ai/history")).toBeNull();
  });
});

describe("pause and resume", () => {
  it("is admin only", async () => {
    expect((await call(null, "/admin/kill-switches")).status).toBe(401);
    expect((await call(SELLER, "/admin/kill-switches")).status).toBe(403);
    expect((await post(SELLER, "/admin/kill-switches/liveEnabled", { enabled: false, reason: "x" })).status).toBe(403);
  });

  it("lists all three switches, on by default", async () => {
    const body: any = await (await call(ADMIN, "/admin/kill-switches")).json();
    expect(body.switches.map((s: any) => s.key)).toEqual(["liveEnabled", "paymentsEnabled", "aiEnabled"]);
    expect(body.switches.every((s: any) => s.enabled)).toBe(true);
  });

  it("needs a reason to pause and rejects unknown switches", async () => {
    expect((await post(ADMIN, "/admin/kill-switches/liveEnabled", { enabled: false })).status).toBe(400);
    expect((await post(ADMIN, "/admin/kill-switches/everything", { enabled: false, reason: "x" })).status).toBe(404);
  });

  it("pausing payments blocks new checkouts only, with a clear 503, and is audited", async () => {
    const res = await post(ADMIN, "/admin/kill-switches/paymentsEnabled", { enabled: false, reason: "Stripe incident" });
    expect(res.status).toBe(200);
    const blocked = await post(SELLER, "/buyer/checkout/session");
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ code: "PAYMENTS_PAUSED", paused: true });
    expect(blocked.headers.get("retry-after")).toBe("300");
    expect((await post(SELLER, "/webhooks/stripe")).status).toBe(200);
    expect((await post(SELLER, "/live/start")).status).toBe(200);
    expect((await post(SELLER, "/ai/chat")).status).toBe(200);

    const audit = await db.select().from(adminAuditLog)
      .where(and(eq(adminAuditLog.actorClerkId, ADMIN), eq(adminAuditLog.targetId, "paymentsEnabled")));
    expect(audit.map((a) => a.action)).toEqual(["kill_switch.pause"]);
    expect(audit[0]!.summary).toBe("Paused Payments: Stripe incident");

    expect((await post(ADMIN, "/admin/kill-switches/paymentsEnabled", { enabled: true })).status).toBe(200);
    expect((await post(SELLER, "/buyer/checkout/session")).status).toBe(200);
  });

  it("pauses live and AI the same way", async () => {
    await post(ADMIN, "/admin/kill-switches/liveEnabled", { enabled: false, reason: "Agora outage" });
    await post(ADMIN, "/admin/kill-switches/aiEnabled", { enabled: false, reason: "Cost spike" });
    expect(await (await post(SELLER, "/live/start")).json()).toMatchObject({ code: "LIVE_PAUSED" });
    expect((await post(SELLER, "/live/x/end")).status).toBe(200);
    expect(await (await post(SELLER, "/mockup/generate")).json()).toMatchObject({ code: "AI_PAUSED" });
    await post(ADMIN, "/admin/kill-switches/liveEnabled", { enabled: true });
    await post(ADMIN, "/admin/kill-switches/aiEnabled", { enabled: true });
    expect((await post(SELLER, "/live/start")).status).toBe(200);
  });
});

describe("fail-open", () => {
  it("treats a missing row as on", async () => {
    const saved = (await pool.query("SELECT key, enabled, description FROM feature_flags WHERE key = 'aiEnabled'")).rows[0];
    await pool.query("DELETE FROM feature_flags WHERE key = 'aiEnabled'");
    resetKillSwitchCache();
    expect((await killSwitchStates()).aiEnabled).toBe(true);
    if (saved) await pool.query("INSERT INTO feature_flags (key, enabled, description) VALUES ($1, $2, $3)", [saved.key, saved.enabled, saved.description]);
    resetKillSwitchCache();
  });
});
