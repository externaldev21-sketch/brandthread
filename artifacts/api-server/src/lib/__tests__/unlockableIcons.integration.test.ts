/**
 * Unlockable app icons, against real Postgres and the real PATCH /api/auth/profile:
 * Brushed silver needs Insider with any brand, Chrome needs Inner Circle;
 * theme icons stay free; the DB constraint (migration 278) accepts both ids.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ selfId: "" }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = state.selfId; next(); },
}));

import { eq } from "drizzle-orm";
import { db, orders, users } from "@workspace/db";
import { seedBuyer, seedSeller, startApp, uid } from "../money/__tests__/moneyHarness";
import { canUseAppIcon } from "../unlockableIcons";

let app: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => {
  const { default: authRouter } = await import("../../routes/auth");
  app = await startApp((server) => { server.use("/api/auth", authRouter); });
});
afterAll(async () => { await app.close(); });

async function setIcon(appIconId: string | null) {
  const res = await fetch(`${app.base}/api/auth/profile`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ appIconId }),
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const iconOf = async (id: string) => (await db.select({ icon: users.appIconId }).from(users).where(eq(users.clerkId, id)))[0].icon;
const spend = (sellerId: string, buyerId: string, cents: number) => db.insert(orders).values({
  ownerId: sellerId, buyerId, orderNumber: uid("BT"), status: "processing", totalCents: cents, subtotalCents: cents, paidAt: new Date(),
});

describe("unlockable app icons", () => {
  it("unlock with the best level across brands, and are refused until then", async () => {
    const buyer = await seedBuyer("icons");
    const brandA = await seedSeller("icons-a");
    const brandB = await seedSeller("icons-b");
    state.selfId = buyer;

    // Theme icons are always free.
    expect((await setIcon("purple")).status).toBe(200);
    expect(await iconOf(buyer)).toBe("purple");

    // Nothing bought yet: both locked.
    expect((await setIcon("brushed-silver")).body.code).toBe("ICON_LOCKED");
    expect((await setIcon("chrome")).status).toBe(403);
    expect(await iconOf(buyer)).toBe("purple");

    // Member with one brand, Insider ($250) with another: Brushed silver opens, Chrome doesn't.
    await spend(brandA, buyer, 5_000);
    await spend(brandB, buyer, 30_000);
    expect(await canUseAppIcon(buyer, "brushed-silver")).toBe(true);
    expect((await setIcon("brushed-silver")).status).toBe(200);
    expect(await iconOf(buyer)).toBe("brushed-silver");
    expect((await setIcon("chrome")).status).toBe(403);

    // Inner Circle ($1,000) with brand B: Chrome opens (and the DB accepts it).
    await spend(brandB, buyer, 80_000);
    expect((await setIcon("chrome")).status).toBe(200);
    expect(await iconOf(buyer)).toBe("chrome");

    // Back to following the theme is always allowed.
    expect((await setIcon(null)).status).toBe(200);
    expect(await iconOf(buyer)).toBeNull();
  });
});
