import { Router } from "express";
import { db, customers, orders } from "@workspace/db";
import { eq, desc, ilike, or, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

// ─── Startup migration — add tags + notes columns ────────────────────────────
(async () => {
  try {
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'`);
    await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT`);
  } catch (err) {
    console.error("[customers] migration error:", err);
  }
})();

const router = Router();
router.use(requireAuth);

// GET /api/customers
router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { search } = req.query;
  let query = db.select().from(customers).where(eq(customers.ownerId, ownerId)).orderBy(desc(customers.createdAt)).$dynamic();
  if (search && typeof search === "string") {
    query = query.where(
      and(
        eq(customers.ownerId, ownerId),
        or(ilike(customers.name, `%${search}%`), ilike(customers.email, `%${search}%`))
      )
    );
  }
  res.json(await query);
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
router.get("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [customer] = await db.select().from(customers)
    .where(and(eq(customers.id, req.params.id), eq(customers.ownerId, ownerId)))
    .limit(1);
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }
  const recentOrders = await db.select().from(orders)
    .where(and(eq(orders.customerId, customer.id), eq(orders.ownerId, ownerId)))
    .orderBy(desc(orders.createdAt))
    .limit(10);
  res.json({ ...customer, recentOrders });
});

// PUT /api/customers/:id
router.put("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
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
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, req.params.id), eq(customers.ownerId, ownerId)))
    .limit(1);
  if (!customer) { res.status(404).json({ error: "Not found" }); return; }
  const customerOrders = await db
    .select()
    .from(orders)
    .where(and(eq(orders.customerId, customer.id), eq(orders.ownerId, ownerId)))
    .orderBy(desc(orders.createdAt));
  res.json(customerOrders);
});

export default router;
