/**
 * Wave 1 / slice s11 — routes/sales.ts:
 *   - malformed sale ids / productIds reached uuid columns and 500'd.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../middlewares/requireRole")>()),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import salesRouter from "../sales";
import { clearSalesCache } from "../../lib/pricing/salesRuntime";
import { call, seedSeller, startApp } from "../../lib/money/__tests__/moneyHarness";

let app: { base: string; close: () => Promise<void> };
beforeAll(async () => {
  app = await startApp((server) => server.use("/api/sales", salesRouter));
});
afterAll(async () => { await app?.close(); clearSalesCache(); });

describe("sales (wave1 s11)", () => {
  it("answers 404 for a malformed sale id and 400 for malformed productIds", async () => {
    const seller = await seedSeller("w1sale-b");
    expect((await call(app.base, "PATCH", "/api/sales/not-a-uuid", seller, { active: false })).status).toBe(404);
    expect((await call(app.base, "DELETE", "/api/sales/not-a-uuid", seller)).status).toBe(404);
    const bad = await call(app.base, "POST", "/api/sales", seller, {
      name: "Picked", discountType: "percent", value: 10, scope: "products", productIds: ["not-a-uuid"],
    });
    expect(bad.status).toBe(400);
  });
});
