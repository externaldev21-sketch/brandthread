import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, orderItems, orders, users } from "@workspace/db";
import { makeTestWalletEnv, readStoredZip } from "../../lib/walletPass/__tests__/testCerts";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = auth.userId;
    next();
  },
}));

const RUN = `wallet-${crypto.randomBytes(6).toString("hex")}`;
const SELLER = `${RUN}_seller`;
const BUYER = `${RUN}_buyer`;
const OTHER = `${RUN}_other`;
const walletEnv = makeTestWalletEnv();
const savedEnv: Record<string, string | undefined> = {};
let preorderId = "";
let regularId = "";
let server: Server;
let base = "";

function setWalletEnv(on: boolean) {
  for (const [key, value] of Object.entries(walletEnv)) {
    if (on) process.env[key] = value;
    else delete process.env[key];
  }
}

beforeAll(async () => {
  for (const key of [...Object.keys(walletEnv), "SESSION_SECRET"]) savedEnv[key] = process.env[key];
  process.env.SESSION_SECRET = "wallet-test-secret";
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Studio Nine", brandName: "Studio Nine", accountType: "seller", role: "owner" },
    { clerkId: BUYER, email: `${BUYER}@example.test`, name: "Wallet Buyer", accountType: "buyer", role: "buyer" },
  ]);
  const [pre] = await db.insert(orders).values({
    ownerId: SELLER, buyerId: BUYER, orderNumber: "BT-4821", status: "processing",
    totalCents: 6000, subtotalCents: 6000, paidAt: new Date(),
    isPreorder: true, promisedShipDate: new Date("2026-12-01T00:00:00Z"),
  }).returning({ id: orders.id });
  preorderId = pre!.id;
  await db.insert(orderItems).values({ orderId: preorderId, productName: "Boxy tee", quantity: 1, priceCents: 6000, isPreorder: true });
  const [regular] = await db.insert(orders).values({
    ownerId: SELLER, buyerId: BUYER, orderNumber: "BT-4822", status: "processing",
    totalCents: 3000, subtotalCents: 3000, paidAt: new Date(),
  }).returning({ id: orders.id });
  regularId = regular!.id;

  const { default: walletRouter } = await import("../walletPasses");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {} }; next(); });
  app.use("/api/wallet", walletRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(inArray(orders.id, [preorderId, regularId].filter(Boolean)));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, BUYER]));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await new Promise((resolve) => server.close(resolve));
});

async function link(orderId: string) {
  return fetch(`${base}/api/wallet/orders/${orderId}/link`, { method: "POST" });
}

describe("Apple Wallet pre-order passes", () => {
  it("is off, and never builds a pass, until the keys are set", async () => {
    setWalletEnv(false);
    auth.userId = BUYER;
    expect(await (await fetch(`${base}/api/wallet/status`)).json()).toEqual({ enabled: false });
    expect((await link(preorderId)).status).toBe(404);
  });

  it("gives the buyer a signed pass for their own pre-order", async () => {
    setWalletEnv(true);
    auth.userId = BUYER;
    expect(await (await fetch(`${base}/api/wallet/status`)).json()).toEqual({ enabled: true });
    const res = await link(preorderId);
    expect(res.status).toBe(200);
    const { path } = await res.json() as { path: string };
    expect(path).toMatch(/^\/api\/wallet\/passes\//);

    const pass = await fetch(`${base}${path}`);
    expect(pass.status).toBe(200);
    expect(pass.headers.get("content-type")).toBe("application/vnd.apple.pkpass");
    const files = readStoredZip(Buffer.from(await pass.arrayBuffer()));
    const json = JSON.parse(files.get("pass.json")!.toString("utf8"));
    expect(json.serialNumber).toBe(preorderId);
    expect(json.generic.primaryFields[0].value).toBe("Boxy tee");
    expect(json.generic.auxiliaryFields[0].value).toBe("Studio Nine");
    expect(json.generic.secondaryFields.find((f: any) => f.key === "order").value).toBe("BT-4821");
    expect(files.has("signature")).toBe(true);
  });

  it("refuses other people's orders and orders that aren't pre-orders", async () => {
    setWalletEnv(true);
    auth.userId = OTHER;
    expect((await link(preorderId)).status).toBe(404);
    auth.userId = BUYER;
    expect((await link(regularId)).status).toBe(409);
  });

  it("rejects a tampered or made-up download link", async () => {
    setWalletEnv(true);
    auth.userId = BUYER;
    const { path } = await (await link(preorderId)).json() as { path: string };
    const tampered = path.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await fetch(`${base}${tampered}`)).status).toBe(410);
    expect((await fetch(`${base}/api/wallet/passes/nope`)).status).toBe(410);
  });
});
