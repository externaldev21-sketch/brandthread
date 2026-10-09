/**
 * In-app support tickets — sellers/buyers submit help requests stored in DB.
 * POST /api/support/tickets      (requireAuth)
 * GET  /api/support/tickets      (requireAuth — user's own tickets)
 * POST /api/support/problem-reports (requireAuth — buyer "Report a problem",
 *      filed as a support ticket with category 'order_problem')
 */
import { Router } from "express";
import { z } from "zod";
import { db, orders, users } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { logger } from "../lib/logger";

const router = Router();

// ─── Startup migration ────────────────────────────────────────────────────────
(async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
        clerk_id    TEXT    NOT NULL,
        email       TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        subject     TEXT    NOT NULL,
        body        TEXT    NOT NULL,
        category    TEXT    NOT NULL DEFAULT 'general',
        status      TEXT    NOT NULL DEFAULT 'open',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    logger.error({ err }, "Support tickets migration failed");
  }
})();

// ─── POST /api/support/tickets ────────────────────────────────────────────────
router.post("/tickets", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { subject, body, category, email, name } = req.body as {
    subject?: string;
    body?: string;
    category?: string;
    email?: string;
    name?: string;
  };

  if (!subject?.trim() || !body?.trim() || !email?.trim() || !name?.trim()) {
    res.status(400).json({ error: "subject, body, email, and name are required" });
    return;
  }

  const cat = ["general", "billing", "account", "bug", "feature"].includes(category ?? "")
    ? (category ?? "general")
    : "general";

  const result = await db.execute(sql`
    INSERT INTO support_tickets (clerk_id, email, name, subject, body, category)
    VALUES (${clerkId}, ${email.trim()}, ${name.trim()}, ${subject.trim()}, ${body.trim()}, ${cat})
    RETURNING *
  `);
  res.status(201).json(result.rows[0] ?? {});
});

// ─── GET /api/support/tickets ─────────────────────────────────────────────────
router.get("/tickets", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const result = await db.execute(sql`
    SELECT * FROM support_tickets
    WHERE clerk_id = ${clerkId}
    ORDER BY created_at DESC
    LIMIT 50
  `);
  res.json(result.rows);
});

// ─── POST /api/support/problem-reports ───────────────────────────────────────
// The buyer "Report a problem" screen used to keep reports on the device
// only, so nobody ever saw them. They are now filed as support tickets
// (category 'order_problem') — the queue support already works from.
// `clientReportId` makes the call idempotent: a retried submit (flaky
// network, app restart) returns the ticket already filed for it.
export const PROBLEM_REPORT_TYPES = [
  "not_received", "tracking_issue", "wrong_product", "damaged_product",
  "missing_item", "seller_not_responding", "unauthorized_payment", "other",
] as const;

const PROBLEM_TYPE_LABELS: Record<(typeof PROBLEM_REPORT_TYPES)[number], string> = {
  not_received: "Order not received",
  tracking_issue: "Tracking issue",
  wrong_product: "Wrong product",
  damaged_product: "Damaged product",
  missing_item: "Missing item",
  seller_not_responding: "Seller not responding",
  unauthorized_payment: "Unauthorized payment",
  other: "Other",
};

const problemReportBody = z.object({
  clientReportId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  orderId: z.string().uuid().optional(),
  orderNumber: z.string().trim().max(64).optional(),
  type: z.enum(PROBLEM_REPORT_TYPES),
  description: z.string().trim().min(1).max(5000),
  evidenceUrls: z.array(z.string().max(2048).regex(/^https:\/\/\S+$/i)).max(10).optional(),
  localEvidenceCount: z.number().int().min(0).max(50).optional(),
  contactedSeller: z.boolean().optional(),
});

router.post("/problem-reports", requireAuth, rateLimit("report"), async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = problemReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid problem report", code: "VALIDATION_ERROR" });
    return;
  }
  const report = parsed.data;
  const refTag = `[ref:${report.clientReportId}]`;

  const existing = await db.execute(sql`
    SELECT id, status FROM support_tickets
    WHERE clerk_id = ${clerkId} AND category = 'order_problem'
      AND position(${refTag} in body) > 0
    LIMIT 1
  `);
  if (existing.rows[0]) {
    res.status(200).json({ ticket: existing.rows[0], duplicate: true });
    return;
  }

  let orderNumber = report.orderNumber ?? null;
  if (report.orderId) {
    // Never let a buyer attach a ticket to someone else's order.
    const [order] = await db
      .select({ id: orders.id, orderNumber: orders.orderNumber })
      .from(orders)
      .where(and(eq(orders.id, report.orderId), eq(orders.buyerId, clerkId)))
      .limit(1);
    if (!order) {
      res.status(404).json({ error: "Order not found", code: "NOT_FOUND" });
      return;
    }
    orderNumber = order.orderNumber;
  }

  const [user] = await db
    .select({ displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  const label = PROBLEM_TYPE_LABELS[report.type];
  const subject = orderNumber ? `${label} — order ${orderNumber}` : label;
  const lines = [
    report.description,
    "",
    `Type: ${report.type}`,
    report.orderId ? `Order: ${orderNumber ?? ""} (${report.orderId})` : "Order: none (general report)",
    `Contacted seller: ${report.contactedSeller ? "yes" : "no"}`,
    // Before the (long, truncatable) evidence list so the dedupe tag survives.
    refTag,
    ...(report.localEvidenceCount
      ? [`Photos kept on the buyer's device (not uploaded): ${report.localEvidenceCount}`]
      : []),
    ...(report.evidenceUrls?.length ? ["Evidence:", ...report.evidenceUrls] : []),
  ];

  const result = await db.execute(sql`
    INSERT INTO support_tickets (clerk_id, email, name, subject, body, category)
    VALUES (
      ${clerkId},
      ${user?.email ?? "unknown@brandthread.app"},
      ${user?.displayName ?? "Brandthread User"},
      ${subject.slice(0, 200)},
      ${lines.join("\n").slice(0, 8000)},
      ${"order_problem"}
    )
    RETURNING id, status
  `);
  res.status(201).json({ ticket: result.rows[0] ?? null, duplicate: false });
});

export default router;
