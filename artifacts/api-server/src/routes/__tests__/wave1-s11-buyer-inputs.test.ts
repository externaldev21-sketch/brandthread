/**
 * Wave 1 / slice s11 — bad buyer input that used to 500:
 *   - POST /api/reviews with a malformed orderId or productId reached the
 *     uuid columns (routes/reviews.ts);
 *   - DELETE /api/safety/muted-words/:phrase decoded the already-decoded
 *     param a second time, so "100%" threw URIError and "a%20b" removed the
 *     wrong phrase (routes/safety.ts);
 *   - PUT /api/buyer/saved/:id/price-alert with no body destructured
 *     undefined (routes/saved.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../notifications-feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notifications-feed")>()),
  publishNotification: async () => {},
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../middlewares/rateLimit")>()),
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { and, eq } from "drizzle-orm";
import { db, mutedWords, orders } from "@workspace/db";
import reviewsRouter from "../reviews";
import safetyRouter from "../safety";
import savedRouter from "../saved";
import { call, seedBuyer, seedSeller, startApp, uid } from "../../lib/money/__tests__/moneyHarness";

let app: { base: string; close: () => Promise<void> };
beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/reviews", reviewsRouter);
    server.use("/api/safety", safetyRouter);
    server.use("/api/buyer/saved", savedRouter);
  });
});
afterAll(async () => { await app?.close(); });

describe("POST /api/reviews malformed ids", () => {
  it("answers 403 (not eligible) for a malformed orderId", async () => {
    const seller = await seedSeller("w1rev-a");
    const buyer = await seedBuyer("w1rev-a");
    const res = await call(app.base, "POST", "/api/reviews", buyer, { orderId: "nope", sellerId: seller, rating: 5 });
    expect(res.status).toBe(403);
  });

  it("answers 400 for a malformed productId on a real delivered order", async () => {
    const seller = await seedSeller("w1rev-b");
    const buyer = await seedBuyer("w1rev-b");
    const [order] = await db.insert(orders).values({
      ownerId: seller, buyerId: buyer, orderNumber: uid("BT-W1REV"), status: "delivered", subtotalCents: 1_000, totalCents: 1_000,
    }).returning();
    const res = await call(app.base, "POST", "/api/reviews", buyer, { orderId: order.id, sellerId: seller, productId: "nope", rating: 5 });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/safety/muted-words/:phrase", () => {
  it("removes a phrase containing % (decoded once by the router)", async () => {
    const user = await seedBuyer("w1mute-a");
    const added = await call(app.base, "POST", "/api/safety/muted-words", user, { phrase: "100%" });
    expect([200, 201]).toContain(added.status);
    const res = await call(app.base, "DELETE", `/api/safety/muted-words/${encodeURIComponent("100%")}`, user);
    expect(res.status).toBe(200);
    const left = await db.select().from(mutedWords).where(and(eq(mutedWords.userId, user), eq(mutedWords.phrase, "100%")));
    expect(left).toHaveLength(0);
  });

  it("removes the literal phrase, not a re-decoded one", async () => {
    const user = await seedBuyer("w1mute-b");
    await call(app.base, "POST", "/api/safety/muted-words", user, { phrase: "a%20b" });
    await call(app.base, "POST", "/api/safety/muted-words", user, { phrase: "a b" });
    const res = await call(app.base, "DELETE", `/api/safety/muted-words/${encodeURIComponent("a%20b")}`, user);
    expect(res.status).toBe(200);
    const left = (await db.select({ phrase: mutedWords.phrase }).from(mutedWords).where(eq(mutedWords.userId, user))).map((r) => r.phrase);
    expect(left).toEqual(["a b"]);
  });
});

describe("PUT /api/buyer/saved/:targetId/price-alert", () => {
  it("answers 400 when the request has no body", async () => {
    const user = await seedBuyer("w1saved-a");
    const response = await fetch(`${app.base}/api/buyer/saved/${crypto.randomUUID()}/price-alert`, {
      method: "PUT", headers: { "x-test-user": user },
    });
    expect(response.status).toBe(400);
  });
});
