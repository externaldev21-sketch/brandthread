/**
 * Brandthread AI Brain — Server Route
 *
 * Secure proxy between the Expo client and the OpenAI API.
 * API keys never leave the server. Context is validated before forwarding.
 */

import { Router, type Request, type Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { requireAuth } from "../middlewares/requireAuth";
import { clerkClient } from "@clerk/express";
import { db, products, productVariants, orders, posts, storefronts } from "@workspace/db";
import { eq, lt, lte, and, desc, sql } from "drizzle-orm";

const router = Router();

// Simple per-user rate limiter
const userHits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS      = 60_000;
const MAX_PER_WINDOW = 30;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const rec = userHits.get(userId);
  if (!rec || now >= rec.resetAt) {
    userHits.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (rec.count >= MAX_PER_WINDOW) return false;
  rec.count += 1;
  return true;
}

// ─── System prompt builder ─────────────────────────────────────────────────────

function buildSystemPrompt(context: Record<string, unknown>, brandMemory?: Record<string, string>): string {
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

  const brandSection = brandMemory && Object.keys(brandMemory).length > 0
    ? `\n\nBrand memory (use this to personalise all advice):\n${Object.entries(brandMemory).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`
    : "";

  const screenNote = screenContext[screen] ?? "The seller is using Brandthread.";

  return [
    "You are Brandthread AI — an intelligent, embedded business assistant for independent fashion brands.",
    "You are not a generic chatbot. You understand fashion brand operations, streetwear, premium basics, direct-to-consumer commerce, content creation, manufacturing, and retail analytics.",
    "",
    "Principles:",
    "- Be direct and specific. No filler text.",
    "- Give data-grounded advice. When data is unavailable, say so clearly.",
    "- Never automatically perform destructive actions (price changes, order cancellations, refunds, publishing, sending campaigns).",
    "- Separate advice from suggested actions. Label estimates clearly as estimates.",
    "- When suggesting a storefront, product, or copy change, offer a before/after preview.",
    "- Match the brand voice in the brand memory if provided.",
    "",
    `Current context: ${screenNote}${brandSection}`,
    "",
    "If you want to suggest a structured action the user can approve, include a JSON block at the end of your response in this exact format:",
    "```json:action",
    '{"type":"edit","title":"Short action title","description":"One sentence description","impact":"Expected result","requiresConfirmation":false,"isDestructive":false,"canUndo":true,"payload":{}}',
    "```",
    "Only include the action block when there is a clear, specific action to take. For general advice, omit it.",
  ].join("\n");
}

// ─── POST /api/ai/chat ─────────────────────────────────────────────────────────

router.post("/chat", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId: string = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "anon";

  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "Rate limit reached — please wait a moment." });
    return;
  }

  const { messages, context, brandMemory, maxTokens } = req.body as {
    messages?: { role: string; content: string }[];
    context?: Record<string, unknown>;
    brandMemory?: Record<string, string>;
    maxTokens?: number;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required." });
    return;
  }

  // Validate message roles — only allow user and assistant in history
  const safeMessages = messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .slice(-20)
    .map(m => ({
      role: m.role as "user" | "assistant",
      content: String(m.content).slice(0, 4000), // cap per-message length
    }));

  const systemPrompt = buildSystemPrompt(context ?? {}, brandMemory);

  try {
    const completion = await openai.chat.completions.create({
      model:       "gpt-4o-mini",
      messages:    [{ role: "system", content: systemPrompt }, ...safeMessages],
      max_tokens:  Math.min(maxTokens ?? 700, 1500),
      temperature: 0.7,
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

    res.json({
      content,
      actionCard,
      tokensUsed: completion.usage?.total_tokens,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e?.status === 429) {
      res.status(429).json({ error: "AI provider rate limit reached. Please try again shortly." });
    } else {
      // Return an error payload — client falls back to demo mode
      res.status(503).json({ error: "AI service temporarily unavailable." });
    }
  }
});

// ─── POST /api/ai/brand-memory/rebuild ────────────────────────────────────────
// Derives a brand voice profile from the seller's real DB data (products, posts, store).

router.post("/brand-memory/rebuild", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const ownerId: string = (req as any).clerkUserId as string;

  // Gather context from DB in parallel
  const [sellerProducts, sellerPosts, sellerStore] = await Promise.allSettled([
    db.select({ name: products.name, description: products.description, priceCents: products.priceCents, category: products.category })
      .from(products).where(eq(products.ownerId, ownerId)).limit(20),
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
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 600,
      temperature: 0.5,
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
      .where(and(eq(orders.sellerId, ownerId), eq(orders.status, "paid")))
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
