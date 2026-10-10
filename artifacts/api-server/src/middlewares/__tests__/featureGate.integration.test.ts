import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, liveStreams, sellerPushBroadcasts } from "@workspace/db";

const plans = new Map<string, "starter" | "growth" | "pro">();
vi.mock("../../lib/nativeEntitlements", () => ({
  getEffectiveEntitlement: async (id: string) => ({ planId: plans.get(id) ?? "starter" }),
}));

const { featureGate } = await import("../featureGate");
const { pushBroadcastAllowance } = await import("../pushBroadcastAllowance");
const { checkLiveAllowance, liveAllowanceBlock, liveMinutesThisMonth } = await import("../../lib/liveAllowance");

const suffix = crypto.randomBytes(5).toString("hex");
const starter = `gate-starter-${suffix}`;
const growth = `gate-growth-${suffix}`;
const pro = `gate-pro-${suffix}`;
let server: Server;
let base = "";

beforeAll(async () => {
  plans.set(growth, "growth");
  plans.set(pro, "pro");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).clerkUserId = req.headers["x-test-user"]; next(); });
  const ok = (_req: express.Request, res: express.Response) => { res.json({ ok: true }); };
  app.use("/drops", featureGate("drops", { only: [{ method: "POST", path: "/" }] }), express.Router().get("/", ok).post("/", ok).post("/:id/cancel", ok));
  app.use("/live", express.Router().post("/start", featureGate("live_hosting", { extra: checkLiveAllowance }), ok));
  app.use("/push", pushBroadcastAllowance, express.Router().post("/", ok).post("/preview", ok));
  // Same matchers as routes/index.ts.
  app.use("/boosts", featureGate("boosts", { only: [{ method: "POST", path: "/" }] }), express.Router().get("/", ok).post("/", ok).patch("/:id", ok));
  app.use("/sample-orders", featureGate("manufacturer_hub", { only: [{ method: "POST", path: "/", when: (req) => req.body?.orderType === "bulk" }] }), express.Router().post("/", ok));
  app.use("/seller-hub", featureGate("manufacturer_hub", { only: [{ method: "POST", path: "/quote-requests", when: (req) => req.body?.type !== "sample" }, { method: "POST", path: "/rfqs" }] }), express.Router().post("/quote-requests", ok).post("/rfqs", ok));
  app.use("/analytics", express.Router()
    .get("/dashboard", ok)
    .get("/advanced", featureGate("advanced_analytics"), ok)
    .post("/export", featureGate("analytics_export"), ok));
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(liveStreams).where(inArray(liveStreams.sellerId, [growth]));
  await db.delete(sellerPushBroadcasts).where(inArray(sellerPushBroadcasts.sellerId, [starter, growth]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const call = (path: string, user: string, method = "POST", body: unknown = {}) =>
  fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-test-user": user }, body: method === "GET" ? undefined : JSON.stringify(body) });

describe("featureGate", () => {
  it("blocks Starter from starting a drop with the upgrade prompt payload", async () => {
    const res = await call("/drops", starter);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "PLAN_REQUIRED", feature: "drops", requiredPlan: "growth", currentPlan: "starter" });
  });
  it("leaves listing and cancelling open after a downgrade", async () => {
    expect((await call("/drops", starter, "GET")).status).toBe(200);
    expect((await call("/drops/abc/cancel", starter)).status).toBe(200);
  });
  it("lets Growth start a drop", async () => {
    expect((await call("/drops", growth)).status).toBe(200);
  });
});

