/**
 * Seller conversion tracking — the seller Checkout settings' "Additional
 * scripts" (mobile app/checkout.tsx). A native app can't run a seller's own
 * <script> tags, so the store's tracking runs server-to-server instead: the
 * seller enters their pixel / measurement IDs and server API secrets, and on
 * every paid order Brandthread sends one Purchase event to each provider the
 * seller configured:
 *
 *   • Meta Conversions API      POST graph.facebook.com/{ver}/{pixelId}/events
 *   • TikTok Events API (v1.3)  POST business-api.tiktok.com/open_api/v1.3/event/track/
 *   • Google Analytics 4        POST www.google-analytics.com/mp/collect (Measurement Protocol)
 *
 * Each event carries the order id (Meta event_id / TikTok event_id / GA4
 * transaction_id, so the providers de-duplicate too), the value and
 * currency, the items, and the buyer's email SHA-256 hashed after each
 * provider's normalisation rules. Plain emails never leave the server.
 *
 * Secrets are stored AES-256-GCM encrypted (lib/metaCrypto.ts) and are only
 * ever returned masked ("••••1a2b").
 *
 * Delivery is best effort and never blocks or fails the order: up to 3
 * attempts per provider with backoff (lib/retry.ts), and the outcome is
 * recorded in conversion_event_deliveries. A provider already marked 'sent'
 * for an order is never sent again, so a Stripe webhook redelivery is safe.
 */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db, conversionEventDeliveries, orderItems, orders, productVariants, sellerConversionTracking, users,
} from "@workspace/db";
import { decryptToken, encryptToken, hasMetaTokenEncryptionKey } from "./metaCrypto";
import { logger } from "./logger";
import { withRetry } from "./retry";

export const CONVERSION_PROVIDERS = ["meta", "tiktok", "ga4"] as const;
export type ConversionProvider = (typeof CONVERSION_PROVIDERS)[number];

export const META_GRAPH_VERSION = "v21.0";

// ─── Formats ──────────────────────────────────────────────────────────────────

/** Meta (Facebook) Pixel / dataset ID: digits only, 10–20 long. */
export const META_PIXEL_ID_RE = /^\d{10,20}$/;
/** Conversions API access token (Events Manager → Settings → Generate access token): starts with "EA". */
export const META_ACCESS_TOKEN_RE = /^EA[A-Za-z0-9]{30,500}$/;
/** TikTok Pixel ID (Events Manager → pixel "ID"): upper-case letters and digits. */
export const TIKTOK_PIXEL_ID_RE = /^[A-Z0-9]{16,24}$/;
/** TikTok Events API access token (Events Manager → pixel → Settings → Generate Access Token). */
export const TIKTOK_ACCESS_TOKEN_RE = /^[A-Za-z0-9]{32,128}$/;
/** GA4 web data stream Measurement ID. */
export const GA4_MEASUREMENT_ID_RE = /^G-[A-Z0-9]{4,16}$/;
/** GA4 Measurement Protocol API secret (Admin → Data streams → Measurement Protocol API secrets). */
export const GA4_API_SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/;

export interface ConversionTrackingInput {
  metaPixelId?: string | null;
  metaAccessToken?: string | null;
  tiktokPixelId?: string | null;
  tiktokAccessToken?: string | null;
  ga4MeasurementId?: string | null;
  ga4ApiSecret?: string | null;
}

/** What a client sees: IDs in full, secrets masked, and which providers are live. */
export interface ConversionTrackingView {
  metaPixelId: string | null;
  metaAccessTokenMasked: string | null;
  tiktokPixelId: string | null;
  tiktokAccessTokenMasked: string | null;
  ga4MeasurementId: string | null;
  ga4ApiSecretMasked: string | null;
  /** Providers with both an ID and a secret: these receive Purchase events. */
  activeProviders: ConversionProvider[];
}

type FieldSpec = { key: keyof ConversionTrackingInput; re: RegExp; label: string; normalize: (value: string) => string };

