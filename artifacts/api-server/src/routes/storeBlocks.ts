/**
 * My Store — the seller's product blocks (Stan Store's "products"):
 *
 *   GET    /api/store-blocks              the store's blocks, in order (first visit saves the derived list)
 *   GET    /api/store-blocks/catalog      products not on the store yet (Pre-made → "From your products")
 *   POST   /api/store-blocks              { productId } add a product as a draft block
 *   PATCH  /api/store-blocks/:id          thumbnail / checkout page / price / pre-order fields / visible
 *   POST   /api/store-blocks/:id/publish  put it live (product goes active; a pre-order opens its drop)
 *   DELETE /api/store-blocks/:id          take it off the store (the product stays in the catalog)
 *   PUT    /api/store-blocks/order        { ids } drag-to-reorder
 *
 * New products ("create it right there") are made with POST /api/products,
 * which owns plan limits and listing validation, then added here.
 */
import { Router } from "express";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db, bioPages, drops, products, productPreorderTerms, productVariants, storeBlocks } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { notifyNewProduct } from "../lib/activityEvents";
import { defaultFulfillmentDeadline, validateFulfillmentDeadline } from "../lib/money/dropLifecycle";
import {
  kindOfProduct, loadStoreBlocks, nextBlockPosition, seedStoreBlocks, type StoreBlockRecord,
} from "../lib/growth/storeBlockData";
import {
  BLOCK_LIMITS, PREORDER_OPEN_STOCK, blockButtonText, parseBlockPatch, preorderSold, preorderStock, publishProblem, shipByLabel,
} from "../lib/growth/storeBlocks";
import { publicImage } from "./storeSite";

const router = Router();
router.use(requireAuth);
router.use(requirePermission("products"));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sellerOf = (req: any): string => req.clerkUserId as string;

class BlockError extends Error {
  constructor(readonly status: number, message: string, readonly field?: string, readonly code?: string) { super(message); }
}

function sendError(res: any, req: any, err: unknown, what: string): void {
  if (err instanceof BlockError) {
    res.status(err.status).json({ error: err.message, ...(err.field ? { field: err.field } : {}), ...(err.code ? { code: err.code } : {}) });
    return;
  }
  req.log?.error({ err }, what);
  res.status(500).json({ error: "Internal server error" });
}

async function serialize(b: StoreBlockRecord) {
  const [thumbImage, checkoutImage, productImage] = await Promise.all([
    publicImage(b.thumbImage), publicImage(b.checkoutImage), publicImage(b.product.images[0]),
  ]);
  return {
    id: b.id,
    productId: b.productId,
    kind: b.kind,
    style: b.style,
    position: b.position,
    visible: b.visible,
    status: b.status,
    title: b.title,
    subtitle: b.subtitle,
    buttonText: b.buttonText,
    /** What the card's button says (the seller's text or the default). */
    buttonLabel: blockButtonText(b.kind, b.buttonText),
    thumbImage, thumbImageRef: b.thumbImage,
    checkoutImage, checkoutImageRef: b.checkoutImage,
    description: b.description,
    product: {
      name: b.product.name, status: b.product.status, description: b.product.description, image: productImage,
      moderationLocked: b.product.moderationLocked,
    },
    priceCents: b.priceCents,
    compareAtPriceCents: b.compareAtPriceCents,
    stock: b.stock,
    variantCount: b.variants.length,
    shipBy: b.shipBy?.toISOString() ?? null,
    shipByLabel: b.kind === "preorder" ? shipByLabel(b.shipBy) : "",
    preorderCap: b.preorderCap,
    preorderSold: b.kind === "preorder" && b.status === "published" && b.variants.length === 1 ? preorderSold(b.preorderCap, b.stock) : null,
    open: b.open,
  };
}

async function blockFor(sellerId: string, id: string): Promise<StoreBlockRecord> {
  if (!UUID_RE.test(id)) throw new BlockError(404, "Not found");
  const block = (await loadStoreBlocks(sellerId)).find((b) => b.id === id.toLowerCase());
  if (!block) throw new BlockError(404, "Not found");
  return block;
}

