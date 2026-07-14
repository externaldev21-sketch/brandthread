/**
 * Brandthread AI Brain — Server Route
 *
 * Secure proxy between the Expo client and the OpenAI API.
 * API keys never leave the server. Context is validated before forwarding.
 */

import { Router, type Request, type Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { requireAuth } from "../middlewares/requireAuth";

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

export default router;
