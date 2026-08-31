/**
 * Brandthread AI Support Chat — account-aware customer support chatbot.
 *
 * POST /api/support-chat/message   — send a message, get AI reply
 * POST /api/support-chat/escalate  — escalate to human support (creates a ticket)
 *
 * Pulls real seller/buyer data to answer account-specific questions.
 * PII rules: last-4 bank digits only, never full account/routing numbers.
 */
import { Router, type Request, type Response } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { requireAuth } from "../middlewares/requireAuth";
import { db, users, products, orders, drops, dropWallets, dropWalletTransactions } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

// ─── Context fetcher ──────────────────────────────────────────────────────────
async function buildUserContext(clerkId: string): Promise<{ role: string; summary: string }> {
  try {
    const [user] = await db
      .select({
        displayName:        users.displayName,
        brandName:          users.brandName,
        subscriptionStatus: users.subscriptionStatus,
        subscriptionPlanId: users.subscriptionPlanId,
        verified:           users.verified,
        verificationStatus: users.verificationStatus,
      })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    if (!user) return { role: "unknown", summary: "User account not found." };

    // Detect role: seller if they have products or a brand name
    const [sellerProducts, buyerOrders, sellerOrders] = await Promise.all([
      db.select({
        name:       products.name,
        status:     products.status,
        category:   products.category,
        priceCents: (products as any).priceCents,
      })
        .from(products)
        .where(eq(products.ownerId, clerkId))
        .limit(12),

      db.select({
        id:          orders.id,
        orderNumber: orders.orderNumber,
        status:      orders.status,
        totalCents:  orders.totalCents,
        createdAt:   orders.createdAt,
      })
        .from(orders)
        .where(eq((orders as any).buyerId, clerkId))
        .orderBy(desc(orders.createdAt))
        .limit(10)
        .catch(() => [] as any[]),

      db.select({
        id:          orders.id,
        orderNumber: orders.orderNumber,
        status:      orders.status,
        totalCents:  orders.totalCents,
        createdAt:   orders.createdAt,
        payoutStatus: (orders as any).payoutStatus,
      })
        .from(orders)
        .where(eq(orders.ownerId, clerkId))
        .orderBy(desc(orders.createdAt))
        .limit(15),
    ]);

    const isSeller = sellerProducts.length > 0 || !!user.brandName;

    // ── Seller context ─────────────────────────────────────────────────────────
    if (isSeller) {
      // Drop wallet balances
      const walletRows = await db.execute(sql`
        SELECT dw.drop_id, dw.balance_cents, dw.held_cents, dw.released_cents,
               d.title as drop_title, d.release_at
        FROM   drop_wallets dw
        JOIN   drops d ON d.id = dw.drop_id
        WHERE  d.owner_id = ${clerkId}
        ORDER  BY d.release_at DESC
        LIMIT  5
      `).catch(() => ({ rows: [] as any[] }));

      const wallets = walletRows.rows as Array<{
        drop_id: string; balance_cents: number; held_cents: number;
        released_cents: number; drop_title: string;
      }>;

      const totalHeld     = wallets.reduce((s, w) => s + Number(w.held_cents ?? 0), 0);
      const totalBalance  = wallets.reduce((s, w) => s + Number(w.balance_cents ?? 0), 0);
      const totalReleased = wallets.reduce((s, w) => s + Number(w.released_cents ?? 0), 0);

      // Recent transactions
      const txRows = await db.execute(sql`
        SELECT dwt.type, dwt.amount_cents, dwt.description, dwt.created_at,
               d.title as drop_title
        FROM   drop_wallet_transactions dwt
        JOIN   drop_wallets dw ON dw.id = dwt.wallet_id
        JOIN   drops d ON d.id = dw.drop_id
        WHERE  d.owner_id = ${clerkId}
        ORDER  BY dwt.created_at DESC
        LIMIT  5
      `).catch(() => ({ rows: [] as any[] }));

      const cents = (n: number) => `$${(n / 100).toFixed(2)}`;
      const orderStatusCount = (status: string) =>
        sellerOrders.filter(o => o.status === status).length;

      const summary = [
        `=== SELLER ACCOUNT ===`,
        `Seller: ${user.brandName ?? user.displayName ?? clerkId}`,
        `Subscription: plan=${user.subscriptionPlanId ?? "starter"}, status=${user.subscriptionStatus ?? "none"}`,
        `Identity verified: ${user.verified ? "yes" : "no"} (status: ${user.verificationStatus ?? "unverified"})`,
        ``,
        `=== PRODUCTS (${sellerProducts.length}) ===`,
        sellerProducts.slice(0, 8).map(p =>
          `- ${p.name} (${p.category ?? "uncategorized"}, ${cents(p.priceCents ?? 0)}, status: ${p.status ?? "active"})`
        ).join("\n"),
        ``,
        `=== RECENT ORDERS (${sellerOrders.length} shown) ===`,
        `Pending: ${orderStatusCount("pending")}, Processing: ${orderStatusCount("processing")}, Shipped: ${orderStatusCount("shipped")}, Delivered: ${orderStatusCount("delivered")}, Cancelled: ${orderStatusCount("cancelled")}`,
        sellerOrders.slice(0, 10).map(o =>
          `- Order #${o.orderNumber}: status=${o.status}, total=${cents(o.totalCents ?? 0)}, payout=${(o as any).payoutStatus ?? "n/a"}, date=${new Date(o.createdAt).toDateString()}`
        ).join("\n"),
        ``,
        `=== DROP WALLETS ===`,
        wallets.length > 0 ? [
          `Total held (pending release): ${cents(totalHeld)}`,
          `Total available balance: ${cents(totalBalance)}`,
          `Total released to date: ${cents(totalReleased)}`,
          wallets.map(w =>
            `- Drop "${w.drop_title}": held=${cents(Number(w.held_cents))}, balance=${cents(Number(w.balance_cents))}, released=${cents(Number(w.released_cents))}`
          ).join("\n"),
        ].join("\n") : "No drop wallets yet.",
        ``,
        `=== RECENT PAYOUT TRANSACTIONS ===`,
        txRows.rows.length > 0
          ? txRows.rows.map((t: any) =>
              `- ${t.type} ${cents(Number(t.amount_cents))} for drop "${t.drop_title}": "${t.description}" on ${new Date(t.created_at).toDateString()}`
            ).join("\n")
          : "No recent transactions.",
      ].join("\n");

      return { role: "seller", summary };
    }

    // ── Buyer context ──────────────────────────────────────────────────────────
    const cents = (n: number) => `$${((n ?? 0) / 100).toFixed(2)}`;
    const orderStatusCount = (status: string) =>
      buyerOrders.filter(o => o.status === status).length;

    const summary = [
      `=== BUYER ACCOUNT ===`,
      `Name: ${user.displayName ?? "Unknown"}`,
      ``,
      `=== ORDER HISTORY (${buyerOrders.length} shown) ===`,
      `Pending: ${orderStatusCount("pending")}, Processing: ${orderStatusCount("processing")}, Shipped: ${orderStatusCount("shipped")}, Delivered: ${orderStatusCount("delivered")}, Cancelled: ${orderStatusCount("cancelled")}`,
      buyerOrders.slice(0, 10).map(o =>
        `- Order #${o.orderNumber}: status=${o.status}, total=${cents(o.totalCents)}, date=${new Date(o.createdAt).toDateString()}`
      ).join("\n") || "No orders yet.",
    ].join("\n");

    return { role: "buyer", summary };
  } catch (err) {
    logger.error({ err, clerkId }, "Failed to build support chat user context");
    return { role: "unknown", summary: "Could not load account data." };
  }
}