const FIELDS: FieldSpec[] = [
  { key: "metaPixelId", re: META_PIXEL_ID_RE, label: "Meta Pixel ID (10–20 digits)", normalize: (v) => v.replace(/\s+/g, "") },
  { key: "metaAccessToken", re: META_ACCESS_TOKEN_RE, label: "Meta Conversions API access token (starts with EA)", normalize: (v) => v.trim() },
  { key: "tiktokPixelId", re: TIKTOK_PIXEL_ID_RE, label: "TikTok Pixel ID", normalize: (v) => v.trim().toUpperCase() },
  { key: "tiktokAccessToken", re: TIKTOK_ACCESS_TOKEN_RE, label: "TikTok Events API access token", normalize: (v) => v.trim() },
  { key: "ga4MeasurementId", re: GA4_MEASUREMENT_ID_RE, label: "Google Analytics Measurement ID (G-XXXXXXX)", normalize: (v) => v.trim().toUpperCase() },
  { key: "ga4ApiSecret", re: GA4_API_SECRET_RE, label: "Google Analytics Measurement Protocol API secret", normalize: (v) => v.trim() },
];

export type ValidatedTrackingPatch = Partial<Record<keyof ConversionTrackingInput, string | null>>;

/**
 * Validates a PUT body. Each key is optional: omitted = unchanged, null or ""
 * = cleared, a string = set (after format checks). Returns the normalised
 * patch, or the first error.
 */
export function validateConversionTrackingPatch(body: unknown):
  | { ok: true; patch: ValidatedTrackingPatch }
  | { ok: false; error: string; field: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Body must be an object", field: "" };
  const value = body as Record<string, unknown>;
  const patch: ValidatedTrackingPatch = {};
  for (const field of FIELDS) {
    if (!(field.key in value)) continue;
    const raw = value[field.key];
    if (raw === null || raw === "") { patch[field.key] = null; continue; }
    if (typeof raw !== "string") return { ok: false, error: `${field.label} must be text`, field: field.key };
    const normalized = field.normalize(raw);
    if (!normalized) { patch[field.key] = null; continue; }
    if (!field.re.test(normalized)) return { ok: false, error: `Enter a valid ${field.label}`, field: field.key };
    patch[field.key] = normalized;
  }
  return { ok: true, patch };
}

/** "••••" + last 4 characters; never the secret. */
export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return `••••${secret.slice(-4)}`;
}

type TrackingRow = typeof sellerConversionTracking.$inferSelect;

function safeDecrypt(value: string | null): string | null {
  if (!value) return null;
  try {
    return decryptToken(value);
  } catch (err) {
    logger.error({ err }, "Could not decrypt a conversion tracking secret");
    return null;
  }
}

export function activeProvidersOf(row: Pick<TrackingRow, "metaPixelId" | "metaAccessTokenEnc" | "tiktokPixelId" | "tiktokAccessTokenEnc" | "ga4MeasurementId" | "ga4ApiSecretEnc"> | null | undefined): ConversionProvider[] {
  if (!row) return [];
  const active: ConversionProvider[] = [];
  if (row.metaPixelId && row.metaAccessTokenEnc) active.push("meta");
  if (row.tiktokPixelId && row.tiktokAccessTokenEnc) active.push("tiktok");
  if (row.ga4MeasurementId && row.ga4ApiSecretEnc) active.push("ga4");
  return active;
}

export function trackingView(row: TrackingRow | null | undefined): ConversionTrackingView {
  return {
    metaPixelId: row?.metaPixelId ?? null,
    metaAccessTokenMasked: maskSecret(safeDecrypt(row?.metaAccessTokenEnc ?? null)),
    tiktokPixelId: row?.tiktokPixelId ?? null,
    tiktokAccessTokenMasked: maskSecret(safeDecrypt(row?.tiktokAccessTokenEnc ?? null)),
    ga4MeasurementId: row?.ga4MeasurementId ?? null,
    ga4ApiSecretMasked: maskSecret(safeDecrypt(row?.ga4ApiSecretEnc ?? null)),
    activeProviders: activeProvidersOf(row),
  };
}

