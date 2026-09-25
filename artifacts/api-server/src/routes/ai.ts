/**
 * Brandthread AI Brain — Server Route
 *
 * Secure proxy between the Expo client and the OpenAI API.
 * API keys never leave the server. Context is validated before forwarding.
 *
 * The /chat endpoint builds a permission-scoped seller snapshot from the
 * verified authentication identity. No client-provided account IDs or
 * business metrics are trusted.
 */

import { Router, type Request, type Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { requireAuth } from "../middlewares/requireAuth";
import { clerkClient } from "@clerk/express";
import { db, products, productVariants, orders, posts, storefronts } from "@workspace/db";
import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";
import { buildSellerSnapshot, type SellerSnapshot } from "../lib/sellerSnapshot";
import { helpDocsForPrompt, matchHelpDocs, type HelpDoc } from "../lib/aiHelpDocs";
import type { Logger } from "pino";

const router = Router();

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_MESSAGES         = 40;
const MAX_PER_MESSAGE_CHARS = 4000;
const MIN_CONTENT_CHARS    = 1;
const CHAT_MODEL           = "gpt-5.4-mini";

// ─── System prompt builder ─────────────────────────────────────────────────────

function buildSystemPrompt(
  snapshot: SellerSnapshot,
  context: Record<string, unknown>,
  brandMemory?: Record<string, string>,
): string {
  const screen = (context?.screen as string) ?? "general";

  const screenContext: Record<string, string> = {
    home:             "The seller is on their Brandthread dashboard home screen.",
    products:         "The seller is browsing their product catalog.",
    product_detail:   `The seller is viewing a specific product: ${JSON.stringify({ name: context.productName, price: context.price, inventory: context.inventory, category: context.category })}`,
    orders:           "The seller is reviewing their orders list.",
    order_detail:     `The seller is viewing order ${context.orderNumber} (status: ${context.status}, customer: ${context.customerName ?? "unknown"}, total: ${context.total ?? "unknown"}).`,
    analytics:        `The seller is on the analytics screen. Selected metric: ${context.metric ?? "overview"}. Date range: ${context.dateRange ?? "last 7 days"}.`,
    store_builder:    `The seller is in the Store Builder. Current section: ${context.sectionId ?? "homepage"}. Page: ${context.pageName ?? "homepage"}.`,
    design_studio:    `The seller is in the Design Studio. Project: ${context.projectName ?? "new project"}. Garment: ${context.garmentType ?? "unknown"}.`,
    content:          "The seller is in the Content Creator.",
    inventory:        `The seller is managing inventory. Current item: ${context.itemName ?? "none selected"}.`,
    manufacturer_hub: `The seller is in the Manufacturer Hub. Manufacturer: ${context.manufacturerName ?? "none selected"}.`,
    marketing:        `The seller is in Marketing. Campaign: ${context.campaignName ?? "none selected"}.`,
    customers:        `The seller is in the Customers section. Viewing: ${context.customerName ?? "all customers"}. Segment: ${context.segment ?? "all"}.`,
    settings:         "The seller is in Settings.",
  };

  const screenNote = screenContext[screen] ?? "The seller is using Brandthread.";

  const brandSection = brandMemory && Object.keys(brandMemory).length > 0
    ? `\n\nBrand memory (personalise advice accordingly):\n${Object.entries(brandMemory).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`
    : "";

  // Compact JSON snapshot — null values are preserved to signal unavailability
  const snapshotJson = JSON.stringify(snapshot, null, 0);

  return [
    "You are Brandthread AI — an intelligent business assistant embedded in the Brandthread seller platform.",
    "You have access to a verified, real-time snapshot of this seller's account. Answer questions from this snapshot.",
    "",
    "Core rules:",
    "1. Answer factual questions about the seller's account using ONLY the verified snapshot below. Never invent or estimate numbers.",
    "2. When snapshot data for a field is null, say explicitly that the data is unavailable — do not guess.",
    "3. Clearly distinguish between observed data (from the snapshot) and your suggestions/recommendations.",
    "4. Label all estimates, projections, or advice as such (e.g. 'Based on industry averages...').",
    "5. Never reveal customer names, emails, addresses, or any PII from the snapshot.",
    "6. Never automatically perform destructive actions (price changes, order cancellations, refunds, publishing, campaigns).",
    "7. If asked about data outside the snapshot scope (e.g. competitor data, future projections), say so clearly.",
    "8. Revenue figures in the snapshot are gross paid order totals only — always note this when discussing revenue.",
    "",
    `Current screen context: ${screenNote}${brandSection}`,
    "",
    `Verified account snapshot (snapshotAt: ${snapshot.snapshotAt}):`,
    "```json",
    snapshotJson,
    "```",
    "",
    "How Brandthread features work (reference material — use this to explain how-to questions, never as account data):",
    helpDocsForPrompt(),
    "",
    "If you want to suggest a structured action the user can approve, include a JSON block at the end of your response in this exact format:",
    "```json:action",
    '{"type":"edit","title":"Short action title","description":"One sentence description","impact":"Expected result","requiresConfirmation":false,"isDestructive":false,"canUndo":true,"payload":{}}',
    "```",
    "Only include the action block when there is a clear, specific action to take. For general advice or data questions, omit it.",
  ].join("\n");
}

// ─── Input validation ──────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function validateAndSanitizeMessages(
  raw: unknown,
): { messages: ChatMessage[]; error?: undefined } | { messages?: undefined; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "messages array is required." };
  }
  if (raw.length > MAX_MESSAGES) {
    return { error: `Too many messages. Maximum is ${MAX_MESSAGES}.` };
  }

  const safe: ChatMessage[] = [];
  for (const m of raw) {
    if (typeof m !== "object" || m === null) continue;
    const role = (m as Record<string, unknown>).role;
    const content = (m as Record<string, unknown>).content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    safe.push({
      role: role as "user" | "assistant",
      content: content.slice(0, MAX_PER_MESSAGE_CHARS),
    });
  }

  if (safe.length === 0) {
    return { error: "No valid messages provided." };
  }

  // Verify the last user message is not blank
  const lastUser = [...safe].reverse().find(m => m.role === "user");
  if (!lastUser || lastUser.content.trim().length < MIN_CONTENT_CHARS) {
    return { error: "Message content cannot be blank." };
  }

  // Preserve turn order — take last MAX_MESSAGES safe messages
  return { messages: safe.slice(-MAX_MESSAGES) };
}

