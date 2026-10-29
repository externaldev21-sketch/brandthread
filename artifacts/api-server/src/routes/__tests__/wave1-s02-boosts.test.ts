/**
 * Wave-1 audit (slice s02) — routes/boosts.ts:
 *  - malformed ids (boost :id, POST targetId) are a 404, not a Postgres
 *    "invalid input syntax for type uuid" 500;
 *  - PATCH pause/cancel only applies from the status it checked, so a
 *    concurrent change (e.g. the boost completing) is not overwritten.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { boosts, db } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const SELLER = `w1s02-boost-seller-${crypto.randomBytes(5).toString("hex")}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = SELLER; next(); },
}));
vi.mock("../../lib/stripe", () => ({ requireStripe: () => { throw new Error("stripe not expected"); } }));

let server: Server;
let base = "";

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${base}/api/boosts${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  const { default: router } = await import("../boosts");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }; next(); });
  app.use("/api/boosts", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(boosts).where(eq(boosts.sellerId, SELLER));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("malformed ids", () => {
  it("PATCH, pay and verify answer 404 for a non-uuid boost id", async () => {
    expect((await call("PATCH", "/not-a-uuid", { status: "paused" })).status).toBe(404);
    expect((await call("POST", "/not-a-uuid/pay", { returnUrl: "brandthread://boost" })).status).toBe(404);
    expect((await call("POST", "/not-a-uuid/pay/verify", {})).status).toBe(404);
  });

  it("POST answers 404 for a non-uuid targetId", async () => {
    const res = await call("POST", "/", { targetType: "post", targetId: "abc", budgetCents: 1000, durationDays: 7 });
    expect(res.status).toBe(404);
  });
});

describe("PATCH status guard", () => {
  it("does not overwrite a status that changed after it was read", async () => {
    const [boost] = await db.insert(boosts).values({
      sellerId: SELLER, targetType: "post", targetId: crypto.randomUUID(), budgetCents: 1000,
      status: "active", endsAt: new Date(Date.now() + 86_400_000),
    }).returning();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Holds the row lock while it moves the boost to completed, so the PATCH
    // reads "active" and then waits on the lock to write.
    const locker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM boosts WHERE id = ${boost.id} FOR UPDATE`);
      await tx.update(boosts).set({ status: "completed" }).where(eq(boosts.id, boost.id));
      await gate;
    });

    const patch = call("PATCH", `/${boost.id}`, { status: "paused" });
    for (let i = 0; i < 60; i++) {
      const waiting = await db.execute(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query ILIKE 'update "boosts"%'`);
      if (Number((waiting.rows[0] as any)?.n ?? 0) > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    release();
    await locker;
    const res = await patch;

    expect(res.status).toBe(409);
    const [after] = await db.select({ status: boosts.status }).from(boosts).where(eq(boosts.id, boost.id));
    expect(after.status).toBe("completed");
  });

  it("still pauses an active boost", async () => {
    const [boost] = await db.insert(boosts).values({
      sellerId: SELLER, targetType: "post", targetId: crypto.randomUUID(), budgetCents: 1000,
      status: "active", endsAt: new Date(Date.now() + 86_400_000),
    }).returning();
    const res = await call("PATCH", `/${boost.id}`, { status: "paused" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).status).toBe("paused");
  });
});
