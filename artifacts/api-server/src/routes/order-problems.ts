/**
 * Buyer "Report a problem" (order detail → Report a problem).
 *
 *   POST /api/order-problems                — buyer files a report (order-scoped or general)
 *   GET  /api/order-problems/mine           — buyer's own reports
 *   GET  /api/order-problems/order/:orderId — reports on one order (its buyer or its seller)
 *
 * Every report is persisted, mirrored into support_tickets so Brandthread
 * support sees it, and (for order reports) notifies the order's seller.
 * Evidence photos are uploaded first through POST /api/returns/evidence; only
 * paths under the buyer's own evidence prefix can be attached.
 */
import { Router } from "express";
import { db, orders, orderProblemReports } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";
import { publishNotification } from "./notifications-feed";
import { evidencePrefix } from "./returns";

const router = Router();
const objectStorage = new ObjectStorageService();
router.use(requireAuth);

export const PROBLEM_TYPES = [
  "not_received", "tracking_issue", "wrong_product", "damaged_product",
  "missing_item", "seller_not_responding", "unauthorized_payment", "other",
] as const;
type ProblemType = (typeof PROBLEM_TYPES)[number];

const PROBLEM_LABELS: Record<ProblemType, string> = {
  not_received: "Order not received",
  tracking_issue: "Tracking issue",
  wrong_product: "Wrong item",
  damaged_product: "Damaged item",
  missing_item: "Missing item",
  seller_not_responding: "Seller not responding",
  unauthorized_payment: "Unauthorized payment",
  other: "Other problem",
};

const MAX_EVIDENCE = 5;
const MAX_DESCRIPTION = 4000;

type ReportRow = typeof orderProblemReports.$inferSelect;

async function present(row: ReportRow) {
  const paths = Array.isArray(row.evidenceUrls) ? row.evidenceUrls : [];
  const evidenceUrls = (await Promise.all(paths.map((path) =>
    path.startsWith("/objects/") ? objectStorage.getObjectEntityDownloadURL(path).catch(() => null) : Promise.resolve(path),
  ))).filter((url): url is string => !!url);
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    type: row.type,
    typeLabel: PROBLEM_LABELS[row.type as ProblemType] ?? "Problem",
    description: row.description,
    evidenceUrls,
    contactedSeller: row.contactedSeller,
    escalatedToSupport: true,
    status: row.status,
    submittedAt: row.createdAt.toISOString(),
  };
}

/** The signed-in person (teamContext rewrites clerkUserId to the store owner). */
function actorId(req: unknown): string {
  const r = req as any;
  return (r.actorClerkId as string | undefined) ?? (r.clerkUserId as string);
}