async function featuredIds(sellerId: string): Promise<string[]> {
  const [page] = await db.select({ ids: bioPages.featuredProductIds }).from(bioPages).where(eq(bioPages.sellerId, sellerId)).limit(1);
  return (page?.ids ?? []).filter((id) => UUID_RE.test(id));
}

router.get("/", async (req, res) => {
  const sellerId = sellerOf(req);
  try {
    await seedStoreBlocks(sellerId, await featuredIds(sellerId));
    const blocks = await loadStoreBlocks(sellerId);
    res.json({ blocks: await Promise.all(blocks.map(serialize)), limits: BLOCK_LIMITS });
  } catch (err) { sendError(res, req, err, "list store blocks failed"); }
});

router.get("/catalog", async (req, res) => {
  const sellerId = sellerOf(req);
  try {
    const onStore = await db.select({ productId: storeBlocks.productId }).from(storeBlocks)
      .where(and(eq(storeBlocks.sellerId, sellerId), ne(storeBlocks.status, "removed")));
    const used = new Set(onStore.map((r) => r.productId));
    const rows = await db.select({ id: products.id, name: products.name, status: products.status, images: products.images, isPreOrder: products.isPreOrder })
      .from(products)
      .where(and(eq(products.ownerId, sellerId), isNull(products.deletedAt), inArray(products.status, ["active", "draft"])))
      .orderBy(asc(products.name)).limit(300);
    const list = rows.filter((r) => !used.has(r.id));
    const variants = list.length
      ? await db.select({ productId: productVariants.productId, priceCents: productVariants.priceCents, stock: productVariants.stock })
        .from(productVariants).where(inArray(productVariants.productId, list.map((r) => r.id)))
      : [];
    res.json({
      products: await Promise.all(list.map(async (p) => {
        const vs = variants.filter((v) => v.productId === p.id);
        return {
          id: p.id, name: p.name, status: p.status, isPreOrder: p.isPreOrder,
          image: await publicImage(Array.isArray(p.images) ? p.images[0] : null),
          priceCents: vs.length ? Math.min(...vs.map((v) => v.priceCents)) : null,
          stock: vs.reduce((n, v) => n + Math.max(0, v.stock), 0),
        };
      })),
    });
  } catch (err) { sendError(res, req, err, "store catalog failed"); }
});

router.post("/", async (req, res) => {
  const sellerId = sellerOf(req);
  const productId = req.body?.productId;
  try {
    if (typeof productId !== "string" || !UUID_RE.test(productId)) throw new BlockError(400, "productId is required", "productId");
    const [p] = await db.select({ id: products.id, name: products.name, isPreOrder: products.isPreOrder, dropId: products.dropId })
      .from(products).where(and(eq(products.id, productId), eq(products.ownerId, sellerId), isNull(products.deletedAt))).limit(1);
    if (!p) throw new BlockError(404, "Product not found", "productId");
    const kind = await kindOfProduct(p);
    const position = await nextBlockPosition(sellerId);
    const [existing] = await db.select().from(storeBlocks)
      .where(and(eq(storeBlocks.sellerId, sellerId), eq(storeBlocks.productId, p.id))).limit(1);
    let id: string;
    if (existing && existing.status !== "removed") {
      throw new BlockError(409, "This product is already on your store", "productId", "ALREADY_ON_STORE");
    } else if (existing) {
      await db.update(storeBlocks).set({ status: "draft", visible: true, position, kind, updatedAt: new Date() }).where(eq(storeBlocks.id, existing.id));
      id = existing.id;
    } else {
      [{ id }] = await db.insert(storeBlocks).values({
        sellerId, productId: p.id, kind, position, status: "draft", title: p.name.slice(0, BLOCK_LIMITS.title),
      }).returning({ id: storeBlocks.id });
    }
    res.status(201).json(await serialize(await blockFor(sellerId, id)));
  } catch (err) { sendError(res, req, err, "add store block failed"); }
});

/**
 * Opens (or updates) the pre-order: its drop holds the money until it ships
 * and stops taking orders after the deadline; the variant's stock is the cap
 * minus what's sold. Runs on publish and when a live pre-order's date or cap
 * changes.
 */
