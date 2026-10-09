import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { buyerAddresses, db, releaseTestFailureClaims, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "@workspace/api-zod";
import { validateRequest } from "../middlewares/validateRequest";

const router = Router();
const ADDRESS_LIST_FAILURE = "buyer-address-list";
const FAILURE_TTL_MS = 10 * 60 * 1_000;

const buyerFixtureSchema = z.object({
  buyerId: z.string().trim().min(1).max(200),
  email: z.string().trim().email(),
  labels: z.tuple([
    z.string().trim().min(1).max(80),
    z.string().trim().min(1).max(80),
  ]),
});

const buyerIdSchema = z.object({
  buyerId: z.string().trim().min(1).max(200),
});

function authorized(requestToken: unknown): boolean {
  const expected = process.env.RELEASE_TEST_CONTROL_TOKEN?.trim();
  const received = typeof requestToken === "string" ? requestToken.trim() : "";
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length
    && timingSafeEqual(expectedBytes, receivedBytes);
}

router.use((req, res, next) => {
  if (!authorized(req.header("x-release-test-control-token"))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
});

router.post(
  "/buyer-addresses/prepare",
  validateRequest({ body: buyerFixtureSchema }),
  async (req, res) => {
    const { buyerId, email, labels } = req.body;
    await db.transaction(async (tx) => {
      await tx.delete(buyerAddresses).where(eq(buyerAddresses.buyerId, buyerId));
      await tx.insert(users).values({
        clerkId: buyerId,
        email,
        name: "Release Check Buyer",
        displayName: "Release Check Buyer",
        accountType: "buyer",
        role: "owner",
        onboardingComplete: true,
      }).onConflictDoUpdate({
        target: users.clerkId,
        set: {
          email,
          name: "Release Check Buyer",
          displayName: "Release Check Buyer",
          accountType: "buyer",
          onboardingComplete: true,
          deletedAt: null,
          updatedAt: new Date(),
        },
      });
      await tx.insert(buyerAddresses).values([
        {
          buyerId,
          label: labels[0],
          recipientName: "Release Check Buyer",
          street: "100 Test Runner Way",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
          country: "US",
          phone: "+15125550100",
          isDefault: true,
        },
        {
          buyerId,
          label: labels[1],
          recipientName: "Release Check Buyer",
          street: "200 Portable Build Avenue",
          city: "Austin",
          state: "TX",
          postalCode: "78702",
          country: "US",
          phone: "+15125550101",
          isDefault: false,
        },
      ]);
    });
    await db.delete(releaseTestFailureClaims)
      .where(eq(releaseTestFailureClaims.buyerId, buyerId));
    res.json({ ok: true, addressCount: 2 });
  },
);

router.post(
  "/buyer-addresses/arm-failure",
  validateRequest({ body: buyerIdSchema }),
  async (req, res) => {
    const { buyerId } = req.body;
    const addresses = await db.select({ id: buyerAddresses.id })
      .from(buyerAddresses)
      .where(eq(buyerAddresses.buyerId, buyerId));
    if (addresses.length !== 2) {
      res.status(409).json({ error: "Buyer fixture must contain exactly two addresses" });
      return;
    }
    const now = new Date();
    await db.insert(releaseTestFailureClaims).values({
      buyerId,
      failureKind: ADDRESS_LIST_FAILURE,
      expiresAt: new Date(now.valueOf() + FAILURE_TTL_MS),
      createdAt: now,
    }).onConflictDoUpdate({
      target: releaseTestFailureClaims.buyerId,
      set: {
        failureKind: ADDRESS_LIST_FAILURE,
        expiresAt: new Date(now.valueOf() + FAILURE_TTL_MS),
        createdAt: now,
      },
    });
    res.json({ ok: true });
  },
);

router.post(
  "/buyer-addresses/cleanup",
  validateRequest({ body: buyerIdSchema }),
  async (req, res) => {
    const { buyerId } = req.body;
    await db.transaction(async (tx) => {
      await tx.delete(releaseTestFailureClaims)
        .where(eq(releaseTestFailureClaims.buyerId, buyerId));
      await tx.delete(buyerAddresses).where(eq(buyerAddresses.buyerId, buyerId));
      await tx.delete(users).where(eq(users.clerkId, buyerId));
    });
    res.json({ ok: true });
  },
);

export async function consumeBuyerAddressListFailure(buyerId: string): Promise<boolean> {
  const result = await db.execute(sql`
    DELETE FROM release_test_failure_claims
    WHERE buyer_id = ${buyerId}
      AND failure_kind = ${ADDRESS_LIST_FAILURE}
      AND expires_at > NOW()
    RETURNING buyer_id
  `);
  return (result.rows?.length ?? 0) === 1;
}

export default router;