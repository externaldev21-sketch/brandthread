/**
 * AI helpers: captions + hashtags, product description from photos, size chart,
 * and an explicit "save result" endpoint.
 *
 * Billing: the credits gate (lib/aiCredits/gate.ts) debits these POST routes
 * before the handler and refunds on any status >= 400, so every early exit
 * below (validation, ai_unavailable, provider failure) is free for the user.
 *
 * Safety: user text is passed to the model as JSON data inside a fixed
 * envelope, images are only read from the caller's own uploads (no URL is
 * fetched), numbers in size charts come from code, and nothing is written to a
 * product or post except through POST /save.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db, posts, products } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { rateLimit } from "../middlewares/rateLimit";
import { evaluateContent } from "../lib/contentModerator";
import { logActivity, reqActor } from "../lib/activityLog";
import {
  AiProviderError,
  AiUnavailableError,
  aiConfigured,
  completeJson,
} from "../lib/aiHelpers/provider";
import { ImageAccessError, isValidObjectPath, loadOwnedImageDataUrl } from "../lib/aiHelpers/images";
import {
  SizeChartInputError,
  buildSizeChart,
  sizeChartInputSchema,
  storedSizeChartSchema,
  toStoredSizeChart,
} from "../lib/aiHelpers/sizeChart";

const router = Router();
router.use(requireAuth);

const UUID = z.string().uuid();
const TONES = ["casual", "bold", "luxury", "playful", "minimal", "professional"] as const;
const clean = (max: number) => z.string().trim().max(max);
const objectPath = z.string().max(400).refine(isValidObjectPath, "Use one of your uploaded images");

// ─── helpers ──────────────────────────────────────────────────────────────────

function callerIds(req: Request): string[] {
  const owner = (req as any).clerkUserId as string;
  const actor = ((req as any).actorClerkId as string | undefined) ?? owner;
  return [...new Set([owner, actor])];
}

function invalid(res: Response, err: z.ZodError): void {
  const issue = err.issues[0];
  res.status(400).json({
    error: issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request",
    code: "VALIDATION_ERROR",
  });
}

/** Stops before any provider work when AI is not configured. */
function requireAi(_req: Request, res: Response, next: NextFunction): void {
  if (!aiConfigured()) {
    res.status(503).json({ error: "AI is not available right now.", code: "ai_unavailable" });
    return;
  }
  next();
}

function handleFailure(req: Request, res: Response, err: unknown): void {
  if (err instanceof ImageAccessError) {
    res.status(err.status).json({ error: err.message, code: "IMAGE_NOT_ALLOWED" });
    return;
  }
  if (err instanceof AiUnavailableError) {
    res.status(503).json({ error: "AI is not available right now.", code: "ai_unavailable" });
    return;
  }
  if (err instanceof AiProviderError) {
    req.log?.warn({ err: err.message }, "AI helper provider failure");
    res.status(502).json({ error: "The AI could not finish that. Try again.", code: "ai_failed" });
    return;
  }
  req.log?.error({ err }, "AI helper failed");
  res.status(500).json({ error: "Something went wrong.", code: "INTERNAL_ERROR" });
}

function safeText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F​-‍⁠﻿]/g, "").replace(/\s+/g, " ").trim();
  return t.length > 0 ? t.slice(0, max) : null;
}

function isPublicSafe(text: string): boolean {
  return evaluateContent(text, "public").action === "allow";
}

// ─── POST /caption ────────────────────────────────────────────────────────────

const captionBody = z
  .object({
    draft: clean(1000).optional(),
    description: clean(500).optional(),
    imagePath: objectPath.optional(),
    tone: z.enum(TONES).default("casual"),
  })
  .strict()
  .refine((b) => Boolean(b.draft || b.description || b.imagePath), { message: "Add a draft, a description or a photo" });

const CAPTION_SYSTEM = [
  "You write social media captions for a fashion and streetwear brand.",
  "Return JSON: {\"captions\": [three different captions], \"hashtags\": [up to 10 relevant hashtags]}.",
  "Each caption is at most 220 characters, sounds human, has no hashtags inside it, and at most one emoji.",
  "If a draft is supplied, keep its meaning and improve it. Match the requested tone.",
  "Hashtags are single words without spaces, no banned or spammy tags, no brand names you were not given.",
].join("\n");