// ─── System prompt builder ────────────────────────────────────────────────────
function buildSupportPrompt(role: string, accountSummary: string): string {
  return [
    "You are Brandthread Support AI — a helpful, empathetic, and knowledgeable support assistant for the Brandthread fashion marketplace app.",
    "",
    "## Your capabilities",
    "1. Answer how-to questions about any Brandthread feature: drops, live shopping, the Thread feed, the Manufacturer Hub, the AI Design Studio, store builder, payouts, subscriptions, orders, and more.",
    "2. Answer account-specific questions using the real account data provided below.",
    "3. When you cannot resolve an issue, offer to escalate to the human support team.",
    "",
    "## Payout & Drop Wallet system (important knowledge)",
    "Brandthread uses a per-order payout release model:",
    "- When a buyer places an order for a drop, funds go into that drop's wallet as 'held' (escrow).",
    "- Funds are released from 'held' to 'available balance' ONLY when each individual order ships.",
    "- Sellers can request a payout of their available balance to their connected bank account.",
    "- If a payout is on hold, it means orders for that drop have not yet shipped.",
    "- The held amount shown is the sum of all unshipped orders' values across all drops.",
    "",
    "## Live Shopping",
    "- Sellers go live via the Studio → Go Live flow using Agora RTC.",
    "- Buyers watch live streams in the Thread feed and can tap featured products to add to cart.",
    "- Live streams are recorded; replays require the seller to have that feature enabled.",
    "",
    "## Manufacturer Hub",
    "- Sellers use it to find verified production partners.",
    "- They can request samples (small-batch test runs) and bulk production orders.",
    "- Sample orders go through 6 stages: Requested → Quoted → Approved → In Production → Shipped → Delivered.",
    "- Bulk orders follow a similar pipeline and require a down payment.",
    "",
    "## Drops",
    "- Drops are limited-time product releases with a scheduled go-live date.",
    "- Buyers are notified when a drop they follow goes live.",
    "- Pre-orders are charged immediately; funds are held until the order ships.",
    "",
    "## PII Rules — CRITICAL",
    "- NEVER reveal full bank account numbers, full routing numbers, full card numbers, or SSNs.",
    "- You MAY reference the last 4 digits of a bank account if it helps confirm which account a payout is going to.",
    "- NEVER expose full personal identification numbers of any kind.",
    "",
    "## Tone",
    "- Friendly, clear, and direct. No corporate jargon.",
    "- If you are unsure, say so honestly and suggest escalation.",
    "- Keep responses concise — bullet points where appropriate.",
    "",
    `## This user's account data (${role} account)`,
    accountSummary,
    "",
    "## Escalation",
    "If the user asks to speak to a human, or the issue is too complex, billing-critical, or requires actions you cannot take, reply with:",
    'ESCALATE: <brief reason>',
    "This will trigger creating a support ticket for the human team.",
  ].join("\n");
}