describe("live hosting", () => {
  it("is open to Growth and Pro, not Starter", async () => {
    expect((await call("/live/start", starter)).status).toBe(403);
    expect((await call("/live/start", growth)).status).toBe(200);
    expect((await call("/live/start", pro)).status).toBe(200);
  });

  it("counts this month's live minutes, clipping a stream that began last month", async () => {
    process.env.LIVE_GROWTH_MINUTES_PER_MONTH = "240";
    const now = new Date("2026-10-20T12:00:00Z");
    await db.insert(liveStreams).values([
      { sellerId: growth, title: "A", channelName: `bt_a_${suffix}`, status: "ended", startedAt: new Date("2026-10-05T10:00:00Z"), endedAt: new Date("2026-10-05T12:30:00Z") },
      { sellerId: growth, title: "B", channelName: `bt_b_${suffix}`, status: "ended", startedAt: new Date("2026-09-30T23:00:00Z"), endedAt: new Date("2026-10-01T01:00:00Z") },
      { sellerId: growth, title: "C", channelName: `bt_c_${suffix}`, status: "ended", startedAt: new Date("2026-09-10T10:00:00Z"), endedAt: new Date("2026-09-10T12:00:00Z") },
    ] as any);
    expect(await liveMinutesThisMonth(growth, now)).toBe(150 + 60);
    expect(liveAllowanceBlock("growth", await liveMinutesThisMonth(growth, now))).toBeNull();
    await db.insert(liveStreams).values({ sellerId: growth, title: "D", channelName: `bt_d_${suffix}`, status: "ended", startedAt: new Date("2026-10-12T10:00:00Z"), endedAt: new Date("2026-10-12T11:00:00Z") } as any);
    expect(liveAllowanceBlock("growth", await liveMinutesThisMonth(growth, now))).toMatchObject({ code: "PLAN_LIMIT_REACHED", resource: "live_minutes" });
    delete process.env.LIVE_GROWTH_MINUTES_PER_MONTH;
    expect(liveAllowanceBlock("growth", await liveMinutesThisMonth(growth, now))).toBeNull();
  });
});

describe("push broadcast allowance", () => {
  it("allows one a week on Starter and three on Growth; preview stays open", async () => {
    await db.insert(sellerPushBroadcasts).values({ sellerId: starter, title: "t", body: "b", status: "sent" });
    expect((await call("/push", starter)).status).toBe(403);
    expect((await call("/push/preview", starter)).status).toBe(200);
    await db.insert(sellerPushBroadcasts).values([
      { sellerId: growth, title: "t", body: "b", status: "sent" },
      { sellerId: growth, title: "t", body: "b", status: "failed" },
    ]);
    expect((await call("/push", growth)).status).toBe(200);
  });
});

describe("boosts and featured slots", () => {
  it("lets Growth and Pro buy a boost, shows Starter the upgrade prompt", async () => {
    const res = await call("/boosts", starter);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "PLAN_REQUIRED", feature: "boosts", requiredPlan: "growth" });
    expect((await call("/boosts", growth)).status).toBe(200);
    expect((await call("/boosts", pro)).status).toBe(200);
  });
  it("keeps a Starter seller's existing boosts listable and editable", async () => {
    expect((await call("/boosts", starter, "GET")).status).toBe(200);
    expect((await call("/boosts/abc", starter, "PATCH")).status).toBe(200);
  });
});

describe("manufacturer hub", () => {
  it("allows samples on every plan", async () => {
    expect((await call("/sample-orders", starter, "POST", { orderType: "sample" })).status).toBe(200);
    expect((await call("/seller-hub/quote-requests", starter, "POST", { type: "sample" })).status).toBe(200);
  });
  it("puts bulk orders, quotes and RFQs on Growth", async () => {
    for (const [path, body] of [["/sample-orders", { orderType: "bulk" }], ["/seller-hub/quote-requests", { type: "quote" }], ["/seller-hub/rfqs", {}]] as const) {
      const res = await call(path, starter, "POST", body);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "PLAN_REQUIRED", feature: "manufacturer_hub", requiredPlan: "growth" });
      expect((await call(path, growth, "POST", body)).status).toBe(200);
    }
  });
});

describe("analytics levels", () => {
  it("basic on Starter, advanced on Growth, export on Pro", async () => {
    expect((await call("/analytics/dashboard", starter, "GET")).status).toBe(200);
    expect((await call("/analytics/advanced", starter, "GET")).status).toBe(403);
    expect((await call("/analytics/advanced", growth, "GET")).status).toBe(200);
    const exp = await call("/analytics/export", growth);
    expect(exp.status).toBe(403);
    expect(await exp.json()).toMatchObject({ feature: "analytics_export", requiredPlan: "pro" });
    expect((await call("/analytics/export", pro)).status).toBe(200);
  });
});