router.post("/caption", requireAi, rateLimit("expensive"), async (req, res): Promise<void> => {
  const parsed = captionBody.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const b = parsed.data;

  const inputText = [b.draft, b.description].filter(Boolean).join(" ");
  if (inputText && evaluateContent(inputText, "public").action === "reject") {
    res.status(422).json({ error: "That text can't be used. Edit it and try again.", code: "CONTENT_REJECTED" });
    return;
  }

  try {
    const images = b.imagePath ? [{ dataUrl: await loadOwnedImageDataUrl(b.imagePath, callerIds(req)) }] : undefined;
    const out = (await completeJson({
      system: CAPTION_SYSTEM,
      data: { draft: b.draft ?? null, description: b.description ?? null, tone: b.tone },
      images,
      maxTokens: 700,
    })) as { captions?: unknown; hashtags?: unknown };

    const captions = (Array.isArray(out.captions) ? out.captions : [])
      .map((c) => safeText(c, 300))
      .filter((c): c is string => Boolean(c) && isPublicSafe(c as string));
    const uniqueCaptions = [...new Set(captions)].slice(0, 3);

    const tags = new Set<string>();
    for (const raw of Array.isArray(out.hashtags) ? out.hashtags : []) {
      const t = typeof raw === "string" ? raw.trim().replace(/^#+/, "") : "";
      if (/^[A-Za-z0-9_]{2,30}$/.test(t) && isPublicSafe(t)) tags.add(`#${t}`);
      if (tags.size >= 10) break;
    }

    if (uniqueCaptions.length < 3 || tags.size === 0) throw new AiProviderError("Incomplete caption result");
    res.json({ captions: uniqueCaptions, hashtags: [...tags] });
  } catch (err) {
    handleFailure(req, res, err);
  }
});

// ─── POST /product-description ────────────────────────────────────────────────

const productDescriptionBody = z
  .object({
    productId: UUID.optional(),
    imagePaths: z.array(objectPath).min(1).max(4).optional(),
    name: clean(120).optional(),
    details: clean(500).optional(),
    tone: z.enum(TONES).default("professional"),
  })
  .strict()
  .refine((b) => Boolean(b.productId) !== Boolean(b.imagePaths), { message: "Send either productId or imagePaths" });

const PRODUCT_SYSTEM = [
  "You write product listings for a fashion and streetwear store from the product photos.",
  "Return JSON: {\"title\": string, \"description\": string, \"bullets\": [3 to 6 strings]}.",
  "Only state what is visible in the photos or given in the data (colour, cut, graphics, details). Never invent materials, sizes, origin, certifications or prices.",
  "title: at most 80 characters. description: 2 to 4 sentences, at most 700 characters. bullets: at most 100 characters each.",
].join("\n");

router.post("/product-description", requireAi, rateLimit("expensive"), async (req, res): Promise<void> => {
  const parsed = productDescriptionBody.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const b = parsed.data;
  const ownerId = (req as any).clerkUserId as string;

  try {
    let paths: string[] = b.imagePaths ?? [];
    let trusted = false;
    let context: Record<string, unknown> = { name: b.name ?? null, details: b.details ?? null };
    if (b.productId) {
      const [product] = await db.select().from(products)
        .where(and(eq(products.id, b.productId), eq(products.ownerId, ownerId), isNull(products.deletedAt))).limit(1);
      if (!product) {
        res.status(404).json({ error: "Product not found", code: "NOT_FOUND" });
        return;
      }
      paths = (product.images ?? []).filter(isValidObjectPath).slice(0, 4);
      trusted = true; // the product belongs to the caller, so do its photos
      context = { name: b.name ?? product.name, category: product.category, details: b.details ?? null };
    }
    if (paths.length === 0) {
      res.status(422).json({ error: "Add a product photo first.", code: "NO_IMAGES" });
      return;
    }

    const ids = callerIds(req);
    const images = await Promise.all(paths.map(async (p) => ({ dataUrl: await loadOwnedImageDataUrl(p, ids, { trusted }) })));
    const out = (await completeJson({
      system: PRODUCT_SYSTEM,
      data: { ...context, tone: b.tone },
      images,
      maxTokens: 900,
    })) as { title?: unknown; description?: unknown; bullets?: unknown };

    const title = safeText(out.title, 120);
    const description = safeText(out.description, 1500);
    const bullets = (Array.isArray(out.bullets) ? out.bullets : [])
      .map((x) => safeText(x, 160))
      .filter((x): x is string => Boolean(x))
      .slice(0, 6);
    if (!title || !description || bullets.length < 3) throw new AiProviderError("Incomplete description");
    if (![title, description, ...bullets].every(isPublicSafe)) throw new AiProviderError("Unsafe output");
    res.json({ title, description, bullets });
  } catch (err) {
    handleFailure(req, res, err);
  }
});

// ─── POST /size-chart ─────────────────────────────────────────────────────────

const SIZE_NOTE_SYSTEM = [
  "You write one short fit note for a size chart of a fashion garment.",
  "Return JSON: {\"note\": string} with at most 160 characters, plain language, no numbers that are not in the data.",
  "Base it on the garment type and the chart. Do not promise exact fit.",
].join("\n");

router.post("/size-chart", requireAi, rateLimit("expensive"), async (req, res): Promise<void> => {
  const parsed = sizeChartInputSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);

  let result;
  try {
    result = buildSizeChart(parsed.data);
  } catch (err) {
    if (err instanceof SizeChartInputError) {
      res.status(400).json({ error: err.message, code: "VALIDATION_ERROR" });
      return;
    }
    return handleFailure(req, res, err);
  }

  try {
    const out = (await completeJson({
      system: SIZE_NOTE_SYSTEM,
      data: { garmentType: parsed.data.garmentType, unit: result.unit, columns: result.columns, rows: result.rows },
      maxTokens: 200,
    })) as { note?: unknown };
    const note = safeText(out.note, 160);
    if (!note || !isPublicSafe(note)) throw new AiProviderError("No fit note");

    const sizeChart = toStoredSizeChart(result, note);
    res.json({
      unit: result.unit,
      rows: result.rows,
      note,
      sizeChart, // same shape app/product-size-chart.tsx saves to products.size_chart
    });
  } catch (err) {
    handleFailure(req, res, err);
  }
});