// ─── POST /api/support-chat/message ──────────────────────────────────────────
router.post("/message", async (req: Request, res: Response): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { messages } = req.body as {
    messages?: { role: string; content: string }[];
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required." });
    return;
  }

  const safeMessages = messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .slice(-12)
    .map(m => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, 3000) }));

  // Gather real account context
  const { role, summary } = await buildUserContext(clerkId);
  const systemPrompt = buildSupportPrompt(role, summary);

  try {
    const completion = await openai.chat.completions.create({
      model:       "gpt-5.4-mini",
      messages:    [{ role: "system", content: systemPrompt }, ...safeMessages],
      max_completion_tokens: 800,
    });

    const raw = completion.choices[0]?.message?.content ?? "";

    // Detect escalation signal
    const shouldEscalate = raw.trim().startsWith("ESCALATE:");
    const escalateReason = shouldEscalate ? raw.replace(/^ESCALATE:\s*/i, "").split("\n")[0] ?? "" : undefined;

    const content = shouldEscalate
      ? "I'll connect you with our human support team right away. I've flagged your case — someone will follow up via email within 2 business hours."
      : raw;

    res.json({
      content,
      shouldEscalate,
      escalateReason,
      role,
      tokensUsed: completion.usage?.total_tokens,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e?.status === 429) {
      res.status(429).json({ error: "AI provider rate limit. Please try again shortly." });
    } else {
      res.status(503).json({ error: "Support AI temporarily unavailable. Please email support@brandthread.app." });
    }
  }
});

// ─── POST /api/support-chat/escalate ─────────────────────────────────────────
// Creates a support ticket and returns confirmation.
router.post("/escalate", async (req: Request, res: Response): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { summary, conversationSnippet } = req.body as {
    summary?: string;
    conversationSnippet?: string;
  };

  try {
    const [user] = await db
      .select({ displayName: users.displayName, email: (users as any).email })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    const email = user?.email ?? "unknown@brandthread.app";
    const name  = user?.displayName ?? "Brandthread User";
    const body  = [
      summary ?? "User requested human support via AI chatbot.",
      conversationSnippet ? `\n\n--- Conversation excerpt ---\n${conversationSnippet}` : "",
    ].join("");

    await db.execute(sql`
      INSERT INTO support_tickets (clerk_id, email, name, subject, body, category)
      VALUES (
        ${clerkId},
        ${email},
        ${name},
        ${"Support request from AI chat"},
        ${body.slice(0, 5000)},
        ${"general"}
      )
    `);

    res.json({ ok: true, message: "Support ticket created. We'll follow up within 2 business hours." });
  } catch (err) {
    req.log.error({ err, clerkId }, "Failed to escalate support chat ticket");
    res.status(500).json({ error: "Could not create ticket. Please email support@brandthread.app directly." });
  }
});

export default router;