async function applyPreorder(tx: any, sellerId: string, block: StoreBlockRecord, prevCap: number | null): Promise<void> {
  const problem = publishProblem({ kind: "preorder", title: block.title || block.product.name, priceCents: block.priceCents, shipBy: block.shipBy });
  if (problem) throw new BlockError(400, problem.error, problem.field);
  const shipBy = block.shipBy!;
  const deadline = defaultFulfillmentDeadline({ estimatedShipDate: shipBy });
  const deadlineError = validateFulfillmentDeadline(deadline);
  if (deadlineError) throw new BlockError(400, deadlineError, "shipBy");
  if (block.preorderCap != null && block.variants.length !== 1) {
    throw new BlockError(400, "A cap works on products with one option", "preorderCap");
  }

  let dropId = block.product.dropId;
  const [drop] = dropId
    ? await tx.select({ id: drops.id, type: drops.type, ownerId: drops.ownerId, escrowState: drops.escrowState }).from(drops).where(eq(drops.id, dropId)).limit(1)
    : [];
  const firstOpen = !drop || drop.type !== "pre-order" || drop.ownerId !== sellerId;
  if (firstOpen) {
    [{ id: dropId }] = await tx.insert(drops).values({
      ownerId: sellerId, name: (block.title || block.product.name).slice(0, 120), type: "pre-order", status: "active",
      payoutStatus: "held", estimatedShipDate: shipBy, escrowState: "collecting", fulfillmentDeadlineAt: deadline,
    }).returning({ id: drops.id });
  } else if (drop.escrowState === "collecting") {
    await tx.update(drops).set({ estimatedShipDate: shipBy, fulfillmentDeadlineAt: deadline, status: "active", updatedAt: new Date() }).where(eq(drops.id, drop.id));
  } else {
    throw new BlockError(409, "This pre-order is already in production", "shipBy", "PREORDER_CLOSED");
  }
  await tx.update(products).set({ isPreOrder: true, preOrderEstShipDate: shipBy, dropId, updatedAt: new Date() })
    .where(and(eq(products.id, block.productId), eq(products.ownerId, sellerId)));
  await tx.insert(productPreorderTerms).values({ productId: block.productId, shipByDate: shipBy })
    .onConflictDoUpdate({ target: productPreorderTerms.productId, set: { shipByDate: shipBy, updatedAt: new Date() } });
  if (block.variants.length === 1) {
    const v = block.variants[0];
    const stock = firstOpen ? block.preorderCap ?? PREORDER_OPEN_STOCK : preorderStock({ cap: block.preorderCap, prevCap, prevStock: v.stock });
    await tx.update(productVariants).set({ stock, updatedAt: new Date() }).where(eq(productVariants.id, v.id));
  }
}

router.patch("/:id", async (req, res) => {
  const sellerId = sellerOf(req);
  try {
    const block = await blockFor(sellerId, req.params.id);
    const parsed = parseBlockPatch((req.body ?? {}) as Record<string, unknown>, block.kind);
    if (!parsed.ok) throw new BlockError(400, parsed.error, parsed.field);
    const p = parsed.patch;
    const price = p.priceCents ?? block.priceCents;
    if (p.compareAtPriceCents != null && (price == null || p.compareAtPriceCents <= price)) {
      throw new BlockError(400, "The original price must be higher than the price", "compareAtPriceCents");
    }
    if ((p.priceCents !== undefined || p.compareAtPriceCents !== undefined) && !block.variants.length) {
      throw new BlockError(400, "Add an option to this product first", "priceCents");
    }
    await db.transaction(async (tx) => {
      const { priceCents, compareAtPriceCents, ...fields } = p;
      await tx.update(storeBlocks).set({ ...fields, updatedAt: new Date() })
        .where(and(eq(storeBlocks.id, block.id!), eq(storeBlocks.sellerId, sellerId)));
      if (priceCents !== undefined || compareAtPriceCents !== undefined) {
        const keepCompare = compareAtPriceCents === undefined && block.compareAtPriceCents != null && price != null && block.compareAtPriceCents > price;
        await tx.update(productVariants).set({
          ...(priceCents !== undefined ? { priceCents } : {}),
          ...(compareAtPriceCents !== undefined ? { compareAtPriceCents } : keepCompare ? {} : { compareAtPriceCents: null }),
          updatedAt: new Date(),
        }).where(inArray(productVariants.id, block.variants.map((v) => v.id)));
      }
      const preorderChanged = p.shipBy !== undefined || p.preorderCap !== undefined;
      if (block.kind === "preorder" && block.status === "published" && preorderChanged) {
        await applyPreorder(tx, sellerId, {
          ...block,
          shipBy: p.shipBy ?? block.shipBy,
          preorderCap: p.preorderCap !== undefined ? p.preorderCap : block.preorderCap,
          priceCents: price,
        }, block.preorderCap);
      }
    });
    res.json(await serialize(await blockFor(sellerId, block.id!)));
  } catch (err) { sendError(res, req, err, "save store block failed"); }
});

