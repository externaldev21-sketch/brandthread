/**
 * reserveDiscountCapacity against real Postgres: a customer's own open
 * checkout never counts against them — for guests too, whose customerKey is
 * "guest:<email>" while checkout_sessions stores the bare guest_email.
 */
import crypto from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { checkoutSessions, db, discountCodes } from "@workspace/db";
import { reserveDiscountCapacity } from "../discounts";

const suffix = crypto.randomBytes(4).toString("hex");
const sellerId = `cap-audit-seller-${suffix}`;
const codeIds: string[] = [];

async function seedCode(maxUses: number): Promise<string> {
  const id = `cap-audit-${crypto.randomUUID()}`;
  codeIds.push(id);
  await db.insert(discountCodes).values({ id, sellerId, code: `CAP${crypto.randomBytes(3).toString("hex").toUpperCase()}`, maxUses });
  return id;
}

async function openCheckout(discountCodeId: string, who: { buyerId?: string; guestEmail?: string }) {
  await db.insert(checkoutSessions).values({
    sellerId, items: [], discountCodeId,
    buyerId: who.buyerId ?? null, guestEmail: who.guestEmail ?? null,
  });
}

const reserve = (discountCodeId: string, customerKey: string) =>
  db.transaction((tx) => reserveDiscountCapacity(tx, { discountCodeId, customerKey }));

afterAll(async () => {
  await db.delete(checkoutSessions).where(eq(checkoutSessions.sellerId, sellerId));
  for (const id of codeIds) await db.delete(discountCodes).where(eq(discountCodes.id, id));
});

describe("reserveDiscountCapacity (audit)", () => {
  it("lets a guest retry their own open checkout on a single-use code", async () => {
    const id = await seedCode(1);
    const email = `guest-${suffix}@example.com`;
    await reserve(id, `guest:${email}`);
    await openCheckout(id, { guestEmail: email });
    // Same guest, second attempt within the window: their own hold must not block them.
    await expect(reserve(id, `guest:${email}`)).resolves.toBeUndefined();
  });

  it("still blocks a different customer while a guest holds the last use", async () => {
    const id = await seedCode(1);
    await openCheckout(id, { guestEmail: `holder-${suffix}@example.com` });
    await expect(reserve(id, `guest:other-${suffix}@example.com`)).rejects.toMatchObject({ code: "MAX_USES_REACHED" });
    await expect(reserve(id, `buyer-${suffix}`)).rejects.toMatchObject({ code: "MAX_USES_REACHED" });
  });

  it("lets a signed-in buyer retry their own open checkout", async () => {
    const id = await seedCode(1);
    await openCheckout(id, { buyerId: `buyer-${suffix}` });
    await expect(reserve(id, `buyer-${suffix}`)).resolves.toBeUndefined();
  });
});
