/**
 * Meta Conversions API relay, credited to the SELLER whose product it is
 * (BT-325). The buyer's app sends the event; the server works out whose pixel
 * it belongs to from the product(s), never from the caller:
 *
 *   ViewContent / AddToCart  value = the product's lowest price (server-side)
 *   Purchase                 only relayed when a paid order (last 2 hours) has
 *                            that seller's products — for the signed-in buyer,
 *                            or a guest checkout — and the value is that
 *                            seller's share of the order
 *   InitiateCheckout         relayed per seller when product ids are sent
 *
 * Signed-in buyers who consented to marketing pixels (the app only relays with
 * consent) are matched with SHA-256 hashed email + external_id, per Meta's
 * advanced matching. Every relay row is deduped on (seller, eventId, eventName).
 */
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import {
  db, metaAdAccounts, metaConversionEvents, orderItems, orders, productVariants, products, users,
} from "@workspace/db";
import { decryptToken } from "./metaCrypto";
import { MetaGraphError, sendConversionEvent } from "./metaGraph";

export const CAPI_EVENT_NAMES = new Set(["ViewContent", "AddToCart", "InitiateCheckout", "Purchase"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURCHASE_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_PRODUCTS = 20;

export type CapiInput = {
  eventId: unknown;
  eventName: unknown;
  occurredAt: unknown;
  productId?: unknown;
  productIds?: unknown;
  currency?: unknown;
};
export type CapiContext = { viewerId: string | null; ip?: string; userAgent?: string; now?: Date };
export type CapiResult = { ok: true; sellers: Array<{ sellerId: string; sent: boolean; valueCents: number | null }> } | { ok: false; error: string };

export const sha256 = (v: string) => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

export function normalizeCapiInput(input: CapiInput, now = new Date()) {
  const eventId = typeof input.eventId === "string" ? input.eventId.trim() : "";
  const eventName = typeof input.eventName === "string" ? input.eventName : "";
  const occurredAt = typeof input.occurredAt === "string" ? new Date(input.occurredAt) : null;
  if (!eventId || eventId.length > 100 || !CAPI_EVENT_NAMES.has(eventName) || !occurredAt || Number.isNaN(occurredAt.getTime())) return null;
  // Meta rejects events older than 7 days; future timestamps are clock skew.
  if (Math.abs(now.getTime() - occurredAt.getTime()) > 7 * 86_400_000) return null;
  const ids = [input.productId, ...(Array.isArray(input.productIds) ? input.productIds : [])]
    .filter((v): v is string => typeof v === "string" && UUID_RE.test(v));
  const productIds = [...new Set(ids)].slice(0, MAX_PRODUCTS);
  const currency = typeof input.currency === "string" && /^[a-z]{3}$/i.test(input.currency) ? input.currency.toUpperCase() : "USD";
  return { eventId, eventName, occurredAt, productIds, currency };
}

/** Product ids grouped by the seller who owns them (active products only). */
async function productsBySeller(productIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!productIds.length) return out;
  const rows = await db.select({ id: products.id, ownerId: products.ownerId }).from(products)
    .where(and(inArray(products.id, productIds), isNull(products.deletedAt)));
  for (const r of rows) {
    if (!r.ownerId) continue;
    out.set(r.ownerId, [...(out.get(r.ownerId) ?? []), r.id]);
  }
  return out;
}

async function lowestPriceCents(productId: string): Promise<number | null> {
  const [row] = await db.select({ min: sql<number | null>`min(${productVariants.priceCents})::int` })
    .from(productVariants).where(eq(productVariants.productId, productId));
  return typeof row?.min === "number" ? row.min : null;
}

/** That seller's share of a recently paid order, or null when there is none. */
export async function paidOrderValueForSeller(productIds: string[], viewerId: string | null, now: Date): Promise<number | null> {
  const since = new Date(now.getTime() - PURCHASE_WINDOW_MS);
  const rows = await db.select({
    orderId: orders.id,
    lineCents: sql<number>`(${orderItems.priceCents} * ${orderItems.quantity})::int`,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(and(
      inArray(productVariants.productId, productIds),
      isNotNull(orders.paidAt),
      gte(orders.paidAt, since),
      notInArray(orders.status, ["cancelled", "refunded", "refund_pending"]),
      viewerId ? eq(orders.buyerId, viewerId) : isNull(orders.buyerId),
    ))
    .orderBy(orders.paidAt);
  if (!rows.length) return null;
  // The most recent order is the one this Purchase event describes.
  const orderId = rows[rows.length - 1].orderId;
  return rows.filter((r) => r.orderId === orderId).reduce((sum, r) => sum + r.lineCents, 0);
}

export async function relayConversionEvent(input: CapiInput, ctx: CapiContext): Promise<CapiResult> {
  const now = ctx.now ?? new Date();
  const ev = normalizeCapiInput(input, now);
  if (!ev) return { ok: false, error: "eventId, a valid eventName and a recent occurredAt are required" };
  const bySeller = await productsBySeller(ev.productIds);
  const sellers: Array<{ sellerId: string; sent: boolean; valueCents: number | null }> = [];

  let hashedEmail: string | undefined;
  if (ctx.viewerId) {
    const [viewer] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, ctx.viewerId)).limit(1);
    if (viewer?.email) hashedEmail = sha256(viewer.email);
  }

  for (const [sellerId, ids] of bySeller) {
    if (sellerId === ctx.viewerId) continue; // a seller viewing their own product is not a conversion
    let valueCents: number | null = null;
    if (ev.eventName === "Purchase") {
      valueCents = await paidOrderValueForSeller(ids, ctx.viewerId, now);
      if (valueCents === null) continue; // no paid order to back it: not relayed
    } else if (ev.eventName !== "InitiateCheckout") {
      valueCents = await lowestPriceCents(ids[0]);
    }

    const inserted = await db.insert(metaConversionEvents).values({
      sellerId, eventId: ev.eventId, eventName: ev.eventName, occurredAt: ev.occurredAt,
      productId: ids[0], valueCents, currency: ev.currency,
    }).onConflictDoNothing().returning({ id: metaConversionEvents.id });
    if (!inserted.length) { sellers.push({ sellerId, sent: false, valueCents }); continue; }

    const [account] = await db.select().from(metaAdAccounts).where(eq(metaAdAccounts.sellerId, sellerId)).limit(1);
    if (!account || account.status !== "connected" || !account.pixelId || !account.accessTokenEncrypted) {
      sellers.push({ sellerId, sent: false, valueCents });
      continue;
    }
    let status = "";
    let sent = false;
    try {
      const result = await sendConversionEvent(decryptToken(account.accessTokenEncrypted), account.pixelId, {
        eventName: ev.eventName,
        eventId: ev.eventId,
        eventTime: Math.floor(ev.occurredAt.getTime() / 1000),
        userData: {
          client_ip_address: ctx.ip,
          client_user_agent: ctx.userAgent,
          ...(hashedEmail ? { em: hashedEmail } : {}),
          ...(ctx.viewerId ? { external_id: sha256(ctx.viewerId) } : {}),
        },
        customData: {
          content_ids: ids,
          content_type: "product",
          ...(typeof valueCents === "number" ? { value: valueCents / 100, currency: ev.currency } : {}),
        },
      });
      status = `ok:${result.eventsReceived}`;
      sent = true;
    } catch (err) {
      status = err instanceof MetaGraphError ? err.userMessage : String((err as Error)?.message ?? err);
    }
    await db.update(metaConversionEvents).set({ sentToMeta: sent, metaResponseStatus: status.slice(0, 500) })
      .where(and(eq(metaConversionEvents.sellerId, sellerId), eq(metaConversionEvents.eventId, ev.eventId), eq(metaConversionEvents.eventName, ev.eventName)));
    sellers.push({ sellerId, sent, valueCents });
  }
  return { ok: true, sellers };
}