router.post("/", async (req, res) => {
  const buyerId = actorId(req);
  const body = (req.body ?? {}) as {
    orderId?: unknown; type?: unknown; description?: unknown; evidenceUrls?: unknown; contactedSeller?: unknown;
    email?: unknown; name?: unknown;
  };
  const type = typeof body.type === "string" ? body.type : "";
  if (!(PROBLEM_TYPES as readonly string[]).includes(type)) {
    return res.status(400).json({ error: "Choose what kind of problem this is." });
  }
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) return res.status(400).json({ error: "Describe the problem." });
  if (description.length > MAX_DESCRIPTION) {
    return res.status(400).json({ error: `Keep the description under ${MAX_DESCRIPTION} characters.` });
  }
  if (body.evidenceUrls !== undefined && (!Array.isArray(body.evidenceUrls) || body.evidenceUrls.some((u) => typeof u !== "string"))) {
    return res.status(400).json({ error: "evidenceUrls must be an array of strings" });
  }
  const evidence = (body.evidenceUrls as string[] | undefined) ?? [];
  // POST /api/returns/evidence stores under the teamContext-resolved id, which
  // differs from the buyer's own id only for a buyer who is also store staff.
  const prefixes = [...new Set([evidencePrefix(buyerId), evidencePrefix((req as any).clerkUserId as string)])];
  if (evidence.length > MAX_EVIDENCE || evidence.some((url) => !prefixes.some((prefix) => url.startsWith(prefix)))) {
    return res.status(400).json({ error: "Attach up to 5 photos uploaded with this report." });
  }

  let order: { id: string; ownerId: string; orderNumber: string } | null = null;
  if (body.orderId !== undefined && body.orderId !== null && body.orderId !== "") {
    const orderId = String(body.orderId);
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return res.status(404).json({ error: "Order not found" });
    const [row] = await db
      .select({ id: orders.id, ownerId: orders.ownerId, orderNumber: orders.orderNumber, buyerId: orders.buyerId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Order not found" });
    if (row.buyerId !== buyerId) return res.status(403).json({ error: "You are not the buyer of this order" });
    order = { id: row.id, ownerId: row.ownerId, orderNumber: row.orderNumber };
  }

  const [created] = await db.insert(orderProblemReports).values({
    buyerId,
    orderId: order?.id ?? null,
    sellerId: order?.ownerId || null,
    orderNumber: order?.orderNumber ?? null,
    type,
    description,
    evidenceUrls: evidence,
    contactedSeller: body.contactedSeller === true,
  }).returning();

  const label = PROBLEM_LABELS[type as ProblemType];
  // Support visibility: the same support_tickets table the Help screen and
  // support chat escalation write to. Best effort — the report row is the
  // source of truth and already saved.
  try {
    const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : "unknown";
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Buyer";
    const subject = order ? `Order problem: ${label} (#${order.orderNumber})` : `Problem report: ${label}`;
    const ticketBody = [
      description,
      "",
      `Report ID: ${created.id}`,
      ...(order ? [`Order ID: ${order.id}`, `Order number: ${order.orderNumber}`, `Seller ID: ${order.ownerId}`] : []),
      `Contacted seller: ${created.contactedSeller ? "yes" : "no"}`,
      `Evidence photos: ${evidence.length}`,
    ].join("\n");
    await db.execute(sql`
      INSERT INTO support_tickets (clerk_id, email, name, subject, body, category)
      VALUES (${buyerId}, ${email}, ${name}, ${subject}, ${ticketBody}, 'general')
    `);
  } catch (err) {
    logger.warn({ err, reportId: created.id }, "Problem report support ticket mirror failed");
  }

  if (order?.ownerId && order.ownerId !== buyerId) {
    void publishNotification({
      userId: order.ownerId,
      category: "orders",
      type: "order_problem_reported",
      title: "A buyer reported a problem",
      body: `Order #${order.orderNumber}: ${label}. Open the order to review it.`,
      targetId: order.id,
      targetType: "order",
      cta: "View order",
    }).catch((err) => logger.warn({ err, reportId: created.id }, "Seller problem-report notification failed"));
  }

  return res.status(201).json(await present(created));
});

router.get("/mine", async (req, res) => {
  const buyerId = actorId(req);
  const rows = await db.select().from(orderProblemReports)
    .where(eq(orderProblemReports.buyerId, buyerId))
    .orderBy(desc(orderProblemReports.createdAt))
    .limit(100);
  return res.json(await Promise.all(rows.map(present)));
});

router.get("/order/:orderId", async (req, res) => {
  const userId = actorId(req);
  // Under teamContext, clerkUserId is the store a team member acts for.
  const ownerId = (req as any).clerkUserId as string;
  const orderId = String(req.params.orderId);
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return res.status(404).json({ error: "Order not found" });
  const [order] = await db.select({ buyerId: orders.buyerId, ownerId: orders.ownerId })
    .from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });
  const isBuyer = order.buyerId === userId;
  const isSeller = order.ownerId === ownerId;
  if (!isBuyer && !isSeller) return res.status(404).json({ error: "Order not found" });
  const rows = await db.select().from(orderProblemReports)
    .where(and(
      eq(orderProblemReports.orderId, orderId),
      ...(isBuyer && !isSeller ? [eq(orderProblemReports.buyerId, userId)] : []),
    ))
    .orderBy(desc(orderProblemReports.createdAt));
  return res.json(await Promise.all(rows.map(present)));
});

export default router;
