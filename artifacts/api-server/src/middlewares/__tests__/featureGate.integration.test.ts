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
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(liveStreams).where(inArray(liveStreams.sellerId, [growth]));
  await db.delete(sellerPushBroadcasts).where(inArray(sellerPushBroadcasts.sellerId, [starter, growth]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const call = (path: string, user: string, method = "POST") =>
  fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-test-user": user }, body: method === "GET" ? undefined : "{}" });

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