// ─── POST /api/ai/chat ─────────────────────────────────────────────────────────

router.post("/chat", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { clerkUserId?: string }).clerkUserId!;
  const log = (req as Request & { log?: Logger }).log;

  // Request-correlated diagnostics — never log message content or PII
  const reqId = (req as Request & { id?: string }).id ?? "unknown";
  log?.info({ reqId, userId: "[redacted]", route: "POST /api/ai/chat" }, "ai.chat.start");

  const { messages: rawMessages, context, brandMemory, maxTokens } = req.body as {
    messages?: unknown;
    context?: Record<string, unknown>;
    brandMemory?: Record<string, string>;
    maxTokens?: number;
  };

  // Validate messages before any expensive operations
  const validation = validateAndSanitizeMessages(rawMessages);
  if (validation.error) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const safeMessages = validation.messages!;

  // Build a fresh, permission-scoped snapshot from the verified user identity.
  // This is the only source of account data — client-provided IDs are ignored.
  let snapshot: SellerSnapshot;
  try {
    snapshot = await buildSellerSnapshot(userId);
    log?.info({ reqId, snapshotAt: snapshot.snapshotAt }, "ai.chat.snapshot_built");
  } catch (snapshotErr) {
    log?.error({ reqId, err: snapshotErr }, "ai.chat.snapshot_error");
    // Safe fallback: proceed with a minimal null snapshot rather than exposing
    // the error details. The model will report data as unavailable.
    snapshot = {
      snapshotAt: new Date().toISOString(),
      seller: null,
      storefront: null,
      products: { totalActive: 0, totalDraft: 0, recent: [] },
      inventory: { totalVariants: 0, outOfStock: 0, lowStock: 0, lowStockItems: [] },
      orders: { recentOrders: [], pendingCount: 0, processingCount: 0, fulfilledCount: 0, cancelledCount: 0, oldestUnfulfilledHoursAgo: null },
      revenue: { allTimeGrossCents: null, last30DaysGrossCents: null, last7DaysGrossCents: null, last30DaysOrderCount: null, currency: "USD", note: "Revenue data temporarily unavailable." },
      content: { publishedPosts: 0, draftPosts: 0, scheduledCount: 0, recentPublished: [] },
      customers: { totalCustomers: 0, avgOrdersPerCustomer: null, avgSpentCents: null, topSpendBracket: null },
      conversations: { totalUnread: 0, activeConversationCount: 0, recentConversations: [] },
      boosts: { activeBoosts: null, totalBudgetCents: null, totalSpentCents: null, available: false },
      manufacturerOrders: { pendingQuotes: null, activeRelationships: null, recentRequests: [], available: false },
      discountCodes: { activeCodes: 0, totalCodes: 0 },
      shipping: { activeRateCount: 0, totalRateCount: 0, hasFreeShippingThreshold: false },
    };
  }

  const systemPrompt = buildSystemPrompt(snapshot, context ?? {}, brandMemory);

  try {
    const completion = await openai.chat.completions.create({
      model:                 CHAT_MODEL,
      messages:              [{ role: "system", content: systemPrompt }, ...safeMessages],
      max_completion_tokens: Math.min(maxTokens ?? 700, 1500),
    });

    const raw = completion.choices[0]?.message?.content ?? "";

    // Extract optional structured action card
    const cardMatch = raw.match(/```json:action\n([\s\S]*?)\n```/);
    let actionCard: Record<string, unknown> | undefined;
    if (cardMatch) {
      try {
        actionCard = JSON.parse(cardMatch[1]) as Record<string, unknown>;
      } catch { /* ignore malformed action */ }
    }

    const content = raw.replace(/```json:action\n[\s\S]*?\n```/g, "").trim();

    log?.info({ reqId, tokensUsed: completion.usage?.total_tokens }, "ai.chat.success");

    const lastUserMessage = [...safeMessages].reverse().find(m => m.role === "user")?.content ?? "";
    const sources = matchHelpDocs(lastUserMessage).map(d => ({ title: d.title, route: d.route }));

    res.json({
      content,
      actionCard,
      sources,
      tokensUsed: completion.usage?.total_tokens,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    log?.error({ reqId, status: e?.status }, "ai.chat.provider_error");

    if (e?.status === 429) {
      res.status(429).json({ error: "AI provider rate limit reached. Please try again shortly." });
    } else {
      res.status(503).json({ error: "AI service temporarily unavailable." });
    }
  }
});

