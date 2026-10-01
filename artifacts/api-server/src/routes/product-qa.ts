/**
 * Product Q&A — public questions on a product page, answered by its seller.
 *
 * GET    /api/product-qa/product/:productId   public: published questions + seller answers
 * POST   /api/product-qa/product/:productId   signed-in buyer asks (rate-limited, length/moderation checked)
 * DELETE /api/product-qa/questions/:id        asker removes their own question
 * GET    /api/product-qa/seller               seller inbox: questions on my products (?status=unanswered)
 * POST   /api/product-qa/questions/:id/answer seller answers (or edits the answer to) a question on their own product
 *
 * Signed-out visitors can read; every write needs a signed-in account. The
 * seller is always derived from products.owner_id server-side — never taken
 * from the request. A new question notifies the seller; an answer notifies the
 * asker (Activity feed + push through publishNotification).
 */
import { Router } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, products, productQuestions, productAnswers } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { logger } from "../lib/logger";
import { isBlockedEitherWay, optionalViewerId, profilesById } from "../lib/safety";
import { publishNotification } from "./notifications-feed";
import {
  QUESTIONS_PER_DAY, QUESTIONS_PER_PRODUCT_PER_DAY, canAnswerQuestion, checkAnswer, checkQuestion,
} from "../lib/productQa";
import { parsePagination } from "../lib/pagination";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Jordan Miller" -> "Jordan M." — Q&A is public, so askers show a short name. */
export function shortAskerName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Brandthread buyer";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

type QuestionRow = typeof productQuestions.$inferSelect;
type AnswerRow = typeof productAnswers.$inferSelect;

async function hydrate(rows: QuestionRow[], viewerId: string | null) {
  if (rows.length === 0) return [];
  const answers = await db.select().from(productAnswers)
    .where(inArray(productAnswers.questionId, rows.map((r) => r.id)));
  const byQuestion = new Map<string, AnswerRow>(answers.map((a) => [a.questionId, a]));
  const profiles = await profilesById(rows.map((r) => r.askerId));
  return rows.map((q) => {
    const a = byQuestion.get(q.id);
    return {
      id: q.id,
      productId: q.productId,
      body: q.body,
      askerName: shortAskerName(profiles.get(q.askerId)?.name),
      createdAt: q.createdAt,
      mine: !!viewerId && viewerId === q.askerId,
      answer: a ? { id: a.id, body: a.body, createdAt: a.createdAt, updatedAt: a.updatedAt } : null,
    };
  });
}

// ─── Public: questions for a product ─────────────────────────────────────────
router.get("/product/:productId", async (req, res) => {
  const productId = req.params.productId as string;
  if (!UUID_RE.test(productId)) return res.json({ questions: [], totalCount: 0 });
  const page = parsePagination(req.query, { limit: 30 });
  if (!page.success) return res.status(400).json({ error: "Invalid pagination", code: "VALIDATION_ERROR" });
  const { limit, offset } = page.data;
  const where = and(eq(productQuestions.productId, productId), eq(productQuestions.status, "published"));
  const [rows, [agg]] = await Promise.all([
    db.select().from(productQuestions).where(where)
      .orderBy(desc(productQuestions.createdAt)).limit(limit).offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(productQuestions).where(where),
  ]);
  return res.json({ questions: await hydrate(rows, optionalViewerId(req)), totalCount: Number(agg?.n ?? 0) });
});

