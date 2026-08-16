/**
 * Seller data export — generates a downloadable JSON or CSV snapshot.
 * POST /api/seller/export  { format: 'json'|'csv', include: ['products','orders','customers'] }
 */
import { Router } from "express";
import { db, products, orders, customers } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

function toCSV(rows: Record<string, unknown>[], fields: string[]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const header = fields.join(",");
  const lines = rows.map((row) => fields.map((f) => escape(row[f])).join(","));
  return [header, ...lines].join("\n");
}

router.post("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const {
    format = "json",
    include = ["products", "orders", "customers"],
  } = req.body as {
    format?: "json" | "csv";
    include?: ("products" | "orders" | "customers")[];
  };

  const result: Record<string, unknown[]> = {};

  if (include.includes("products")) {
    result.products = await db
      .select()
      .from(products)
      .where(eq(products.ownerId, ownerId))
      .orderBy(desc(products.createdAt));
  }
  if (include.includes("orders")) {
    result.orders = await db
      .select()
      .from(orders)
      .where(eq(orders.ownerId, ownerId))
      .orderBy(desc(orders.createdAt))
      .limit(5000);
  }
  if (include.includes("customers")) {
    result.customers = await db
      .select()
      .from(customers)
      .where(eq(customers.ownerId, ownerId))
      .orderBy(desc(customers.createdAt));
  }

  const ts = Date.now();

  if (format === "csv") {
    let csv = `Brandthread Data Export — ${new Date().toISOString()}\n\n`;
    for (const [key, rows] of Object.entries(result)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const fields = Object.keys(rows[0] as Record<string, unknown>);
      csv += `=== ${key.toUpperCase()} (${rows.length} rows) ===\n`;
      csv += toCSV(rows as Record<string, unknown>[], fields) + "\n\n";
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="brandthread-export-${ts}.csv"`
    );
    res.send(csv);
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="brandthread-export-${ts}.json"`
  );
  res.json({
    exportedAt: new Date().toISOString(),
    counts: {
      products: result.products?.length ?? 0,
      orders: result.orders?.length ?? 0,
      customers: result.customers?.length ?? 0,
    },
    ...result,
  });
});

export default router;
