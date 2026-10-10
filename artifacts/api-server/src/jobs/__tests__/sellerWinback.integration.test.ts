import { afterAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, sellerWinbackMessages, users } from "@workspace/db";

const sendEmail = vi.fn().mockResolvedValue(true);
const push = vi.fn().mockResolvedValue(true);
vi.mock("../../lib/brandthreadEmail", async (orig) => ({ ...(await orig<typeof import("../../lib/brandthreadEmail")>()), sendBrandthreadEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("../../lib/push", async (orig) => ({ ...(await orig<typeof import("../../lib/push")>()), sendPushToUser: (...a: unknown[]) => push(...a) }));

const { runSellerWinback } = await import("../sellerWinback");

const suffix = crypto.randomBytes(5).toString("hex");
const now = new Date("2026-10-10T12:00:00Z");
const DAY = 86_400_000;
const ids = [`wb-due-${suffix}`, `wb-early-${suffix}`, `wb-active-${suffix}`];

afterAll(async () => {
  await db.delete(sellerWinbackMessages).where(inArray(sellerWinbackMessages.sellerId, ids));
  await db.delete(users).where(inArray(users.clerkId, ids));
});

describe("seller win-back job", () => {
  it("reaches a seller a week after their plan ended, once", async () => {
    await db.insert(users).values([
      { clerkId: ids[0], email: `${ids[0]}@test.local`, name: "Due", accountType: "seller", brandName: "Halo", subscriptionStatus: "canceled", subscriptionPeriodEnd: new Date(now.getTime() - 8 * DAY) },
      { clerkId: ids[1], email: `${ids[1]}@test.local`, name: "Early", accountType: "seller", subscriptionStatus: "canceled", subscriptionPeriodEnd: new Date(now.getTime() - 3 * DAY) },
      { clerkId: ids[2], email: `${ids[2]}@test.local`, name: "Active", accountType: "seller", subscriptionStatus: "active", subscriptionPeriodEnd: new Date(now.getTime() - 8 * DAY) },
    ] as any);
    await runSellerWinback(now);
    const to = sendEmail.mock.calls.map(([a]) => (a as any).to);
    expect(to).toContain(`${ids[0]}@test.local`);
    expect(to).not.toContain(`${ids[1]}@test.local`);
    expect(to).not.toContain(`${ids[2]}@test.local`);
    expect(push).toHaveBeenCalledWith(ids[0], expect.objectContaining({ data: expect.objectContaining({ route: "/subscription" }) }), "subscription");

    sendEmail.mockClear();
    await runSellerWinback(new Date(now.getTime() + DAY));
    expect(sendEmail.mock.calls.map(([a]) => (a as any).to)).not.toContain(`${ids[0]}@test.local`);
  });
});