// ─── Buyer: ask a question ───────────────────────────────────────────────────
router.post("/product/:productId", requireAuth, rateLimit("comment"), async (req, res) => {
  const askerId = (req as any).clerkUserId as string;
  const productId = req.params.productId as string;
  if (!UUID_RE.test(productId)) return res.status(404).json({ error: "Product not found" });

  const check = checkQuestion((req.body as { body?: unknown })?.body);
  if (!check.ok) return res.status(400).json({ error: check.error });

  const [product] = await db
    .select({ id: products.id, ownerId: products.ownerId, name: products.name, images: products.images })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.status, "active"), isNull(products.deletedAt)))
    .limit(1);
  if (!product) return res.status(404).json({ error: "Product not found" });
  if (product.ownerId === askerId) return res.status(400).json({ error: "You can't ask a question on your own product." });
  if (await isBlockedEitherWay(askerId, product.ownerId)) {
    return res.status(403).json({ error: "You can't ask this seller a question." });
  }

  // Simple abuse limits on top of the request rate limit.
  const [recent] = (await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE product_id = ${productId})::int AS on_product
    FROM   product_questions
    WHERE  asker_id = ${askerId} AND created_at > now() - interval '24 hours'
  `)).rows as Array<{ total: number; on_product: number }>;
  if ((recent?.total ?? 0) >= QUESTIONS_PER_DAY || (recent?.on_product ?? 0) >= QUESTIONS_PER_PRODUCT_PER_DAY) {
    return res.status(429).json({ error: "You've asked a lot of questions today. Try again tomorrow." });
  }

  const [row] = await db.insert(productQuestions)
    .values({ productId, sellerId: product.ownerId, askerId, body: check.text })
    .returning();

  try {
    const profile = (await profilesById([askerId])).get(askerId);
    await publishNotification({
      userId: product.ownerId,
      category: "social",
      type: "product_question",
      title: "New question on your product",
      body: `${shortAskerName(profile?.name)} asked about ${product.name}: ${check.text.slice(0, 120)}`,
      targetId: productId,
      targetType: "product_question",
      actorId: askerId,
      targetImageUrl: Array.isArray(product.images) && typeof product.images[0] === "string" && !product.images[0].startsWith("/objects/")
        ? product.images[0] : null,
    });
  } catch (err) {
    logger.warn({ err, questionId: row.id }, "Product question notification failed");
  }

  return res.status(201).json((await hydrate([row], askerId))[0]);
});

// ─── Buyer: delete own question ──────────────────────────────────────────────
router.delete("/questions/:id", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Question not found" });
  const deleted = await db.delete(productQuestions)
    .where(and(eq(productQuestions.id, id), eq(productQuestions.askerId, userId)))
    .returning({ id: productQuestions.id });
  if (deleted.length === 0) return res.status(404).json({ error: "Question not found" });
  return res.json({ ok: true });
});

// ─── Seller: inbox of questions on my products ───────────────────────────────
router.get("/seller", requireAuth, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const unansweredOnly = req.query.status === "unanswered";
  const rows = (await db.execute(sql`
    SELECT q.id, q.product_id, q.body, q.asker_id, q.created_at, p.name AS product_name,
           a.id AS answer_id, a.body AS answer_body, a.created_at AS answer_created_at
    FROM   product_questions q
    JOIN   products p ON p.id = q.product_id
    LEFT JOIN product_answers a ON a.question_id = q.id
    WHERE  q.seller_id = ${sellerId}
      AND  q.status = 'published'
      ${unansweredOnly ? sql`AND a.id IS NULL` : sql``}
    ORDER  BY (a.id IS NULL) DESC, q.created_at DESC
    LIMIT  100
  `)).rows as Array<Record<string, any>>;
  const profiles = await profilesById(rows.map((r) => r.asker_id));
  const unanswered = rows.filter((r) => !r.answer_id).length;
  return res.json({
    unansweredCount: unanswered,
    questions: rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      body: r.body,
      askerName: shortAskerName(profiles.get(r.asker_id)?.name),
      createdAt: r.created_at,
      answer: r.answer_id ? { id: r.answer_id, body: r.answer_body, createdAt: r.answer_created_at } : null,
    })),
  });
});

// ─── Seller: answer a question on their own product ──────────────────────────
router.post("/questions/:id/answer", requireAuth, rateLimit("comment"), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Question not found" });

  const check = checkAnswer((req.body as { body?: unknown })?.body);
  if (!check.ok) return res.status(400).json({ error: check.error });

  const [question] = await db
    .select({
      id: productQuestions.id, productId: productQuestions.productId, askerId: productQuestions.askerId,
      status: productQuestions.status, productName: products.name, ownerId: products.ownerId,
    })
    .from(productQuestions)
    .innerJoin(products, eq(products.id, productQuestions.productId))
    .where(eq(productQuestions.id, id))
    .limit(1);
  if (!question || question.status !== "published") return res.status(404).json({ error: "Question not found" });
  // Authorization follows the product's current owner, not the stored copy.
  if (!canAnswerQuestion(question.ownerId, userId)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db.select({ id: productAnswers.id }).from(productAnswers)
    .where(eq(productAnswers.questionId, id)).limit(1);
  const now = new Date();
  const [answer] = await db.insert(productAnswers)
    .values({ questionId: id, sellerId: userId, body: check.text })
    .onConflictDoUpdate({
      target: productAnswers.questionId,
      set: { body: check.text, updatedAt: now },
    })
    .returning();

  // Only the first answer notifies the asker; later edits are silent.
  if (!existing) {
    try {
      await publishNotification({
        userId: question.askerId,
        category: "social",
        type: "product_answer",
        title: "Your question was answered",
        body: `The seller answered your question about ${question.productName}.`,
        targetId: question.productId,
        targetType: "product",
        actorId: userId,
      });
    } catch (err) {
      logger.warn({ err, questionId: id }, "Product answer notification failed");
    }
  }

  return res.json({ id: answer.id, body: answer.body, createdAt: answer.createdAt, updatedAt: answer.updatedAt });
});

export default router;
