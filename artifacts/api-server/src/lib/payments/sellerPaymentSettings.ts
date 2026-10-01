import { inArray } from "drizzle-orm";
import { db, sellerPaymentSettings } from "@workspace/db";
import { logger } from "../logger";
import { bnplPlatformEnabled, eligibleBnplMethods, type BnplMethod } from "./bnpl";

/**
 * BNPL methods for a cart. Never throws: any failure (flag off, DB error)
 * returns [] so checkout stays card-only.
 */
export async function bnplMethodsForCart(input: {
  sellerIds: string[];
  amountCents: number;
  shipToCountry: string;
  currency?: string;
}): Promise<BnplMethod[]> {
  try {
    if (!bnplPlatformEnabled()) return [];
    const rows = await db.select({ sellerId: sellerPaymentSettings.sellerId, bnplEnabled: sellerPaymentSettings.bnplEnabled })
      .from(sellerPaymentSettings).where(inArray(sellerPaymentSettings.sellerId, input.sellerIds));
    const optedIn = new Set(rows.filter((row) => row.bnplEnabled).map((row) => row.sellerId));
    return eligibleBnplMethods({
      platformEnabled: true,
      sellerOptIns: input.sellerIds.map((id) => optedIn.has(id)),
      currency: input.currency ?? "usd",
      amountCents: input.amountCents,
      shipToCountry: input.shipToCountry,
    });
  } catch (err) {
    logger.warn({ err }, "BNPL eligibility check failed; offering card only");
    return [];
  }
}