router.post("/:id/publish", async (req, res) => {
  const sellerId = sellerOf(req);
  try {
    const block = await blockFor(sellerId, req.params.id);
    if (block.product.moderationLocked) throw new BlockError(409, "This listing is locked by a platform moderation action", undefined, "PRODUCT_MODERATION_LOCKED");
    const problem = publishProblem({ kind: block.kind, title: block.title || block.product.name, priceCents: block.priceCents, shipBy: block.shipBy });
    if (problem) throw new BlockError(400, problem.error, problem.field);
    const wentLive = await db.transaction(async (tx) => {
      if (block.kind === "preorder") await applyPreorder(tx, sellerId, block, block.preorderCap);
      const [prod] = await tx.update(products).set({ status: "active", updatedAt: new Date() })
        .where(and(eq(products.id, block.productId), eq(products.ownerId, sellerId), ne(products.status, "active"))).returning({ id: products.id });
      await tx.update(storeBlocks).set({ status: "published", visible: true, updatedAt: new Date() }).where(eq(storeBlocks.id, block.id!));
      return !!prod;
    });
    if (wentLive) void notifyNewProduct({ productId: block.productId });
    res.json(await serialize(await blockFor(sellerId, block.id!)));
  } catch (err) { sendError(res, req, err, "publish store block failed"); }
});

router.delete("/:id", async (req, res) => {
  const sellerId = sellerOf(req);
  try {
    const block = await blockFor(sellerId, req.params.id);
    await db.update(storeBlocks).set({ status: "removed", visible: false, updatedAt: new Date() }).where(eq(storeBlocks.id, block.id!));
    res.status(204).end();
  } catch (err) { sendError(res, req, err, "remove store block failed"); }
});

router.put("/order", async (req, res) => {
  const sellerId = sellerOf(req);
  try {
    const raw = req.body?.ids;
    if (!Array.isArray(raw) || raw.length > 200 || !raw.every((x) => typeof x === "string" && UUID_RE.test(x))) {
      throw new BlockError(400, "ids must be the block ids in order", "ids");
    }
    const ids = [...new Set((raw as string[]).map((x) => x.toLowerCase()))];
    const mine = await db.select({ id: storeBlocks.id }).from(storeBlocks)
      .where(and(eq(storeBlocks.sellerId, sellerId), ne(storeBlocks.status, "removed")));
    const mineSet = new Set(mine.map((r) => r.id));
    if (ids.length !== mineSet.size || !ids.every((id) => mineSet.has(id))) {
      throw new BlockError(409, "Your store changed. Pull to refresh and try again.", "ids", "STALE_ORDER");
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx.update(storeBlocks).set({ position: i, updatedAt: new Date() }).where(and(eq(storeBlocks.id, ids[i]), eq(storeBlocks.sellerId, sellerId)));
      }
    });
    const blocks = await loadStoreBlocks(sellerId);
    res.json({ blocks: await Promise.all(blocks.map(serialize)) });
  } catch (err) { sendError(res, req, err, "reorder store blocks failed"); }
});

export default router;