export async function getConversionTracking(sellerId: string): Promise<ConversionTrackingView> {
  const [row] = await db.select().from(sellerConversionTracking).where(eq(sellerConversionTracking.sellerId, sellerId)).limit(1);
  return trackingView(row);
}

export class TrackingStorageUnavailable extends Error {}

/** Applies a validated patch (secrets encrypted) and returns the new view. */
export async function saveConversionTracking(sellerId: string, patch: ValidatedTrackingPatch): Promise<ConversionTrackingView> {
  const needsEncryption = [patch.metaAccessToken, patch.tiktokAccessToken, patch.ga4ApiSecret].some((v) => typeof v === "string");
  if (needsEncryption && !hasMetaTokenEncryptionKey()) {
    throw new TrackingStorageUnavailable("Secret storage isn't configured on the server.");
  }
  const enc = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : encryptToken(v));
  const set: Partial<typeof sellerConversionTracking.$inferInsert> = { updatedAt: new Date() };
  if (patch.metaPixelId !== undefined) set.metaPixelId = patch.metaPixelId;
  if (patch.metaAccessToken !== undefined) set.metaAccessTokenEnc = enc(patch.metaAccessToken);
  if (patch.tiktokPixelId !== undefined) set.tiktokPixelId = patch.tiktokPixelId;
  if (patch.tiktokAccessToken !== undefined) set.tiktokAccessTokenEnc = enc(patch.tiktokAccessToken);
  if (patch.ga4MeasurementId !== undefined) set.ga4MeasurementId = patch.ga4MeasurementId;
  if (patch.ga4ApiSecret !== undefined) set.ga4ApiSecretEnc = enc(patch.ga4ApiSecret);
  const [row] = await db.insert(sellerConversionTracking)
    .values({ sellerId, ...set })
    .onConflictDoUpdate({ target: sellerConversionTracking.sellerId, set })
    .returning();
  return trackingView(row);
}

// ─── Hashing (each provider's normalisation) ──────────────────────────────────

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** Meta and TikTok: trim + lower-case, then SHA-256 (hex). */
export function hashEmailBasic(email: string | null | undefined): string | null {
  const clean = (email ?? "").trim().toLowerCase();
  return clean && clean.includes("@") ? sha256Hex(clean) : null;
}

/**
 * GA4 user-provided data: trim + lower-case, and for gmail.com /
 * googlemail.com remove dots from the local part, then SHA-256 (hex).
 */
export function hashEmailGa4(email: string | null | undefined): string | null {
  const clean = (email ?? "").trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at <= 0) return null;
  let local = clean.slice(0, at);
  const domain = clean.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
  return sha256Hex(`${local}@${domain}`);
}

// ─── Payloads ─────────────────────────────────────────────────────────────────

export interface PurchaseEvent {
  orderId: string;
  orderNumber: string;
  sellerId: string;
  buyerId: string | null;
  email: string | null;
  valueCents: number;
  taxCents: number;
  shippingCents: number;
  currency: string;
  paidAt: Date;
  items: Array<{ productId: string | null; name: string; quantity: number; priceCents: number }>;
}

const cents = (value: number) => Math.round(value) / 100;

export function metaPurchasePayload(event: PurchaseEvent) {
  const em = hashEmailBasic(event.email);
  return {
    data: [{
      event_name: "Purchase",
      event_time: Math.floor(event.paidAt.getTime() / 1000),
      event_id: event.orderId,
      action_source: "other",
      user_data: {
        ...(em ? { em: [em] } : {}),
        ...(event.buyerId ? { external_id: [sha256Hex(event.buyerId)] } : {}),
      },
      custom_data: {
        currency: event.currency,
        value: cents(event.valueCents),
        order_id: event.orderNumber,
        content_type: "product",
        content_ids: event.items.map((i) => i.productId).filter(Boolean),
        contents: event.items.map((i) => ({ id: i.productId ?? i.name, quantity: i.quantity, item_price: cents(i.priceCents) })),
        num_items: event.items.reduce((n, i) => n + i.quantity, 0),
      },
    }],
  };
}