// ─── POST /api/ai/chat/stream ───────────────────────────────────────────────
// Server-Sent Events variant of /chat. Same auth, validation, and
// seller-scoped snapshot — only the transport differs, so a client can
// render tokens as they arrive instead of waiting for the full reply.
// Emits: {type:"delta", content} per token, then one final
// {type:"done", content, actionCard?, sources} with the matched help-doc
// links, then the stream closes.

function writeSse(res: Response, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

router.post("/chat/stream", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { clerkUserId?: string }).clerkUserId!;
  const log = (req as Request & { log?: Logger }).log;
  const reqId = (req as Request & { id?: string }).id ?? "unknown";

  const { messages: rawMessages, context, brandMemory, maxTokens } = req.body as {
    messages?: unknown;
    context?: Record<string, unknown>;
    brandMemory?: Record<string, string>;
    maxTokens?: number;
  };

  const validation = validateAndSanitizeMessages(rawMessages);
  if (validation.error) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const safeMessages = validation.messages!;
  const lastUserMessage = [...safeMessages].reverse().find(m => m.role === "user")?.content ?? "";
  const sources: HelpDoc[] = matchHelpDocs(lastUserMessage);

  let snapshot: SellerSnapshot;
  try {
    snapshot = await buildSellerSnapshot(userId);
  } catch (snapshotErr) {
    log?.error({ reqId, err: snapshotErr }, "ai.chat.stream.snapshot_error");
    res.status(503).json({ error: "AI service temporarily unavailable." });
    return;
  }

  const systemPrompt = buildSystemPrompt(snapshot, context ?? {}, brandMemory);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let full = "";
  let closed = false;
  req.on("close", () => { closed = true; });

  try {
    const stream = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...safeMessages],
      max_completion_tokens: Math.min(maxTokens ?? 700, 1500),
      stream: true,
    });

    for await (const chunk of stream) {
      if (closed) break;
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        full += delta;
        writeSse(res, { type: "delta", content: delta });
      }
    }

    if (!closed) {
      const cardMatch = full.match(/```json:action\n([\s\S]*?)\n```/);
      let actionCard: Record<string, unknown> | undefined;
      if (cardMatch) {
        try { actionCard = JSON.parse(cardMatch[1]) as Record<string, unknown>; } catch { /* ignore malformed action */ }
      }
      const content = full.replace(/```json:action\n[\s\S]*?\n```/g, "").trim();
      writeSse(res, {
        type: "done",
        content,
        actionCard,
        sources: sources.map(d => ({ title: d.title, route: d.route })),
      });
      res.end();
    }
  } catch (err: unknown) {
    const e = err as { status?: number };
    log?.error({ reqId, status: e?.status }, "ai.chat.stream.provider_error");
    if (!closed) {
      writeSse(res, {
        type: "error",
        error: e?.status === 429
          ? "AI provider rate limit reached. Please try again shortly."
          : "AI service temporarily unavailable.",
      });
      res.end();
    }
  }
});

