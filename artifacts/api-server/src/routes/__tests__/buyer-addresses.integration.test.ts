import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { buyerAddresses, db } from "@workspace/db";

const suffix = crypto.randomBytes(6).toString("hex");
const buyerA = `address-owner-a-${suffix}`;
const buyerB = `address-owner-b-${suffix}`;
process.env.RELEASE_TEST_CONTROL_TOKEN = `release-control-${suffix}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

let server: Server;
let base = "";

async function request(user: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function control(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-release-test-control-token": process.env.RELEASE_TEST_CONTROL_TOKEN!,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const address = (label: string, isDefault = false) => ({
  label,
  recipientName: "Address Owner",
  street: "100 Main Street",
  city: "Austin",
  state: "TX",
  postalCode: "78701",
  country: "US",
  isDefault,
});

beforeAll(async () => {
  const { default: buyerRouter } = await import("../buyer");
  const { default: releaseTestControlRouter } = await import("../release-test-control");
  const app = express();
  app.use(express.json());
  app.use("/api/release-test-control", releaseTestControlRouter);
  app.use("/api/buyer", buyerRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(buyerAddresses).where(eq(buyerAddresses.buyerId, buyerA));
  await db.delete(buyerAddresses).where(eq(buyerAddresses.buyerId, buyerB));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("buyer address ownership and defaults", () => {
  it("prevents cross-buyer reads and mutations", async () => {
    const created = await request(buyerA, "POST", "/api/buyer/addresses", address("Home"));
    expect(created.status).toBe(201);

    const otherList = await request(buyerB, "GET", "/api/buyer/addresses");
    expect(otherList.body).toEqual([]);
    expect((await request(buyerB, "PATCH", `/api/buyer/addresses/${created.body.id}`, { label: "Stolen" })).status).toBe(404);
    expect((await request(buyerB, "POST", `/api/buyer/addresses/${created.body.id}/default`, {})).status).toBe(404);
    expect((await request(buyerB, "DELETE", `/api/buyer/addresses/${created.body.id}`)).status).toBe(404);
  });

  it("serializes concurrent default changes to exactly one default", async () => {
    const responses = await Promise.all([
      request(buyerA, "POST", "/api/buyer/addresses", address("Office", true)),
      request(buyerA, "POST", "/api/buyer/addresses", address("Studio", true)),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const rows = await db.select().from(buyerAddresses)
      .where(and(eq(buyerAddresses.buyerId, buyerA), eq(buyerAddresses.isDefault, true)));
    expect(rows).toHaveLength(1);
  });

  it("scopes the release failure to one buyer and consumes it once", async () => {
    await db.delete(buyerAddresses).where(eq(buyerAddresses.buyerId, buyerA));
    await request(buyerA, "POST", "/api/buyer/addresses", address("Home"));
    await request(buyerA, "POST", "/api/buyer/addresses", address("Office"));
    expect((await control("/api/release-test-control/buyer-addresses/arm-failure", {
      buyerId: buyerA,
    })).status).toBe(200);

    expect((await request(buyerB, "GET", "/api/buyer/addresses")).status).toBe(200);
    const concurrentStatuses = await Promise.all([
      request(buyerA, "GET", "/api/buyer/addresses"),
      request(buyerA, "GET", "/api/buyer/addresses"),
    ]);
    expect(concurrentStatuses.map(({ status }) => status).sort()).toEqual([200, 503]);
    expect((await request(buyerA, "GET", "/api/buyer/addresses")).status).toBe(200);
  });

  it("hides release controls when the runner token is absent or wrong", async () => {
    const response = await fetch(`${base}/api/release-test-control/buyer-addresses/arm-failure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buyerId: buyerA }),
    });
    expect(response.status).toBe(404);
  });
});