export function tiktokPurchasePayload(event: PurchaseEvent, pixelId: string) {
  const email = hashEmailBasic(event.email);
  return {
    event_source: "web",
    event_source_id: pixelId,
    data: [{
      event: "CompletePayment",
      event_time: Math.floor(event.paidAt.getTime() / 1000),
      event_id: event.orderId,
      user: {
        ...(email ? { email } : {}),
        ...(event.buyerId ? { external_id: sha256Hex(event.buyerId) } : {}),
      },
      properties: {
        currency: event.currency,
        value: cents(event.valueCents),
        order_id: event.orderNumber,
        content_type: "product",
        contents: event.items.map((i) => ({
          content_id: i.productId ?? i.name, content_name: i.name, quantity: i.quantity, price: cents(i.priceCents),
        })),
      },
    }],
  };
}

export function ga4PurchasePayload(event: PurchaseEvent) {
  const email = hashEmailGa4(event.email);
  // GA4 needs a client_id; a server-side purchase has no browser cookie, so
  // a stable pseudonymous one is derived from the buyer (or the order).
  const clientSeed = sha256Hex(event.buyerId ?? event.email ?? event.orderId);
  const clientId = `${parseInt(clientSeed.slice(0, 8), 16)}.${parseInt(clientSeed.slice(8, 16), 16)}`;
  return {
    client_id: clientId,
    ...(event.buyerId ? { user_id: sha256Hex(event.buyerId) } : {}),
    timestamp_micros: event.paidAt.getTime() * 1000,
    ...(email ? { user_data: { sha256_email_address: [email] } } : {}),
    events: [{
      name: "purchase",
      params: {
        transaction_id: event.orderId,
        currency: event.currency,
        value: cents(event.valueCents),
        tax: cents(event.taxCents),
        shipping: cents(event.shippingCents),
        items: event.items.map((i) => ({
          item_id: i.productId ?? i.name, item_name: i.name, quantity: i.quantity, price: cents(i.priceCents),
        })),
      },
    }],
  };
}

// ─── Sending ──────────────────────────────────────────────────────────────────

class ProviderError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

type FetchLike = typeof fetch;

async function postJson(fetchImpl: FetchLike, url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new ProviderError(`HTTP ${response.status}: ${text.slice(0, 300)}`, response.status);
  return text;
}

export async function sendToProvider(
  provider: ConversionProvider,
  event: PurchaseEvent,
  creds: { id: string; secret: string },
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (provider === "meta") {
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(creds.id)}/events?access_token=${encodeURIComponent(creds.secret)}`;
    await postJson(fetchImpl, url, metaPurchasePayload(event));
    return;
  }
  if (provider === "tiktok") {
    const text = await postJson(fetchImpl, "https://business-api.tiktok.com/open_api/v1.3/event/track/",
      tiktokPurchasePayload(event, creds.id), { "Access-Token": creds.secret });
    // TikTok answers HTTP 200 with a non-zero code on failure.
    let code: unknown = 0;
    try { code = JSON.parse(text)?.code; } catch { /* not JSON: treat as success */ }
    if (code !== 0 && code !== undefined) throw new ProviderError(`TikTok code ${String(code)}: ${text.slice(0, 300)}`, 400);
    return;
  }
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(creds.id)}&api_secret=${encodeURIComponent(creds.secret)}`;
  await postJson(fetchImpl, url, ga4PurchasePayload(event));
}