// ─── POST /api/ai/brand-memory/rebuild ────────────────────────────────────────
// Derives a brand voice profile from the seller's real DB data (products, posts, store).

router.post("/brand-memory/rebuild", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const ownerId: string = (req as any).clerkUserId as string;

  // Gather context from DB in parallel
  const [sellerProducts, sellerPosts, sellerStore] = await Promise.allSettled([
    db.select({
      name: products.name,
      description: products.description,
      priceCents: sql<number | null>`min(${productVariants.priceCents})`,
      category: products.category,
    })
      .from(products)
      .leftJoin(productVariants, eq(productVariants.productId, products.id))
      .where(eq(products.ownerId, ownerId))
      .groupBy(products.id)
      .limit(20),
    db.select({ caption: posts.caption, mediaType: posts.mediaType, createdAt: posts.createdAt })
      .from(posts).where(eq(posts.userId, ownerId)).orderBy(desc(posts.createdAt)).limit(15),
    db.select({ title: storefronts.title, subtitle: storefronts.subtitle, description: storefronts.description, branding: storefronts.branding })
      .from(storefronts).where(eq(storefronts.ownerId, ownerId)).limit(1),
  ]);

  const productList = sellerProducts.status === "fulfilled" ? sellerProducts.value : [];
  const postList    = sellerPosts.status === "fulfilled" ? sellerPosts.value : [];
  const storeData   = sellerStore.status === "fulfilled" ? sellerStore.value[0] : null;

  const prompt = [
    "You are analyzing a fashion/streetwear brand's data to derive their brand voice and identity profile.",
    "",
    storeData ? `Store: "${storeData.title ?? ""}" — ${storeData.subtitle ?? ""} — ${storeData.description ?? ""}` : "",
    productList.length > 0
      ? `Products (${productList.length}): ${productList.map(p => `${p.name} ($${((p.priceCents ?? 0) / 100).toFixed(0)}) — ${(p.description ?? "").slice(0, 80)}`).join("; ")}`
      : "No products yet.",
    postList.length > 0
      ? `Recent captions: ${postList.map(p => `"${(p.caption ?? "").slice(0, 100)}"`).join("; ")}`
      : "No posts yet.",
    "",
    "Based on this data, fill in the following brand profile fields. For any field where there's insufficient data, make a reasonable inference. Respond ONLY with valid JSON:",
    '{"brandDescription":"","brandVoice":"","targetAudience":"","pricePosition":"","visualStyle":"","marketingTone":"","preferredWords":"","productCategories":""}',
  ].filter(Boolean).join("\n");

  try {
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 600,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const fields = JSON.parse(raw) as Record<string, string>;
    res.json({ fields });
  } catch {
    res.status(503).json({ error: "AI service temporarily unavailable." });
  }
});

// ─── GET /api/ai/suggestions ───────────────────────────────────────────────────
// Returns real proactive suggestions derived from the seller's live data.