// ─── POST /save ───────────────────────────────────────────────────────────────
// The only place these results are written. Free (not in AI_TOOL_RULES).

const saveBody = z.union([
  z.object({
    target: z.literal("product"),
    productId: UUID,
    field: z.literal("description"),
    description: z.string().trim().min(1).max(2000),
    overwrite: z.boolean().optional(),
  }).strict(),
  z.object({
    target: z.literal("product"),
    productId: UUID,
    field: z.literal("sizeChart"),
    sizeChart: storedSizeChartSchema,
    overwrite: z.boolean().optional(),
  }).strict(),
  z.object({
    target: z.literal("post"),
    postId: UUID,
    caption: z.string().trim().min(1).max(2200),
    hashtags: z.array(z.string().trim().regex(/^#[A-Za-z0-9_]{2,30}$/)).max(15).optional(),
    overwrite: z.boolean().optional(),
  }).strict(),
]);

/** Product writes need the same role as PUT /api/products/:id. */
function productRoleGate(req: Request, res: Response, next: NextFunction): void {
  if ((req.body as { target?: unknown } | undefined)?.target === "product") {
    void requireRole("manager")(req, res, next);
    return;
  }
  next();
}

router.post("/save", productRoleGate, rateLimit("mutation"), async (req, res): Promise<void> => {
  const parsed = saveBody.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const b = parsed.data;
  const ownerId = (req as any).clerkUserId as string;

  try {
    if (b.target === "product") {
      const [existing] = await db.select().from(products)
        .where(and(eq(products.id, b.productId), eq(products.ownerId, ownerId), isNull(products.deletedAt))).limit(1);
      if (!existing) {
        res.status(404).json({ error: "Product not found", code: "NOT_FOUND" });
        return;
      }
      if (b.field === "description") {
        if (!isPublicSafe(b.description)) {
          res.status(422).json({ error: "That text can't be saved. Edit it and try again.", code: "CONTENT_REJECTED" });
          return;
        }
        if (existing.description?.trim() && !b.overwrite) {
          res.status(409).json({ error: "This product already has a description.", code: "would_overwrite", current: existing.description });
          return;
        }
        await db.update(products).set({ description: b.description, updatedAt: new Date() })
          .where(and(eq(products.id, b.productId), eq(products.ownerId, ownerId)));
      } else {
        const hasChart = Boolean((existing.sizeChart as { columns?: unknown[] } | null)?.columns?.length);
        if (hasChart && !b.overwrite) {
          res.status(409).json({ error: "This product already has a size chart.", code: "would_overwrite", current: existing.sizeChart });
          return;
        }
        if (b.sizeChart.notes && !isPublicSafe(b.sizeChart.notes)) {
          res.status(422).json({ error: "That note can't be saved.", code: "CONTENT_REJECTED" });
          return;
        }
        await db.update(products).set({ sizeChart: b.sizeChart, updatedAt: new Date() })
          .where(and(eq(products.id, b.productId), eq(products.ownerId, ownerId)));
      }
      const actor = reqActor(req);
      void logActivity(actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
        `Saved AI ${b.field === "description" ? "description" : "size chart"} to "${existing.name}"`, "product", existing.id);
      res.json({ saved: true, target: "product", productId: existing.id, field: b.field });
      return;
    }

    // Post caption: posts belong to the person who made them.
    const [post] = await db.select().from(posts).where(and(eq(posts.id, b.postId), eq(posts.userId, ownerId))).limit(1);
    if (!post) {
      res.status(404).json({ error: "Post not found", code: "NOT_FOUND" });
      return;
    }
    const text = [b.caption, ...(b.hashtags ?? [])].join(" ");
    if (evaluateContent(text, "public").action !== "allow") {
      res.status(422).json({ error: "That caption can't be saved. Edit it and try again.", code: "CONTENT_REJECTED" });
      return;
    }
    if (post.caption?.trim() && !b.overwrite) {
      res.status(409).json({ error: "This post already has a caption.", code: "would_overwrite", current: post.caption });
      return;
    }
    await db.update(posts)
      .set({ caption: b.caption, ...(b.hashtags ? { hashtags: b.hashtags } : {}), updatedAt: new Date() })
      .where(and(eq(posts.id, b.postId), eq(posts.userId, ownerId)));
    res.json({ saved: true, target: "post", postId: post.id });
  } catch (err) {
    handleFailure(req, res, err);
  }
});

export default router;
