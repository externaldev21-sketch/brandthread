/**
 * Add Product wizard drafts, synced across a seller's devices.
 *
 *   GET    /api/product-drafts                    — list the store's drafts
 *   GET    /api/product-drafts/:clientDraftId     — one draft
 *   PUT    /api/product-drafts/:clientDraftId     — upsert (last-write-wins)
 *   DELETE /api/product-drafts/:clientDraftId     — discard
 *
 * Drafts belong to the store (team context aware, like /api/products): the
 * owner key is the resolved store owner, so a manager editing a joined store
 * sees that store's drafts. Writes need the manager role — the same role
 * that can publish a product from the wizard.
 *
 * Conflict rule: the client sends the `updatedAt` of its local save. A PUT
 * older than the stored copy is rejected with 409 and the server copy, so a
 * stale device never clobbers newer work from another device. Equal
 * timestamps are accepted (an idempotent retry of the same save).
 *
 * These rows are intentionally NOT products (no products.status='draft'):
 * they never reach product lists, search, analytics or plan limits.
 */
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, productDrafts } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole, teamContext } from "../middlewares/requireRole";

const router = Router();
router.use(requireAuth);
router.use(teamContext());

/** Serialized wizard state cap. Drafts hold text + image URLs, never bytes. */
export const PRODUCT_DRAFT_MAX_BYTES = 256 * 1024;
/** Hard cap on drafts per store so a buggy client can't grow this unbounded. */
export const PRODUCT_DRAFT_MAX_PER_OWNER = 200;

const clientDraftIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

const putBodySchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  data: z.record(z.string(), z.unknown()),
}).strict();

function serialize(row: typeof productDrafts.$inferSelect) {
  return {
    clientDraftId: row.clientDraftId,
    data: row.data,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function ownerOf(req: unknown): string {
  return (req as { clerkUserId: string }).clerkUserId;
}

function parseId(raw: unknown): string | null {
  const parsed = clientDraftIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

router.get("/", async (req, res) => {
  const ownerId = ownerOf(req);
  const rows = await db
    .select()
    .from(productDrafts)
    .where(eq(productDrafts.ownerId, ownerId))
    .orderBy(desc(productDrafts.updatedAt))
    .limit(PRODUCT_DRAFT_MAX_PER_OWNER);
  res.json({ drafts: rows.map(serialize) });
});

router.get("/:clientDraftId", async (req, res) => {
  const id = parseId(req.params.clientDraftId);
  if (!id) return res.status(400).json({ error: "Invalid draft id", code: "VALIDATION_ERROR" });
  const [row] = await db
    .select()
    .from(productDrafts)
    .where(and(eq(productDrafts.ownerId, ownerOf(req)), eq(productDrafts.clientDraftId, id)))
    .limit(1);
  if (!row) return res.status(404).json({ error: "Draft not found", code: "NOT_FOUND" });
  return res.json({ draft: serialize(row) });
});

router.put("/:clientDraftId", requireRole("manager"), async (req, res) => {
  const id = parseId(req.params.clientDraftId);
  if (!id) return res.status(400).json({ error: "Invalid draft id", code: "VALIDATION_ERROR" });
  const parsed = putBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid draft", code: "VALIDATION_ERROR" });
  }
  const { data, updatedAt: updatedAtRaw } = parsed.data;
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > PRODUCT_DRAFT_MAX_BYTES) {
    return res.status(413).json({ error: "Draft is too large", code: "DRAFT_TOO_LARGE" });
  }
  const updatedAt = new Date(updatedAtRaw);
  const ownerId = ownerOf(req);
  const actor = (req as { actorClerkId?: string }).actorClerkId ?? ownerId;

  const where = and(eq(productDrafts.ownerId, ownerId), eq(productDrafts.clientDraftId, id));

  const [existing] = await db.select({ id: productDrafts.id }).from(productDrafts).where(where).limit(1);
  if (!existing) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(productDrafts)
      .where(eq(productDrafts.ownerId, ownerId));
    if (n >= PRODUCT_DRAFT_MAX_PER_OWNER) {
      return res.status(429).json({ error: "Too many drafts", code: "DRAFT_LIMIT_REACHED" });
    }
  }

  // One atomic statement: insert, or overwrite only when this save is not
  // older than the stored one. No row back means the stored copy is newer.
  const [row] = await db
    .insert(productDrafts)
    .values({ ownerId, clientDraftId: id, data, updatedAt, createdBy: actor })
    .onConflictDoUpdate({
      target: [productDrafts.ownerId, productDrafts.clientDraftId],
      set: {
        data: sql`excluded.data`,
        updatedAt: sql`excluded.updated_at`,
        createdBy: sql`excluded.created_by`,
      },
      setWhere: sql`${productDrafts.updatedAt} <= excluded.updated_at`,
    })
    .returning();
  if (row) return res.json({ draft: serialize(row) });

  const [current] = await db.select().from(productDrafts).where(where).limit(1);
  if (!current) {
    // Deleted between the upsert and this read — the client simply retries.
    return res.status(409).json({ error: "Draft changed, retry", code: "DRAFT_STALE", draft: null });
  }
  return res.status(409).json({
    error: "A newer version of this draft was saved on another device",
    code: "DRAFT_STALE",
    draft: serialize(current),
  });
});

router.delete("/:clientDraftId", requireRole("manager"), async (req, res) => {
  const id = parseId(req.params.clientDraftId);
  if (!id) return res.status(400).json({ error: "Invalid draft id", code: "VALIDATION_ERROR" });
  await db
    .delete(productDrafts)
    .where(and(eq(productDrafts.ownerId, ownerOf(req)), eq(productDrafts.clientDraftId, id)));
  // Idempotent: deleting an already-gone draft is success (a retried discard).
  return res.json({ ok: true });
});

export default router;
