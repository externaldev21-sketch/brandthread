import { Router } from "express";
import { db, customers } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { normalizeSearchTerm } from "../lib/search";
import { logger } from "../lib/logger";
import {
  findSellerCustomer,
  isUuid,
  listSellerCustomers,
  matchesCustomerSearch,
  publicCustomer,
  sellerCustomerOrders,
  superfans,
  topCustomers,
} from "../lib/sellerCustomers";
import { grantSuperfansEarlyAccess, superfansEarlyAccessStatus } from "../lib/superfansEarlyAccess";

// ─── Startup migration — add tags + notes columns ────────────────────────────
(async () => {
  try {
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'`);
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT`);
  } catch (err) {
    logger.error({ err }, "Failed to apply customers migration");
  }
})();

const router = Router();
router.use(requireAuth);

// GET /api/customers[?search=][&top=20][&segment=superfans]
// Customers derived from the seller's orders (lifetime spend net of refunds,
// order count, last order), merged with the hand-entered rows that carry tags
// and notes — see lib/sellerCustomers.ts. Newest order first; `top=N` returns
// the N biggest lifetime spenders instead; `segment=superfans` returns the
// top 1% of signed-in buyers by spend (orders break ties).
router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const term = normalizeSearchTerm(req.query.search);
    let list = await listSellerCustomers(ownerId);
    // Superfans are ranked over the whole list (already in rank order), then
    // searched within.
    const isSuperfans = req.query.segment === "superfans";
    if (isSuperfans) list = superfans(list, ownerId);
    if (term) list = list.filter((c) => matchesCustomerSearch(c, term));
    const top = Number.parseInt(String(req.query.top ?? ""), 10);
    if (isSuperfans) {
      // keep rank order
    } else if (Number.isFinite(top) && top > 0) {
      list = topCustomers(list, Math.min(top, 100));
    } else {
      list.sort((a, b) => (b.lastOrderAt ?? b.createdAt).localeCompare(a.lastOrderAt ?? a.createdAt));
    }
    res.json(list.map(publicCustomer));
  } catch (err) {
    req.log.error({ err }, "Failed to list customers");
    res.status(500).json({ error: "Failed to load customers" });
  }
});

// GET /api/customers/superfans/early-access
// The seller's next drop (earliest draft/active drop releasing in the future)
// and how many current superfans already hold early access to it.
router.get("/superfans/early-access", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    res.json(await superfansEarlyAccessStatus(ownerId));
  } catch (err) {
    req.log.error({ err }, "Failed to load superfans early access");
    res.status(500).json({ error: "Failed to load early access" });
  }
});

// POST /api/customers/superfans/early-access
// One tap: every current superfan gets early access to the next drop.
// Idempotent — buyers who already have it are counted in `alreadyHad`.
router.post("/superfans/early-access", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const grantedBy = ((req as any).actorClerkId as string | undefined) ?? ownerId;
  try {
    const result = await grantSuperfansEarlyAccess({ ownerId, grantedBy });
    if (!result.ok) { res.status(result.status).json({ error: result.error, code: result.code }); return; }
    const { ok: _ok, ...body } = result;
    res.json(body);
  } catch (err) {
    req.log.error({ err }, "Failed to grant superfans early access");
    res.status(500).json({ error: "Failed to give early access" });
  }
});

// POST /api/customers
router.post("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { email, name, phone, address } = req.body;
  if (!email || !name || typeof email !== "string" || typeof name !== "string") {
    res.status(400).json({ error: "email and name required" }); return;
  }
  // Unique per owner, not globally
  const [existing] = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.ownerId, ownerId), eq(customers.email, email.toLowerCase())))
    .limit(1);
  if (existing) { res.status(409).json({ error: "Customer with this email already exists" }); return; }

  const [customer] = await db.insert(customers)
    .values({ ownerId, email: email.toLowerCase(), name, phone, address })
    .returning();
  res.status(201).json(customer);
});

// GET /api/customers/:id
// :id is a list id (buyer_…, guest_… or a hand-entered row's uuid).
router.get("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const customer = await findSellerCustomer(ownerId, String(req.params.id));
    if (!customer) { res.status(404).json({ error: "Not found" }); return; }
    const recentOrders = (await sellerCustomerOrders(ownerId, customer)).slice(0, 10);
    res.json({ ...publicCustomer(customer), recentOrders });
  } catch (err) {
    req.log.error({ err }, "Failed to load customer");
    res.status(500).json({ error: "Failed to load customer" });
  }
});

// PUT /api/customers/:id
router.put("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(String(req.params.id))) { res.status(404).json({ error: "Not found" }); return; }
  const { name, phone, address, tags, notes } = req.body;
  const [updated] = await db.update(customers)
    .set({
      ...(name    && { name }),
      ...(phone   !== undefined && { phone }),
      ...(address && { address }),
      ...(tags    !== undefined && { tags: (Array.isArray(tags) ? tags : []) as any }),
      ...(notes   !== undefined && { notes }),
      updatedAt: new Date(),
    })
    .where(and(eq(customers.id, req.params.id), eq(customers.ownerId, ownerId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// GET /api/customers/:id/orders
router.get("/:id/orders", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const customer = await findSellerCustomer(ownerId, String(req.params.id));
    if (!customer) { res.status(404).json({ error: "Not found" }); return; }
    res.json(await sellerCustomerOrders(ownerId, customer));
  } catch (err) {
    req.log.error({ err }, "Failed to load customer orders");
    res.status(500).json({ error: "Failed to load customer orders" });
  }
});

export default router;
