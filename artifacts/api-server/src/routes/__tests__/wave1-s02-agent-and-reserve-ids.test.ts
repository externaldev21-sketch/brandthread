/**
 * Wave-1 audit (slice s02) — malformed ids are a 404, not a Postgres
 * "invalid input syntax for type uuid" 500:
 *  - POST /api/brandthread-agent/message { conversationId }
 *  - /api/buyer/products/:productId/reserve (POST, DELETE) and /reservation
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { setAiConsent } from "../../lib/aiConsent";

const USER = `w1s02-ids-${crypto.randomBytes(5).toString("hex")}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = USER; next(); },
}));

let server: Server;
let base = "";

const send = (method: string, path: string, body?: unknown) => fetch(`${base}${path}`, {
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeAll(async () => {
  await db.insert(users).values({
    clerkId: USER, email: `${USER}@example.test`, name: "Ids Buyer", accountType: "buyer",
    aiDataConsentAt: new Date(),
  });
  await setAiConsent(USER, true);
  const { default: agentRouter } = await import("../brandthread-agent");
  const { default: buyerProductsRouter } = await import("../buyer-products");
  const app = express();
  app.use(express.json());
  app.use("/api/brandthread-agent", agentRouter);
  app.use("/api/buyer/products", buyerProductsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.clerkId, USER));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("malformed ids", () => {
  it("agent message: a non-uuid conversationId is 404", async () => {
    const res = await send("POST", "/api/brandthread-agent/message", { conversationId: "not-a-uuid", text: "hi" });
    expect(res.status).toBe(404);
  });

  it("buyer product reserve endpoints: a non-uuid productId is 404", async () => {
    expect((await send("POST", "/api/buyer/products/not-a-uuid/reserve", {})).status).toBe(404);
    expect((await send("DELETE", "/api/buyer/products/not-a-uuid/reserve")).status).toBe(404);
    expect((await send("GET", "/api/buyer/products/not-a-uuid/reservation")).status).toBe(404);
  });

  it("a well-formed but unknown product still reads as not reserved", async () => {
    const res = await send("GET", `/api/buyer/products/${crypto.randomUUID()}/reservation`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reserved: false, demandCount: 0 });
  });
});