/** The paid order as a Purchase event (null when it doesn't exist or isn't paid). */
export async function loadPurchaseEvent(orderId: string): Promise<PurchaseEvent | null> {
  const [order] = await db.select({
    id: orders.id, orderNumber: orders.orderNumber, ownerId: orders.ownerId, buyerId: orders.buyerId,
    guestEmail: orders.guestEmail, totalCents: orders.totalCents, taxCents: orders.taxCents,
    shippingCents: orders.shippingCents, paidAt: orders.paidAt, createdAt: orders.createdAt, status: orders.status,
  }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || !order.paidAt || order.status === "refund_pending" || order.status === "cancelled") return null;
  let email = order.guestEmail ?? null;
  if (!email && order.buyerId) {
    const [buyer] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, order.buyerId)).limit(1);
    email = buyer?.email ?? null;
  }
  const items = await db.select({
    productId: productVariants.productId, name: orderItems.productName, quantity: orderItems.quantity, priceCents: orderItems.priceCents,
  }).from(orderItems).leftJoin(productVariants, eq(productVariants.id, orderItems.variantId)).where(eq(orderItems.orderId, orderId));
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    sellerId: order.ownerId,
    buyerId: order.buyerId,
    email,
    valueCents: order.totalCents,
    taxCents: order.taxCents ?? 0,
    shippingCents: order.shippingCents ?? 0,
    currency: "USD",
    paidAt: order.paidAt,
    items: items.map((i) => ({ productId: i.productId ?? null, name: i.name, quantity: i.quantity, priceCents: i.priceCents })),
  };
}

/**
 * Sends the order's Purchase event to every provider the seller configured.
 * Never throws: tracking must not affect the order. Returns per-provider
 * outcomes (for logs and tests).
 */
export async function sendPurchaseConversions(
  orderId: string,
  options: { fetchImpl?: FetchLike; retryDelayMs?: number } = {},
): Promise<Partial<Record<ConversionProvider, "sent" | "skipped" | "failed">>> {
  const outcome: Partial<Record<ConversionProvider, "sent" | "skipped" | "failed">> = {};
  try {
    const event = await loadPurchaseEvent(orderId);
    if (!event) return outcome;
    const [row] = await db.select().from(sellerConversionTracking)
      .where(eq(sellerConversionTracking.sellerId, event.sellerId)).limit(1);
    const providers = activeProvidersOf(row);
    for (const provider of providers) {
      const creds = provider === "meta"
        ? { id: row!.metaPixelId!, secret: safeDecrypt(row!.metaAccessTokenEnc) }
        : provider === "tiktok"
          ? { id: row!.tiktokPixelId!, secret: safeDecrypt(row!.tiktokAccessTokenEnc) }
          : { id: row!.ga4MeasurementId!, secret: safeDecrypt(row!.ga4ApiSecretEnc) };
      if (!creds.secret) { outcome[provider] = "failed"; continue; }

      // Idempotent per order + provider: claim the row; skip once 'sent'.
      await db.insert(conversionEventDeliveries)
        .values({ orderId, sellerId: event.sellerId, provider })
        .onConflictDoNothing({ target: [conversionEventDeliveries.orderId, conversionEventDeliveries.provider] });
      const [delivery] = await db.select().from(conversionEventDeliveries)
        .where(and(eq(conversionEventDeliveries.orderId, orderId), eq(conversionEventDeliveries.provider, provider))).limit(1);
      if (delivery?.status === "sent") { outcome[provider] = "skipped"; continue; }

      let attempts = 0;
      try {
        await withRetry(async () => {
          attempts += 1;
          await sendToProvider(provider, event, { id: creds.id, secret: creds.secret! }, options.fetchImpl);
        }, { attempts: 3, baseDelayMs: options.retryDelayMs ?? 500, label: `conversion.${provider}` });
        await db.update(conversionEventDeliveries).set({
          status: "sent", attempts: (delivery?.attempts ?? 0) + attempts, lastError: null, sentAt: new Date(), updatedAt: new Date(),
        }).where(and(eq(conversionEventDeliveries.orderId, orderId), eq(conversionEventDeliveries.provider, provider)));
        outcome[provider] = "sent";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.update(conversionEventDeliveries).set({
          status: "failed", attempts: (delivery?.attempts ?? 0) + attempts, lastError: message.slice(0, 500), updatedAt: new Date(),
        }).where(and(eq(conversionEventDeliveries.orderId, orderId), eq(conversionEventDeliveries.provider, provider)));
        logger.warn({ orderId, provider, attempts, err: message }, "Conversion event delivery failed");
        outcome[provider] = "failed";
      }
    }
  } catch (err) {
    logger.error({ err, orderId }, "Conversion tracking failed");
  }
  return outcome;
}
