/**
 * Digital Closet pieces: every delivered, non-refunded line item the buyer
 * received, newest first. Nothing is copied into a closet table — a refund or
 * cancellation removes the piece on the next read.
 */
import { and, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { db, orderItems, orders, productVariants, products, users } from "@workspace/db";

/** Order statuses whose items never belong in a closet. */
export const NON_CLOSET_ORDER_STATUSES = ["cancelled", "refund_pending", "refunded"] as const;

export interface ClosetPieceRow {
  orderItemId: string;
  orderId: string;
  productId: string | null;
  productName: string;
  variantLabel: string | null;
  size: string | null;
  priceCents: number;
  images: unknown;
  brandName: string | null;
  displayName: string | null;
  sellerId: string;
  orderedAt: Date;
  itemDeliveredAt: Date | null;
  orderDeliveredAt: Date | null;
  quantity: number;
  editionNumber: number | null;
  editionSize: number | null;
}

export interface ClosetPiece {
  id: string;
  orderId: string;
  productId: string | null;
  name: string;
  brand: string | null;
  sellerId: string;
  size: string | null;
  priceCents: number;
  imageUrl: string | null;
  orderedAt: string;
  deliveredAt: string;
  /** Numbered run: shown on the piece in the Closet only. */
  edition: { number: number; quantity: number; size: number } | null;
}

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const first = images.find((v): v is string => typeof v === "string" && v.length > 0);
  return first ?? null;
}

/** Pure mapping, newest delivery first; rows without a delivery date are dropped. */
export function toClosetPieces(rows: ClosetPieceRow[]): ClosetPiece[] {
  const pieces: ClosetPiece[] = [];
  for (const row of rows) {
    const delivered = row.itemDeliveredAt ?? row.orderDeliveredAt;
    if (!delivered) continue;
    pieces.push({
      id: row.orderItemId,
      orderId: row.orderId,
      productId: row.productId,
      name: row.productName,
      brand: row.brandName ?? row.displayName ?? null,
      sellerId: row.sellerId,
      // The variant's size when it still exists, else the label frozen on the order.
      size: row.size ?? row.variantLabel ?? null,
      priceCents: row.priceCents,
      imageUrl: firstImage(row.images),
      orderedAt: row.orderedAt.toISOString(),
      deliveredAt: delivered.toISOString(),
      edition: row.editionNumber !== null && row.editionSize !== null
        ? { number: row.editionNumber, quantity: row.quantity, size: row.editionSize }
        : null,
    });
  }
  return pieces.sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt) || a.id.localeCompare(b.id));
}

export async function loadClosetPieceRows(buyerId: string, orderItemIds?: string[]): Promise<ClosetPieceRow[]> {
  if (orderItemIds && orderItemIds.length === 0) return [];
  return db
    .select({
      orderItemId: orderItems.id,
      orderId: orders.id,
      productId: productVariants.productId,
      productName: orderItems.productName,
      variantLabel: orderItems.variantLabel,
      size: productVariants.size,
      priceCents: orderItems.priceCents,
      images: products.images,
      brandName: users.brandName,
      displayName: users.displayName,
      sellerId: orders.ownerId,
      orderedAt: orders.createdAt,
      itemDeliveredAt: orderItems.deliveredAt,
      orderDeliveredAt: orders.deliveredAt,
      quantity: orderItems.quantity,
      editionNumber: orderItems.editionNumber,
      editionSize: products.editionSize,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(users, eq(users.clerkId, orders.ownerId))
    .where(and(
      eq(orders.buyerId, buyerId),
      notInArray(orders.status, [...NON_CLOSET_ORDER_STATUSES]),
      isNull(orderItems.refundedAt),
      or(isNotNull(orderItems.deliveredAt), isNotNull(orders.deliveredAt)),
      orderItemIds ? inArray(orderItems.id, orderItemIds) : sql`true`,
    ))
    .orderBy(desc(sql`coalesce(${orderItems.deliveredAt}, ${orders.deliveredAt})`));
}

export async function loadClosetPieces(buyerId: string, orderItemIds?: string[]): Promise<ClosetPiece[]> {
  return toClosetPieces(await loadClosetPieceRows(buyerId, orderItemIds));
}

/**
 * Buyers may tag a product on their own post only when it is in their
 * closet (delivered to them, not refunded). Returns the ids that are NOT.
 */
export async function productsMissingFromCloset(buyerId: string, productIds: string[]): Promise<string[]> {
  const wanted = [...new Set(productIds)];
  if (wanted.length === 0) return [];
  const owned = new Set((await loadClosetPieceRows(buyerId)).map((row) => row.productId).filter(Boolean));
  return wanted.filter((id) => !owned.has(id));
}
