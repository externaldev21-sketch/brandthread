import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, products, users } from "@workspace/db";
import { inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `stats-seller-${suffix}`;
const suspended = `stats-suspended-${suffix}`;

let server: Server;
let base = "";

type Stats = { brands: number; piecesListed: number; ordersShipped: number };
const getStats = async () => {
  const res = await fetch(`${base}/api/public/stats`);
  expect(res.status).toBe(200);
  return (await res.json()) as Stats;
};

beforeAll(async () => {
  const { default: discoveryRouter } = await import("../discovery");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error() {} }; next(); });
  app.use("/api/public", discoveryRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(inArray(orders.ownerId, [seller, suspended]));
  await db.delete(products).where(inArray(products.ownerId, [seller, suspended]));
  await db.delete(users).where(inArray(users.clerkId, [seller, suspended]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/public/stats", () => {
  it("counts only live products, their sellers, and shipped orders", async () => {
    const before = await getStats();
    expect(Number.isInteger(before.brands) && Number.isInteger(before.piecesListed) && Number.isInteger(before.ordersShipped)).toBe(true);

    await db.insert(users).values([
      { clerkId: seller, email: `${seller}@example.test`, name: "Stats", displayName: "Stats Seller", accountType: "seller" },
      { clerkId: suspended, email: `${suspended}@example.test`, name: "Gone", displayName: "Gone Seller", accountType: "seller", suspendedAt: new Date() },
    ] as any);
    await db.insert(products).values([
      { ownerId: seller, name: `Stats Tee ${suffix}`, status: "active", images: [] },
      { ownerId: seller, name: `Stats Cap ${suffix}`, status: "active", images: [] },
      { ownerId: seller, name: `Stats Draft ${suffix}`, status: "draft", images: [] },
      { ownerId: seller, name: `Stats Deleted ${suffix}`, status: "active", deletedAt: new Date(), images: [] },
      { ownerId: suspended, name: `Stats Hidden ${suffix}`, status: "active", images: [] },
    ] as any);
    await db.insert(orders).values([
      { ownerId: seller, orderNumber: `ST-${suffix}-1`, totalCents: 1000, subtotalCents: 1000, status: "shipped", shippedAt: new Date() },
      { ownerId: seller, orderNumber: `ST-${suffix}-2`, totalCents: 1000, subtotalCents: 1000, status: "processing" },
    ] as any);

    const after = await getStats();
    expect(after.brands - before.brands).toBe(1);
    expect(after.piecesListed - before.piecesListed).toBe(2);
    expect(after.ordersShipped - before.ordersShipped).toBe(1);
  });

  it("is publicly cacheable", async () => {
    const res = await fetch(`${base}/api/public/stats`);
    expect(res.headers.get("cache-control")).toContain("public");
  });
});
