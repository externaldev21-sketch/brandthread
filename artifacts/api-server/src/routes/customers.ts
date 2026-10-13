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
  topCustomers,
} from "../lib/sellerCustomers";

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

// GET /api/customers[?search=][&top=20]
// Customers derived from the seller's orders (lifetime spend net of refunds,
// order count, last order), merged with the hand-entered rows that carry tags
// and notes — see lib/sellerCustomers.ts. Newest order first; `top=N` returns
// the N biggest lifetime spenders instead.
router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const term = normalizeSearchTerm(req.query.search);
    let list = await listSellerCustomers(ownerId);
    if (term) list = list.filter((c) => matchesCustomerSearch(c, term));
    const top = Number.parseInt(String(req.query.top ?? ""), 10);
    if (Number.isFinite(top) && top > 0) {
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
