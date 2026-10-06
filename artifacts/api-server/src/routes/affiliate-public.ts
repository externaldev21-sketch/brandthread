/**
 * Public affiliate click tracking. Mounted at /api/public/affiliate.
 *   POST /click  { code, visitorId? } -> { valid, code, brand, expiresAt }
 *
 * Unauthenticated, rate-limited, and leaks nothing private: it only echoes the
 * brand's public name and the program's window. A visitor id (random, stored
 * client-side, hashed here) counts at most one click per creator per day.
 */
import crypto from "node:crypto";
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, affiliateClicks, affiliateCreators, affiliatePrograms, users } from "@workspace/db";
import { rateLimit } from "../middlewares/rateLimit";
import { attributionExpiry, normalizeAffiliateCode } from "../lib/affiliate/commission";

const router = Router();

router.post("/click", rateLimit("public-read"), async (req, res) => {
  const code = normalizeAffiliateCode(req.body?.code);
  if (!code) {
    res.status(400).json({ valid: false, error: "Invalid code" });
    return;
  }
  try {
    const [affiliate] = await db.select().from(affiliateCreators).where(eq(affiliateCreators.code, code)).limit(1);
    const [program] = affiliate
      ? await db.select().from(affiliatePrograms).where(eq(affiliatePrograms.sellerId, affiliate.sellerId)).limit(1)
      : [];
    if (!affiliate || affiliate.status !== "active" || !program?.enabled) {
      res.status(404).json({ valid: false, error: "This link is no longer active" });
      return;
    }
    const visitor = typeof req.body?.visitorId === "string" && req.body.visitorId.length >= 8 && req.body.visitorId.length <= 100
      ? crypto.createHash("sha256").update(req.body.visitorId).digest("hex")
      : null;
    const now = new Date();
    await db.insert(affiliateClicks).values({
      affiliateId: affiliate.id, sellerId: affiliate.sellerId, creatorId: affiliate.creatorId,
      visitorHash: visitor, day: now.toISOString().slice(0, 10),
    }).onConflictDoNothing();
    const [seller] = await db.select({ brandName: users.brandName, name: users.name, username: users.username })
      .from(users).where(eq(users.clerkId, affiliate.sellerId)).limit(1);
    res.json({
      valid: true,
      code: affiliate.code,
      sellerId: affiliate.sellerId,
      brand: { name: seller?.brandName || seller?.name || "Brand", username: seller?.username ?? null },
      windowDays: program.windowDays,
      expiresAt: attributionExpiry(now, program.windowDays).toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Affiliate click failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
