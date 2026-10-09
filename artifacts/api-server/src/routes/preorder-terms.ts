/**
 * Pre-order ship-by terms.
 *
 *   GET /api/preorder-terms/:productId   public — ship-by date + refund wording for an active pre-order
 *   PUT /api/preorder-terms/:productId   seller — set / change the ship-by date (validated against the 60-day refund window)
 */
import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, productPreorderTerms, products } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole, teamContext } from "../middlewares/requireRole";
import {
  PREORDER_REFUND_WINDOW_DAYS,
  daysUntil,
  maxShipByDate,
  refundRuleCopy,
  validateShipBy,
} from "../lib/preorderTerms";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function termsPayload(shipBy: Date, closingDate: Date | null, note: string | null, now = new Date()) {
  return {
    shipBy: shipBy.toISOString(),
    daysLeft: daysUntil(shipBy, now),
    closingDate: closingDate ? closingDate.toISOString() : null,
    refundWindowDays: PREORDER_REFUND_WINDOW_DAYS,
    refundCopy: refundRuleCopy(shipBy),
    note,
  };
}

// Public: only ever exposes active, non-deleted pre-order products.
router.get("/:productId", async (req, res) => {
  if (!isUuid(req.params.productId)) { res.status(404).json({ error: "Not found" }); return; }
  const [row] = await db
    .select({
      shipBy: productPreorderTerms.shipByDate,
      note: productPreorderTerms.note,
      closing: products.preOrderClosingDate,
      estShip: products.preOrderEstShipDate,
      isPreOrder: products.isPreOrder,
    })
    .from(products)
    .leftJoin(productPreorderTerms, eq(productPreorderTerms.productId, products.id))
    .where(and(eq(products.id, req.params.productId), eq(products.status, "active"), isNull(products.deletedAt)))
    .limit(1);
  if (!row || !row.isPreOrder) { res.status(404).json({ error: "Not found" }); return; }
  const shipBy = row.shipBy ?? row.estShip;
  if (!shipBy) { res.status(404).json({ error: "Not found" }); return; }
  res.json(termsPayload(new Date(shipBy), row.closing ? new Date(row.closing) : null, row.note ?? null));
});


router.put("/:productId", requireAuth, teamContext(), requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.productId)) { res.status(404).json({ error: "Product not found" }); return; }
  const rawShipBy = (req.body as any)?.shipBy;
  const rawNote = (req.body as any)?.note;
  if (typeof rawShipBy !== "string" || !rawShipBy || (rawNote != null && (typeof rawNote !== "string" || rawNote.length > 280))) { res.status(400).json({ error: "Enter a ship-by date.", code: "VALIDATION_ERROR" }); return; }

  const [product] = await db
    .select({ id: products.id, isPreOrder: products.isPreOrder, closing: products.preOrderClosingDate })
    .from(products)
    .where(and(eq(products.id, req.params.productId), eq(products.ownerId, ownerId), isNull(products.deletedAt)))
    .limit(1);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  if (!product.isPreOrder) { res.status(409).json({ error: "Turn on pre-order for this product first.", code: "NOT_PREORDER" }); return; }

  const closing = product.closing ? new Date(product.closing) : null;
  const shipBy = new Date(rawShipBy);
  const result = validateShipBy({ shipBy, closingDate: closing });
  if (!result.ok) {
    res.status(400).json({ error: result.message, code: result.code, maxShipBy: result.maxShipBy.toISOString() });
    return;
  }

  const note = (rawNote as string | null | undefined)?.trim() || null;
  await db
    .insert(productPreorderTerms)
    .values({ productId: product.id, shipByDate: shipBy, note })
    .onConflictDoUpdate({
      target: productPreorderTerms.productId,
      set: { shipByDate: shipBy, note, updatedAt: new Date() },
    });

  res.json({ ...termsPayload(shipBy, closing, note), maxShipBy: maxShipByDate({ closingDate: closing }).toISOString() });
});

export default router;