router.get("/suggestions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const ownerId: string = (req as any).clerkUserId as string;

  const suggestions: Array<{
    id: string; title: string; reason: string; expectedImpact: string;
    actionLabel: string; actionRoute: string; category: string; priority: string;
  }> = [];

  try {
    // ── Low inventory variants ───────────────────────────────────────────────
    const lowStock = await db
      .select({
        sku:               productVariants.sku,
        stock:             productVariants.stock,
        lowStockThreshold: productVariants.lowStockThreshold,
        size:              productVariants.size,
        color:             productVariants.color,
        productName:       products.name,
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(
        eq(products.ownerId, ownerId),
        sql`${productVariants.stock} <= ${productVariants.lowStockThreshold}`,
      ))
      .limit(3);

    for (const v of lowStock) {
      const label = [v.size, v.color].filter(Boolean).join(" / ");
      const isOut = v.stock === 0;
      suggestions.push({
        id:             `sug_stock_${v.sku ?? v.productName}`,
        title:          isOut ? `${v.productName}${label ? ` (${label})` : ""} is out of stock` : `Low stock: ${v.productName}${label ? ` (${label})` : ""}`,
        reason:         isOut
          ? `This variant has 0 units left. Buyers who visit the product page will see it as sold out.`
          : `Only ${v.stock} units remaining (threshold: ${v.lowStockThreshold ?? 5}). At current velocity, stock may deplete within days.`,
        expectedImpact: isOut ? "Prevents ongoing missed revenue from visitors" : `Reordering now prevents ~${(v.stock ?? 0) * 2} lost sales`,
        actionLabel:    "View inventory",
        actionRoute:    "/inventory",
        category:       "inventory",
        priority:       isOut ? "urgent" : "high",
      });
    }

    // ── Unfulfilled orders ───────────────────────────────────────────────────
    const unfulfilledOrders = await db
      .select({ id: orders.id, status: orders.status, createdAt: orders.createdAt })
      .from(orders)
      .where(and(
        eq(orders.ownerId, ownerId),
        inArray(orders.status, ["pending", "processing"]),
      ))
      .orderBy(asc(orders.createdAt))
      .limit(10);

    if (unfulfilledOrders.length > 0) {
      const oldestHours = Math.floor(
        (Date.now() - new Date(unfulfilledOrders[0].createdAt).getTime()) / (1000 * 60 * 60),
      );
      suggestions.push({
        id:             "sug_ship_unfulfilled",
        title:          `${unfulfilledOrders.length} order${unfulfilledOrders.length > 1 ? "s" : ""} awaiting fulfilment`,
        reason:         `${unfulfilledOrders.length > 1 ? `${unfulfilledOrders.length} paid orders are` : "A paid order is"} awaiting fulfilment. The oldest has been waiting ${oldestHours} hour${oldestHours !== 1 ? "s" : ""}.`,
        expectedImpact: "Fulfilling today protects your seller rating and customer satisfaction",
        actionLabel:    "View orders",
        actionRoute:    "/(tabs)/orders",
        category:       "orders",
        priority:       oldestHours > 24 ? "urgent" : "high",
      });
    }

    // ── Underperforming posts ────────────────────────────────────────────────
    const recentPosts = await db
      .select({ id: posts.id, caption: posts.caption, createdAt: posts.createdAt })
      .from(posts)
      .where(eq(posts.userId, ownerId))
      .orderBy(desc(posts.createdAt))
      .limit(5);

    // Flag posts with no caption (easy win for engagement)
    const noCaptionPosts = recentPosts.filter(p => !p.caption?.trim());
    if (noCaptionPosts.length > 0) {
      suggestions.push({
        id:             "sug_caption_missing",
        title:          `${noCaptionPosts.length} recent post${noCaptionPosts.length > 1 ? "s" : ""} with no caption`,
        reason:         "Posts without captions get significantly less engagement. A well-written caption can increase saves and profile visits.",
        expectedImpact: "Captioned posts typically see 2–3× more engagement",
        actionLabel:    "Create content",
        actionRoute:    "/create-post",
        category:       "content",
        priority:       "medium",
      });
    }

    // If seller has very few posts, suggest creating content
    if (recentPosts.length === 0) {
      suggestions.push({
        id:             "sug_no_content",
        title:          "Start posting to grow your audience",
        reason:         "You haven't posted any content yet. Thread posts are your primary discovery channel on Brandthread.",
        expectedImpact: "Sellers with 5+ posts see 3× more profile visits",
        actionLabel:    "Create first post",
        actionRoute:    "/create-post",
        category:       "content",
        priority:       "high",
      });
    }
  } catch (err) {
    // Return empty array on DB error — client falls back to demo
    res.json({ suggestions: [] });
    return;
  }

  res.json({ suggestions });
});

// ─── GET /api/seller/sessions ─────────────────────────────────────────────────
// Returns recent Clerk sessions (login activity) for the authenticated seller.

router.get("/sessions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const ownerId: string = (req as any).clerkUserId as string;

  try {
    const sessionList = await clerkClient.sessions.getSessionList({ userId: ownerId, limit: 20 });
    const sessions = sessionList.data.map((s) => ({
      id:           s.id,
      status:       s.status,
      createdAt:    s.createdAt,
      lastActiveAt: s.lastActiveAt,
      expireAt:     s.expireAt,
      clientId:     s.clientId,
    }));
    res.json({ sessions });
  } catch {
    res.status(503).json({ error: "Could not retrieve sessions." });
  }
});

export default router;
