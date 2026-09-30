/**
 * Buyer saved sizes / preferences.
 * GET        /api/buyer/preferences — the buyer's preferences (defaults when none saved)
 * PUT|PATCH  /api/buyer/preferences — partial merge (see lib/buyerPreferences.ts)
 */
import { Router } from "express";
import { db, buyerPreferences } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { applyPatch, buyerPreferencesPatchSchema, toDto } from "../lib/buyerPreferences";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  try {
    const [row] = await db.select().from(buyerPreferences).where(eq(buyerPreferences.userId, userId)).limit(1);
    res.json(toDto(row));
  } catch (err) {
    (req as any).log?.error?.({ err }, "buyer preferences read failed");
    res.status(500).json({ error: "Couldn't load your preferences. Try again." });
  }
});

async function save(req: any, res: any) {
  const userId = req.clerkUserId as string;
  const parsed = buyerPreferencesPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid preferences",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }
  try {
    const saved = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(buyerPreferences)
        .where(eq(buyerPreferences.userId, userId)).limit(1).for("update");
      const values = applyPatch(existing ?? null, parsed.data);
      const [row] = await tx.insert(buyerPreferences).values({ userId, ...values })
        .onConflictDoUpdate({ target: buyerPreferences.userId, set: values }).returning();
      return row;
    });
    res.json(toDto(saved));
  } catch (err) {
    req.log?.error?.({ err }, "buyer preferences save failed");
    res.status(500).json({ error: "Couldn't save your preferences. Try again." });
  }
}

router.put("/", save);
router.patch("/", save);

export default router;
