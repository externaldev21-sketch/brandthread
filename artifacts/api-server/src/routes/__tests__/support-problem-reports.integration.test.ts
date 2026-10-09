import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { db, orders, users } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = auth.userId;
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: () => void) => next(),
}));

let server: Server;
let base = "";
const RUN = `probrep_${crypto.randomBytes(5).toString("hex")}`;
const BUYER = `${RUN}_buyer`;
const OTHER = `${RUN}_other`;
let orderId = "";

async function report(body: unknown) {
  const res = await fetch(`${base}/api/support/problem-reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function ticketsFor(clerkId: string) {
  const r = await db.execute(sql`SELECT * FROM support_tickets WHERE clerk_id = ${clerkId} ORDER BY created_at`);
  return r.rows as any[];
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: BUYER, email: `${BUYER}@example.test`, name: "Problem Buyer", displayName: "Problem Buyer", accountType: "buyer", role: "buyer" },
  ]);
  const [o] = await db.insert(orders).values({
    ownerId: `${RUN}_merchant`, buyerId: BUYER, orderNumber: `${RUN}-1`, status: "shipped",
    totalCents: 3000, subtotalCents: 3000, paidAt: new Date(),
  }).returning({ id: orders.id });
  orderId = o.id;

  const { default: router } = await import("../support");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/support", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => { auth.userId = ""; });

afterAll(async () => {
  await db.execute(sql`DELETE FROM support_tickets WHERE clerk_id IN (${BUYER}, ${OTHER})`);
  await db.delete(orders).where(inArray(orders.buyerId, [BUYER]));
  await db.delete(users).where(inArray(users.clerkId, [BUYER]));
  await new Promise<void>((resolve, reject) => { server.close((e) => (e ? reject(e) : resolve())); });
});

describe("POST /api/support/problem-reports", () => {
  it("requires auth", async () => {
    expect((await report({ clientReportId: "r1", type: "other", description: "x" })).status).toBe(401);
  });

  it("files an order problem as a support ticket, idempotently", async () => {
    auth.userId = BUYER;
    const body = {
      clientReportId: "br_abc123",
      orderId,
      orderNumber: "spoofed",
      type: "damaged_product",
      description: "Arrived torn",
      evidenceUrls: ["https://cdn.example.test/photo.jpg"],
      localEvidenceCount: 2,
      contactedSeller: true,
    };
    const first = await report(body);
    expect(first.status).toBe(201);
    expect(first.body.ticket.id).toBeTruthy();

    const again = await report(body);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.ticket.id).toBe(first.body.ticket.id);

    const rows = await ticketsFor(BUYER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: "order_problem", status: "open", email: `${BUYER}@example.test` });
    // The order number comes from the server's order row, not the client.
    expect(rows[0].subject).toBe(`Damaged product — order ${RUN}-1`);
    expect(rows[0].body).toContain("Arrived torn");
    expect(rows[0].body).toContain("https://cdn.example.test/photo.jpg");
    expect(rows[0].body).toContain("Contacted seller: yes");
  });

  it("accepts a general report with no order", async () => {
    auth.userId = BUYER;
    const res = await report({ clientReportId: "br_general", type: "other", description: "App question" });
    expect(res.status).toBe(201);
  });

  it("refuses another buyer's order and invalid bodies", async () => {
    auth.userId = OTHER;
    expect((await report({ clientReportId: "br_x", orderId, type: "not_received", description: "mine?" })).status).toBe(404);
    expect((await report({ clientReportId: "br_x", type: "nope", description: "x" })).status).toBe(400);
    expect((await report({ clientReportId: "br_x", type: "other", description: "  " })).status).toBe(400);
    expect((await report({ clientReportId: "br_x", type: "other", description: "x", evidenceUrls: ["file:///tmp/a.jpg"] })).status).toBe(400);
    expect(await ticketsFor(OTHER)).toHaveLength(0);
  });
});
