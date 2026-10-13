/**
 * Onboarding taste quiz (buyer).
 *
 *   GET  /api/buyer/taste-quiz          → { products: QuizProduct[] }  (empty when the
 *        catalog can't fill 12 real, photographed products — the client then skips the step)
 *   POST /api/buyer/taste-quiz/swipes   { swipes: [{ productId, liked }], styleInterests? }
 *        → { applied }
 *
 * Swipes train the For You taste profile directly (applyEventToProfile): right
 * is a `like`, left is a `skip`. Style, category and seller come from the
 * product row, never from the client. If the buyer has no taste profile yet,
 * it is first seeded from the picker's labels so a quiz never erases them
 * (ranking only cold-starts from onboarding picks when no profile row exists).
 */
import { Router } from "express";
import { z } from "@workspace/api-zod";
import { db, products, users, buyerTasteProfiles } from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { notBlockedWith } from "../lib/safety";
import { applyEventToProfile, updateAffinityForKeys } from "../lib/ranking/forYou";
import { logger } from "../lib/logger";
import {
  deriveStyleKeys,
  pickerLabelsToKeys,
  pickQuizProducts,
  QUIZ_MAX_PRODUCTS,
  QUIZ_MIN_PRODUCTS,
} from "../lib/tasteQuiz";

const router = Router();
router.use(requireAuth);

const CANDIDATE_POOL = 300;

router.get("/", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  try {
    const rows = await db.select({
      id: products.id,
      ownerId: products.ownerId,
      name: products.name,
      category: products.category,
      images: products.images,
      tags: products.tags,
      styleTags: products.styleTags,
      brandName: users.brandName,
      displayName: users.displayName,
    }).from(products)
      .innerJoin(users, eq(users.clerkId, products.ownerId))
      .where(and(
        eq(products.status, "active"),
        isNull(products.deletedAt),
        isNull(users.suspendedAt),
        isNull(users.deletedAt),
        eq(users.policyRestricted, false),
        sql`json_array_length(${products.images}) > 0`,
        notBlockedWith(myId, products.ownerId),
      ))
      .orderBy(desc(products.createdAt))
      .limit(CANDIDATE_POOL);

    const candidates = rows
      .filter((r) => r.ownerId !== myId && typeof r.images?.[0] === "string" && r.images[0].startsWith("http"))
      .map((r) => ({ ...r, styleKeys: deriveStyleKeys(r) }));
    const picked = pickQuizProducts(candidates, QUIZ_MAX_PRODUCTS);
    if (picked.length < QUIZ_MIN_PRODUCTS) {
      res.json({ products: [] });
      return;
    }
    res.json({
      products: picked.map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brandName || p.displayName || "",
        imageUrl: p.images[0],
        styleKeys: p.styleKeys,
      })),
    });
  } catch (err) {
    logger.error({ err }, "taste quiz products failed");
    res.status(500).json({ error: "Could not load the quiz" });
  }
});

const swipesSchema = z.object({
  swipes: z.array(z.object({
    productId: z.string().uuid(),
    liked: z.boolean(),
  }).strict()).min(1).max(QUIZ_MAX_PRODUCTS),
  styleInterests: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
}).strict();

router.post("/swipes", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const parsed = swipesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid swipes", code: "VALIDATION_ERROR" });
    return;
  }
  const { swipes, styleInterests = [] } = parsed.data;
  try {
    // Last answer wins if a product was swiped twice (undo/redo on the client).
    const byId = new Map(swipes.map((s) => [s.productId, s.liked]));
    const rows = await db.select({
      id: products.id, ownerId: products.ownerId, name: products.name,
      category: products.category, tags: products.tags, styleTags: products.styleTags,
    }).from(products).where(and(
      inArray(products.id, [...byId.keys()]),
      eq(products.status, "active"),
      isNull(products.deletedAt),
    ));

    const [existing] = await db.select({ userId: buyerTasteProfiles.userId })
      .from(buyerTasteProfiles).where(eq(buyerTasteProfiles.userId, myId)).limit(1);
    if (!existing) {
      const picks = pickerLabelsToKeys(styleInterests);
      await db.insert(buyerTasteProfiles).values({
        userId: myId,
        styleTagAffinity: updateAffinityForKeys({}, picks, picks.length * 1.5),
        categoryAffinity: {},
        sellerAffinity: {},
        eventCount: 0,
      }).onConflictDoNothing();
    }

    // Sequential on purpose: each event read-modify-writes the same profile row.
    let applied = 0;
    for (const row of rows) {
      const liked = byId.get(row.id);
      if (liked === undefined) continue;
      await applyEventToProfile(myId, {
        type: liked ? "like" : "skip",
        styleTags: deriveStyleKeys(row),
        category: row.category,
        sellerId: row.ownerId,
      });
      applied += 1;
    }
    res.json({ applied });
  } catch (err) {
    logger.error({ err }, "taste quiz swipes failed");
    res.status(500).json({ error: "Could not save your answers" });
  }
});

export default router;
