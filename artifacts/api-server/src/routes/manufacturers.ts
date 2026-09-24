import express, { Router } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  manufacturers,
  manufacturerPayments,
  manufacturerThreads,
  manufacturerMessages,
  manufacturerInviteTokens,
  savedManufacturers,
  sampleOrders,
  manufacturerThreadAttachments,
  manufacturerRelationships,
  sellerQuoteRequests,
  manufacturerReviews,
  users,
} from "@workspace/db";
import { eq, desc, and, sql, inArray, isNull } from "drizzle-orm";
import crypto from "crypto";
import {
  RegisterManufacturerBody,
  UpdateMyManufacturerProfileBody,
  SendThreadMessageBody,
  SetupManufacturerPaymentBody,
  ReorderMyManufacturerPhotosBody,
  DeleteMyManufacturerPhotoBody,
  DeleteMyManufacturerPhotoParams,
} from "@workspace/api-zod";
import { requireAuth, requirePlan } from "../middlewares/requireAuth";
import { teamContext } from "../middlewares/requireRole";
import { getWebOrigin } from "../lib/webOrigin";
import { ObjectStorageService } from "../lib/objectStorage";
import { sendManufacturerSignupEmail } from "../lib/brandthreadEmail";
import { logger } from "../lib/logger";
import { publishNotification } from "./notifications-feed";
import { findCountry, isValidTimeZone, validateTransition } from "@workspace/manufacturer-flow";
import { afterStageChange, attachOrderSnapshots, postThreadSystemMessage } from "../lib/manufacturerOrders";

const router = Router();
const objectStorage = new ObjectStorageService();
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_MESSAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

async function signedProfilePhotos(storedPhotos: unknown): Promise<string[]> {
  if (!Array.isArray(storedPhotos)) return [];
  return Promise.all(storedPhotos
    .filter((path): path is string => typeof path === "string" && path.startsWith("/objects/"))
    .map((path) => objectStorage.getObjectEntityDownloadURL(path)));
}

function storedProfilePhotos(storedPhotos: unknown): string[] {
  if (!Array.isArray(storedPhotos)) return [];
  return storedPhotos.filter((path): path is string =>
    typeof path === "string" && path.startsWith("/objects/"),
  );
}

async function serializeMyManufacturer(mfr: typeof manufacturers.$inferSelect) {
  return {
    ...mfr,
    photos: await signedProfilePhotos(mfr.photos),
    verifiedAt: mfr.verifiedAt?.toISOString() ?? null,
    createdAt: mfr.createdAt.toISOString(),
    updatedAt: mfr.updatedAt.toISOString(),
  };
}

function profilePhotoConflict(res: express.Response) {
  return res.status(409).json({
    error: "Profile changed since it was loaded; refresh and review the latest photos",
    code: "STALE_WRITE",
  });
}

const requireGrowthSeller = [requireAuth, teamContext(), requirePlan("growth")] as const;

function isSupportedImage(buffer: Buffer): boolean {
  return (
    (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP")
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const MANUFACTURER_QUOTE_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  submitted: new Set(["viewed", "questions_asked", "quoted", "declined"]),
  viewed: new Set(["questions_asked", "quoted", "declined"]),
  questions_asked: new Set(["quoted", "declined"]),
  counteroffer_sent: new Set(["quoted", "declined"]),
};

export function canManufacturerTransitionQuote(from: string, to: string): boolean {
  return MANUFACTURER_QUOTE_TRANSITIONS[from]?.has(to) === true;
}

function serializeQuoteRequest(row: typeof sellerQuoteRequests.$inferSelect) {
  return {
    ...row,
    quoteValidUntil: row.quoteValidUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Helper ─────────────────────────────────────────────────────────────────────

/** A valid IANA zone from the client, else the country's main zone, else null. */
export function resolveTimeZone(supplied: unknown, country: string | null | undefined): string | null {
  if (isValidTimeZone(supplied)) return supplied;
  return findCountry(country)?.timeZone ?? null;
}

async function resolveManufacturer(clerkId: string) {
  const [mfr] = await db
    .select()
    .from(manufacturers)
    .where(eq(manufacturers.clerkId, clerkId))
    .limit(1);
  return mfr ?? null;
}

async function resolveManufacturerEmail(clerkId: string, suppliedEmail?: string | null): Promise<string | null> {
  const normalized = suppliedEmail?.trim();
  if (normalized) return normalized;
  try {
    const clerkUser = await clerkClient.users.getUser(clerkId);
    return clerkUser.primaryEmailAddress?.emailAddress
      ?? clerkUser.emailAddresses[0]?.emailAddress
      ?? null;
  } catch (err) {
    logger.warn({ err, clerkId }, "Unable to resolve manufacturer signup email recipient");
    return null;
  }
}

function serializeSampleOrder(order: typeof sampleOrders.$inferSelect) {
  return {
    ...order,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    shippedAt: order.shippedAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
  };
}

/** Adds the seller's brand name so manufacturers never see raw account ids. */
async function withSellerNames<T extends { sellerId: string }>(orders: T[]): Promise<Array<T & { sellerName: string }>> {
  const sellerIds = [...new Set(orders.map((order) => order.sellerId))];
  const rows = sellerIds.length === 0 ? [] : await db.select({
    clerkId: users.clerkId, brandName: users.brandName, displayName: users.displayName, name: users.name,
  }).from(users).where(inArray(users.clerkId, sellerIds));
  const names = new Map(rows.map((row) => [row.clerkId, row.brandName?.trim() || row.displayName?.trim() || row.name?.trim() || "Seller"]));
  return orders.map((order) => ({ ...order, sellerName: names.get(order.sellerId) ?? "Seller" }));
}

async function serializeManufacturerOrderDetail(order: typeof sampleOrders.$inferSelect) {
  const serialized = serializeSampleOrder(order);
  const imageUrls = await Promise.all((order.imageUrls ?? []).map((path) =>
    path.startsWith("/objects/") ? objectStorage.getObjectEntityDownloadURL(path).catch(() => null) : Promise.resolve(path),
  ));
  return { ...serialized, imageUrls: imageUrls.filter((url): url is string => !!url) };
}

function sellerOrderNotificationContext(order: Pick<typeof sampleOrders.$inferSelect, "id" | "orderType">) {
  return {
    targetType: order.orderType === "bulk" ? "bulk_order" : "sample_order",
    cta: order.orderType === "bulk" ? `/bulk-orders/${order.id}` : `/sample-orders/${order.id}`,
  };
}
export async function serializeMessage(message: typeof manufacturerMessages.$inferSelect) {
  const objectPaths = (message.mediaUrls ?? []).filter((value) => value.startsWith("/objects/"));
  const boundPaths = new Set(objectPaths.length === 0 ? [] : (await db
    .select({ objectPath: manufacturerThreadAttachments.objectPath })
    .from(manufacturerThreadAttachments)
    .where(and(
      eq(manufacturerThreadAttachments.threadId, message.threadId),
      inArray(manufacturerThreadAttachments.objectPath, objectPaths),
    ))).map((attachment) => attachment.objectPath));
  const mediaUrls = await Promise.all((message.mediaUrls ?? []).map(async (value) => {
    // New messages retain a private object path. Older records may hold an
    // already-public URL, which must not be handed to the storage signer.
    if (!value.startsWith("/objects/")) return value;
    if (!boundPaths.has(value)) return null;
    return objectStorage.getObjectEntityDownloadURL(value).catch(() => null);
  }));
  return {
    ...message,
    senderId: message.senderClerkId ?? await resolveLegacyMessageSender(message),
    mediaUrls: mediaUrls.filter((url): url is string => !!url),
    sentAt: message.sentAt.toISOString(),
  };
}

async function resolveLegacyMessageSender(message: typeof manufacturerMessages.$inferSelect) {
  const [participant] = await db.select({
    sellerId: manufacturerThreads.buyerClerkId,
    manufacturerClerkId: manufacturers.clerkId,
  }).from(manufacturerThreads)
    .leftJoin(manufacturers, eq(manufacturerThreads.manufacturerId, manufacturers.id))
    .where(eq(manufacturerThreads.id, message.threadId))
    .limit(1);
  return message.senderRole === "manufacturer"
    ? participant?.manufacturerClerkId ?? "legacy-manufacturer"
    : participant?.sellerId ?? "legacy-seller";
}

function serializeRelationship(row: typeof manufacturerRelationships.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function mediaAreBoundToSender(threadId: string, uploaderClerkId: string, mediaUrls: string[]) {
  if (mediaUrls.length === 0) return true;
  if (mediaUrls.some((url) => !url.startsWith("/objects/"))) return false;
  const attachments = await db.select({ objectPath: manufacturerThreadAttachments.objectPath })
    .from(manufacturerThreadAttachments)
    .where(and(
      eq(manufacturerThreadAttachments.threadId, threadId),
      eq(manufacturerThreadAttachments.uploaderClerkId, uploaderClerkId),
      isNull(manufacturerThreadAttachments.consumedAt),
      inArray(manufacturerThreadAttachments.objectPath, mediaUrls),
    ));
  return attachments.length === new Set(mediaUrls).size;
}

async function cardIsBoundToThread(
  threadId: string,
  manufacturerId: string,
  sellerId: string,
  messageType: string,
  cardData: Record<string, unknown> | null | undefined,
) {
  if (messageType !== "sample_card" && messageType !== "bulk_card") return true;
  const orderId = cardData?.orderId;
  if (!isUuid(orderId)) return false;
  const [order] = await db.select({ id: sampleOrders.id }).from(sampleOrders).where(and(
    eq(sampleOrders.id, orderId),
    eq(sampleOrders.threadId, threadId),
    eq(sampleOrders.manufacturerId, manufacturerId),
    eq(sampleOrders.sellerId, sellerId),
    eq(sampleOrders.orderType, messageType === "bulk_card" ? "bulk" : "sample"),
  )).limit(1);
  return !!order;
}

function isSameMessageSubmission(
  existing: typeof manufacturerMessages.$inferSelect,
  input: {
    content?: string;
    messageType?: string;
    mediaUrls?: string[];
    cardData?: Record<string, unknown> | null;
  },
) {
  return existing.content === (input.content ?? "")
    && existing.messageType === (input.messageType ?? "text")
    && JSON.stringify(existing.mediaUrls ?? []) === JSON.stringify(input.mediaUrls ?? [])
    && JSON.stringify(existing.cardData ?? null) === JSON.stringify(input.cardData ?? null);
}

export function isSupportedAttachment(bytes: Buffer, contentType: string) {
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const isPdf = bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  return (contentType === "image/jpeg" && isJpeg)
    || (contentType === "image/png" && isPng)
    || (contentType === "image/webp" && isWebp)
    || (contentType === "application/pdf" && isPdf);
}

async function notify(req: express.Request, notification: Parameters<typeof publishNotification>[0]) {
  try {
    await publishNotification(notification);
  } catch (err) {
    req.log.error({ err, userId: notification.userId, type: notification.type }, "Manufacturer notification delivery failed");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FAVORITES — seller-scoped saved manufacturers, separate from relationships
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/favorites", ...requireGrowthSeller, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const rows = await db
    .select({
      manufacturerId: savedManufacturers.manufacturerId,
      createdAt: savedManufacturers.createdAt,
    })
    .from(savedManufacturers)
    .where(eq(savedManufacturers.sellerId, sellerId))
    .orderBy(desc(savedManufacturers.createdAt));

  res.json(rows.map((row) => ({
    manufacturerId: row.manufacturerId,
    createdAt: row.createdAt.toISOString(),
  })));
});

router.post("/favorites", ...requireGrowthSeller, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { manufacturerId } = req.body ?? {};
  if (!isUuid(manufacturerId)) {
    res.status(400).json({ error: "A valid manufacturerId is required" });
    return;
  }

  const [manufacturer] = await db
    .select({ id: manufacturers.id })
    .from(manufacturers)
    .where(and(
      eq(manufacturers.id, manufacturerId),
      eq(manufacturers.status, "active"),
      eq(manufacturers.isPublicDirectory, true),
    ))
    .limit(1);

  if (!manufacturer) {
    res.status(404).json({ error: "Manufacturer not found" });
    return;
  }

  await db.insert(savedManufacturers)
    .values({ sellerId, manufacturerId })
    .onConflictDoNothing({
      target: [savedManufacturers.sellerId, savedManufacturers.manufacturerId],
    });

  const [saved] = await db
    .select({
      manufacturerId: savedManufacturers.manufacturerId,
      createdAt: savedManufacturers.createdAt,
    })
    .from(savedManufacturers)
    .where(and(
      eq(savedManufacturers.sellerId, sellerId),
      eq(savedManufacturers.manufacturerId, manufacturerId),
    ))
    .limit(1);

  res.status(201).json({
    manufacturerId: saved.manufacturerId,
    createdAt: saved.createdAt.toISOString(),
  });
});

router.delete("/favorites/:manufacturerId", ...requireGrowthSeller, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { manufacturerId } = req.params;
  if (!isUuid(manufacturerId)) {
    res.status(400).json({ error: "A valid manufacturerId is required" });
    return;
  }

  await db.delete(savedManufacturers).where(and(
    eq(savedManufacturers.sellerId, sellerId),
    eq(savedManufacturers.manufacturerId, manufacturerId),
  ));

  res.json({ ok: true });
});

router.get("/relationships", ...requireGrowthSeller, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const rows = await db.select({ relationship: manufacturerRelationships, manufacturer: manufacturers })
    .from(manufacturerRelationships)
    .innerJoin(manufacturers, eq(manufacturerRelationships.manufacturerId, manufacturers.id))
    .where(eq(manufacturerRelationships.sellerId, sellerId))
    .orderBy(desc(manufacturerRelationships.updatedAt));
  const manufacturerIds = rows.map((row) => row.manufacturer.id);
  const [orderStats, threads] = manufacturerIds.length === 0 ? [[], []] : await Promise.all([
    db.select({
      manufacturerId: sampleOrders.manufacturerId,
      total: sql<number>`count(*)::integer`,
      active: sql<number>`count(*) FILTER (WHERE ${sampleOrders.status} NOT IN ('delivered','cancelled','approved','rejected','complete','completed'))::integer`,
      awaitingPayment: sql<number>`count(*) FILTER (WHERE ${sampleOrders.status} = 'pending_payment')::integer`,
    }).from(sampleOrders)
      .where(and(eq(sampleOrders.sellerId, sellerId), inArray(sampleOrders.manufacturerId, manufacturerIds)))
      .groupBy(sampleOrders.manufacturerId),
    db.select({ id: manufacturerThreads.id, manufacturerId: manufacturerThreads.manufacturerId, unread: manufacturerThreads.sellerUnreadCount })
      .from(manufacturerThreads)
      .where(and(eq(manufacturerThreads.buyerClerkId, sellerId), inArray(manufacturerThreads.manufacturerId, manufacturerIds))),
  ]);
  const statsById = new Map(orderStats.map((row) => [row.manufacturerId, row]));
  const threadById = new Map(threads.map((row) => [row.manufacturerId, row]));
  res.json(await Promise.all(rows.map(async ({ relationship, manufacturer }) => ({
    ...serializeRelationship(relationship),
    manufacturer: {
      id: manufacturer.id,
      businessName: manufacturer.businessName,
      country: manufacturer.country,
      city: manufacturer.city,
      specialty: manufacturer.specialty,
      yearsInBusiness: manufacturer.yearsInBusiness,
      moq: manufacturer.moq,
      timeZone: manufacturer.timeZone,
      isPublicDirectory: manufacturer.isPublicDirectory,
      isVerified: !!manufacturer.verifiedAt,
      payoutReady: manufacturer.paymentSetup,
      photo: (await signedProfilePhotos((manufacturer.photos ?? []).slice(0, 1)))[0] ?? null,
    },
    totalOrders: statsById.get(manufacturer.id)?.total ?? 0,
    activeOrders: statsById.get(manufacturer.id)?.active ?? 0,
    awaitingPayment: statsById.get(manufacturer.id)?.awaitingPayment ?? 0,
    threadId: threadById.get(manufacturer.id)?.id ?? null,
    unreadCount: threadById.get(manufacturer.id)?.unread ?? 0,
  }))));
});

// Seller-scoped profile: public directory listings, plus private manufacturers
// the seller is connected to (for example ones they invited).
router.get("/partners/:manufacturerId", ...requireGrowthSeller, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const manufacturerId = String(req.params.manufacturerId);
  if (!isUuid(manufacturerId)) { res.status(404).json({ error: "Manufacturer not found" }); return; }
  const [row] = await db.select({ manufacturer: manufacturers, relationshipId: manufacturerRelationships.id })
    .from(manufacturers)
    .leftJoin(manufacturerRelationships, and(
      eq(manufacturerRelationships.manufacturerId, manufacturers.id),
      eq(manufacturerRelationships.sellerId, sellerId),
    ))
    .where(and(eq(manufacturers.id, manufacturerId), eq(manufacturers.status, "active")))
    .limit(1);
  if (!row || (!row.manufacturer.isPublicDirectory && !row.relationshipId)) {
    res.status(404).json({ error: "Manufacturer not found" }); return;
  }
  const m = row.manufacturer;
  const [summary] = await db.select({
    reviewCount: sql<number>`count(*)::integer`,
    rating: sql<number | null>`round(avg(${manufacturerReviews.rating})::numeric, 2)::float`,
  }).from(manufacturerReviews).where(eq(manufacturerReviews.manufacturerId, m.id));
  res.json({
    id: m.id,
    businessName: m.businessName,
    country: m.country,
    city: m.city,
    specialty: m.specialty,
    description: m.description,
    yearsInBusiness: m.yearsInBusiness,
    moq: m.moq,
    priceRange: m.priceRange,
    bulkTurnaround: m.bulkTurnaround,
    sampleTurnaround: m.sampleTurnaround,
    photos: await signedProfilePhotos(m.photos),
    website: m.website,
    timeZone: m.timeZone,
    responseTime: m.responseTime || null,
    isVerified: !!m.verifiedAt,
    isPublicDirectory: m.isPublicDirectory,
    isConnected: !!row.relationshipId,
    rating: summary?.reviewCount ? Number(summary.rating) : null,
    reviewCount: summary?.reviewCount ?? 0,
    reviews: [],
    verifiedAt: m.verifiedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    revision: m.revision,
  });
});

router.post("/relationships", ...requireGrowthSeller, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const manufacturerId = req.body?.manufacturerId;
  if (!isUuid(manufacturerId)) {
    res.status(400).json({ error: "A canonical manufacturer UUID is required" }); return;
  }
  const [manufacturer] = await db.select({ id: manufacturers.id }).from(manufacturers)
    .where(and(eq(manufacturers.id, manufacturerId), eq(manufacturers.status, "active")))
    .limit(1);
  if (!manufacturer) { res.status(404).json({ error: "Manufacturer not found" }); return; }
  const [created] = await db.insert(manufacturerRelationships)
    .values({ sellerId, manufacturerId })
    .onConflictDoNothing()
    .returning();
  const relationship = created ?? (await db.select().from(manufacturerRelationships).where(and(
    eq(manufacturerRelationships.sellerId, sellerId),
    eq(manufacturerRelationships.manufacturerId, manufacturerId),
  )).limit(1))[0];
  if (!relationship) { res.status(500).json({ error: "Unable to create relationship" }); return; }
  res.status(created ? 201 : 200).json(serializeRelationship(relationship));
});

router.get("/me/relationships", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });
  const rows = await db.select().from(manufacturerRelationships)
    .where(eq(manufacturerRelationships.manufacturerId, mfr.id))
    .orderBy(desc(manufacturerRelationships.updatedAt));
  return res.json(rows.map(serializeRelationship));
});

// Manufacturer-scoped quote inbox and responses. These endpoints operate on
// the same seller_quote_requests rows read by the seller mobile Hub.
router.get("/me/quote-requests", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });
  const rows = await db.select().from(sellerQuoteRequests)
    .where(eq(sellerQuoteRequests.manufacturerId, mfr.id))
    .orderBy(desc(sellerQuoteRequests.createdAt));
  return res.json(rows.map(serializeQuoteRequest));
});

router.patch("/me/quote-requests/:id", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });
  const [existing] = await db.select().from(sellerQuoteRequests).where(and(
    eq(sellerQuoteRequests.id, req.params.id),
    eq(sellerQuoteRequests.manufacturerId, mfr.id),
  )).limit(1);
  if (!existing) return res.status(404).json({ error: "Quote request not found" });

  const { status, quotedPriceCents, quotedTurnaround, validUntil, notes, counterofferStatus } = req.body as {
    status?: string;
    quotedPriceCents?: number;
    quotedTurnaround?: string;
    validUntil?: string;
    notes?: string;
    counterofferStatus?: "accepted" | "declined";
  };
  if (!status || !canManufacturerTransitionQuote(existing.status, status)) {
    return res.status(409).json({ error: `Cannot move quote request from ${existing.status} to ${status ?? "an unspecified status"}` });
  }
  if (status === "quoted" && (!Number.isInteger(quotedPriceCents) || (quotedPriceCents ?? 0) < 1)) {
    return res.status(400).json({ error: "quotedPriceCents must be a positive integer" });
  }
  const quoteValidUntil = validUntil ? new Date(validUntil) : null;
  if (validUntil && Number.isNaN(quoteValidUntil?.getTime())) {
    return res.status(400).json({ error: "validUntil must be a valid date" });
  }
  if (quoteValidUntil && quoteValidUntil.getTime() <= Date.now()) {
    return res.status(400).json({ error: "validUntil must be in the future" });
  }
  if (counterofferStatus && existing.status !== "counteroffer_sent") {
    return res.status(409).json({ error: "There is no pending counteroffer to resolve" });
  }

  const [updated] = await db.update(sellerQuoteRequests).set({
    status,
    quotedPriceCents: status === "quoted" ? quotedPriceCents : existing.quotedPriceCents,
    quotedTurnaround: status === "quoted" ? quotedTurnaround?.trim() || null : existing.quotedTurnaround,
    quoteValidUntil: status === "quoted" ? quoteValidUntil : existing.quoteValidUntil,
    notes: notes?.trim() || existing.notes,
    counteroffer: counterofferStatus && existing.counteroffer
      ? { ...existing.counteroffer, status: counterofferStatus }
      : existing.counteroffer,
    updatedAt: new Date(),
  }).where(and(
    eq(sellerQuoteRequests.id, existing.id),
    eq(sellerQuoteRequests.manufacturerId, mfr.id),
    eq(sellerQuoteRequests.status, existing.status),
  )).returning();
  if (!updated) return res.status(409).json({ error: "Quote request changed; refresh and try again" });
  return res.json(serializeQuoteRequest(updated));
});

// ═══════════════════════════════════════════════════════════════════════════════
// INVITE TOKENS — seller creates private invite links for manufacturers
// ═══════════════════════════════════════════════════════════════════════════════

// Private invites land on the manufacturer portal's join page, which signs the
// manufacturer up (or in) and binds them to the inviting seller only.
export function manufacturerInviteUrl(token: string) {
  return `${getWebOrigin()}/manufacturers/join?invite=${encodeURIComponent(token)}`;
}

async function sellerDisplayName(sellerId: string) {
  const [seller] = await db.select({ brandName: users.brandName, displayName: users.displayName, name: users.name })
    .from(users).where(eq(users.clerkId, sellerId)).limit(1);
  return seller?.brandName?.trim() || seller?.displayName?.trim() || seller?.name?.trim() || "A Brandthread seller";
}

function serializeInvite(inv: typeof manufacturerInviteTokens.$inferSelect) {
  return {
    ...inv,
    inviteUrl: manufacturerInviteUrl(inv.token),
    status: inv.usedAt ? "accepted" : "pending",
    usedAt: inv.usedAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
  };
}

function cleanOptional(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

// POST /api/manufacturers/invite-tokens — seller creates a private invite token
router.post("/invite-tokens", ...requireGrowthSeller, async (req, res) => {
  const sellerId   = (req as any).clerkUserId as string;
  const companyName = cleanOptional(req.body?.companyName, 200);
  const contactName = cleanOptional(req.body?.contactName, 200);
  const contactEmail = cleanOptional(req.body?.contactEmail, 320);
  const notes = cleanOptional(req.body?.notes, 2000);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    res.status(400).json({ error: "Enter a valid email address or leave it blank." }); return;
  }

  const token = crypto.randomBytes(24).toString("hex");

  const [inv] = await db
    .insert(manufacturerInviteTokens)
    .values({ sellerId, token, companyName, contactName, contactEmail, notes })
    .returning();

  res.status(201).json(serializeInvite(inv));
});

// GET /api/manufacturers/invite-tokens — seller lists their tokens
router.get("/invite-tokens", ...requireGrowthSeller, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const rows = await db
    .select({ invite: manufacturerInviteTokens, manufacturerName: manufacturers.businessName })
    .from(manufacturerInviteTokens)
    .leftJoin(manufacturers, eq(manufacturerInviteTokens.manufacturerId, manufacturers.id))
    .where(eq(manufacturerInviteTokens.sellerId, sellerId))
    .orderBy(desc(manufacturerInviteTokens.createdAt));

  res.json(rows.map(({ invite, manufacturerName }) => ({ ...serializeInvite(invite), manufacturerName })));
});

// GET /api/manufacturers/invite-tokens/resolve/:token — look up an invite token (no auth — for onboard form)
router.get("/invite-tokens/resolve/:token", async (req, res) => {
  const [inv] = await db
    .select()
    .from(manufacturerInviteTokens)
    .where(eq(manufacturerInviteTokens.token, req.params.token))
    .limit(1);

  if (!inv) { res.status(404).json({ error: "This invite link isn't valid. Ask the seller to send a new one." }); return; }
  if (inv.usedAt) { res.status(410).json({ error: "This invite has already been used. Sign in to continue." }); return; }

  res.json({
    valid:        true,
    sellerName:   await sellerDisplayName(inv.sellerId),
    companyName:  inv.companyName,
    contactName:  inv.contactName,
    contactEmail: inv.contactEmail,
  });
});

async function openInviteThread(sellerId: string, manufacturerId: string, businessName: string) {
  const sellerName = await sellerDisplayName(sellerId);
  const [created] = await db.insert(manufacturerThreads)
    .values({ manufacturerId, buyerClerkId: sellerId, buyerName: sellerName, subject: "Production partnership" })
    .onConflictDoNothing({ target: [manufacturerThreads.manufacturerId, manufacturerThreads.buyerClerkId] })
    .returning();
  const thread = created ?? (await db.select().from(manufacturerThreads).where(and(
    eq(manufacturerThreads.manufacturerId, manufacturerId),
    eq(manufacturerThreads.buyerClerkId, sellerId),
  )).limit(1))[0];
  if (created) {
    await postThreadSystemMessage(db, {
      threadId: created.id,
      content: `${businessName} accepted your invite. This private conversation is where you'll share designs, samples and orders.`,
      notify: "seller",
      dedupeKey: `invite-accepted:${created.id}`,
    });
  }
  return thread;
}

// POST /api/manufacturers/register-via-invite/:token — manufacturer registers through a private invite.
// Invited manufacturers are private by default: they work with the inviting
// seller and stay out of the public directory unless they opt in later.
router.post("/register-via-invite/:token", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [inv] = await db
    .select()
    .from(manufacturerInviteTokens)
    .where(eq(manufacturerInviteTokens.token, req.params.token))
    .limit(1);

  if (!inv) { res.status(404).json({ error: "Invalid invite token" }); return; }
  if (inv.usedAt) { res.status(410).json({ error: "This invite has already been used" }); return; }

  // An existing manufacturer accepting another seller's invite keeps their
  // profile (and directory visibility) and is simply connected to that seller.
  const existing = await resolveManufacturer(userId);
  if (existing) {
    const [claimed] = await db.update(manufacturerInviteTokens)
      .set({ usedAt: new Date(), manufacturerId: existing.id })
      .where(and(eq(manufacturerInviteTokens.id, inv.id), isNull(manufacturerInviteTokens.usedAt)))
      .returning({ id: manufacturerInviteTokens.id });
    if (!claimed) { res.status(410).json({ error: "This invite has already been used" }); return; }
    await db.insert(manufacturerRelationships)
      .values({ sellerId: inv.sellerId, manufacturerId: existing.id })
      .onConflictDoNothing();
    const thread = await openInviteThread(inv.sellerId, existing.id, existing.businessName);
    res.status(200).json({
      ...(await serializeMyManufacturer(existing)),
      invitedBySellerId: inv.sellerId,
      threadId: thread?.id,
    });
    return;
  }

  const parsed = RegisterManufacturerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const mfr = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(manufacturerInviteTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(manufacturerInviteTokens.id, inv.id), isNull(manufacturerInviteTokens.usedAt)))
      .returning({ id: manufacturerInviteTokens.id });
    if (!claimed) return null;
    const [created] = await tx
      .insert(manufacturers)
      .values({
        clerkId:           userId,
        ...parsed.data,
        timeZone:          resolveTimeZone(parsed.data.timeZone, parsed.data.country),
        isPublicDirectory: false,
        status:            "active",
        photos:            [],
      })
      .returning();
    await tx.update(manufacturerInviteTokens)
      .set({ manufacturerId: created.id })
      .where(eq(manufacturerInviteTokens.id, inv.id));
    await tx.insert(manufacturerRelationships)
      .values({ sellerId: inv.sellerId, manufacturerId: created.id })
      .onConflictDoNothing();
    return created;
  });
  if (!mfr) { res.status(410).json({ error: "This invite has already been used" }); return; }
  const thread = await openInviteThread(inv.sellerId, mfr.id, mfr.businessName);

  const signupEmail = await resolveManufacturerEmail(
    userId,
    parsed.data.contactEmail ?? inv.contactEmail,
  );
  if (signupEmail) {
    void sendManufacturerSignupEmail({
      to: signupEmail,
      businessName: mfr.businessName,
      invited: true,
      idempotencyKey: `manufacturer-signup/${mfr.id}`,
    }).then((sent) => {
      if (!sent) req.log.error({ manufacturerId: mfr.id }, "Manufacturer signup email delivery failed");
    }).catch((err) => {
      req.log.error({ err, manufacturerId: mfr.id }, "Manufacturer signup email delivery failed");
    });
  }
  await notify(req, {
    userId: inv.sellerId, category: "message", type: "manufacturer_invite_accepted",
    title: `${mfr.businessName} joined from your invite`,
    body: "Start the conversation and send your first design.",
    actorName: mfr.businessName, targetId: thread?.id ?? mfr.id, targetType: "manufacturer_thread",
    cta: thread ? `/manufacturer-messages?threadId=${thread.id}` : "/manufacturer-hub",
  });

  res.status(201).json({
    ...(await serializeMyManufacturer(mfr)),
    invitedBySellerId: inv.sellerId,
    threadId: thread?.id,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MANUFACTURER PROFILE (manufacturer-facing)
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/me", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });

  return res.json({
    ...mfr,
    photos: await signedProfilePhotos(mfr.photos),
    verifiedAt: mfr.verifiedAt?.toISOString() ?? null,
    createdAt:  mfr.createdAt.toISOString(),
    updatedAt:  mfr.updatedAt.toISOString(),
  });
});

// Store production photos through the authenticated API rather than trusting
// client supplied URLs. Objects stay private and the directory only receives
// time-limited display URLs.
router.post(
  "/me/photos",
  requireAuth,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: MAX_PROFILE_IMAGE_BYTES }),
  async (req, res) => {
    try {
      const clerkId = (req as any).clerkUserId as string;
      const mfr = await resolveManufacturer(clerkId);
      if (!mfr) return res.status(404).json({ error: "Manufacturer profile not found" });
      if ((mfr.photos?.length ?? 0) >= 8) {
        return res.status(409).json({ error: "A maximum of 8 factory photos is allowed" });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0 || !isSupportedImage(req.body)) {
        return res.status(400).json({ error: "Upload a valid JPEG, PNG, or WebP image" });
      }

      const contentType = req.headers["content-type"]?.split(";")[0] ?? "application/octet-stream";
      const objectPath = await objectStorage.createObjectEntityFromBuffer(req.body, contentType);
      let updated: { photos: unknown; revision: number } | undefined;
      try {
        await objectStorage.trySetObjectEntityAclPolicy(objectPath, {
          owner: clerkId,
          visibility: "private",
        });
        [updated] = await db
          .update(manufacturers)
          .set({
            photos: sql`(COALESCE(${manufacturers.photos}::jsonb, '[]'::jsonb) || jsonb_build_array(${objectPath}::text))::json`,
            updatedAt: new Date(),
            revision: sql`${manufacturers.revision} + 1`,
          })
          .where(and(
            eq(manufacturers.id, mfr.id),
            sql`jsonb_array_length(COALESCE(${manufacturers.photos}::jsonb, '[]'::jsonb)) < 8`,
          ))
          .returning({ photos: manufacturers.photos, revision: manufacturers.revision });
        if (!updated) {
          await objectStorage.deleteObjectEntity(objectPath).catch(() => undefined);
          return res.status(409).json({ error: "Profile changed or already has 8 factory photos; refresh and retry" });
        }
      } catch (error) {
        await objectStorage.deleteObjectEntity(objectPath).catch(() => undefined);
        throw error;
      }
      const displayPhotos = await signedProfilePhotos(updated.photos);
      const photo = displayPhotos.at(-1);
      if (!photo) throw new Error("Unable to sign attached profile photo");
      return res.status(201).json({ photo, photos: displayPhotos, revision: updated.revision });
    } catch (error) {
      req.log.error({ err: error }, "Manufacturer photo upload failed");
      return res.status(500).json({ error: "Unable to upload factory image" });
    }
  },
);

router.patch("/me/photos", requireAuth, async (req, res) => {
  const parsed = ReorderMyManufacturerPhotosBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const clerkId = (req as any).clerkUserId as string;
    const mfr = await resolveManufacturer(clerkId);
    if (!mfr) return res.status(404).json({ error: "Manufacturer profile not found" });
    if (mfr.revision !== parsed.data.expectedRevision) {
      return profilePhotoConflict(res);
    }

    const photos = storedProfilePhotos(mfr.photos);
    const { photoOrder } = parsed.data;
    const isCompletePermutation =
      photoOrder.length === photos.length
      && new Set(photoOrder).size === photos.length
      && photoOrder.every((index) => Number.isInteger(index) && index >= 0 && index < photos.length);
    if (!isCompletePermutation) {
      return res.status(400).json({
        error: "photoOrder must include each current photo exactly once",
      });
    }

    const orderedPhotos = photoOrder.map((index) => photos[index]);
    const [updated] = await db
      .update(manufacturers)
      .set({
        photos: orderedPhotos,
        updatedAt: new Date(),
        revision: sql`${manufacturers.revision} + 1`,
      })
      .where(and(
        eq(manufacturers.id, mfr.id),
        eq(manufacturers.revision, parsed.data.expectedRevision),
      ))
      .returning();
    if (!updated) return profilePhotoConflict(res);

    return res.json(await serializeMyManufacturer(updated));
  } catch (error) {
    req.log.error({ err: error }, "Manufacturer photo reorder failed");
    return res.status(500).json({ error: "Unable to reorder factory photos" });
  }
});

router.delete("/me/photos/:photoIndex", requireAuth, async (req, res) => {
  const parsedParams = DeleteMyManufacturerPhotoParams.safeParse(req.params);
  const parsedBody = DeleteMyManufacturerPhotoBody.safeParse(req.body);
  if (!parsedParams.success) {
    return res.status(400).json({ error: parsedParams.error.flatten() });
  }
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.flatten() });
  }

  try {
    const clerkId = (req as any).clerkUserId as string;
    const mfr = await resolveManufacturer(clerkId);
    if (!mfr) return res.status(404).json({ error: "Manufacturer profile not found" });
    if (mfr.revision !== parsedBody.data.expectedRevision) {
      return profilePhotoConflict(res);
    }

    const photos = storedProfilePhotos(mfr.photos);
    const photoIndex = parsedParams.data.photoIndex;
    if (!Number.isInteger(photoIndex) || photoIndex < 0 || photoIndex >= photos.length) {
      return res.status(400).json({ error: "That factory photo no longer exists" });
    }

    const removedObjectPath = photos[photoIndex];
    const remainingPhotos = photos.filter((_photo, index) => index !== photoIndex);
    const [updated] = await db
      .update(manufacturers)
      .set({
        photos: remainingPhotos,
        updatedAt: new Date(),
        revision: sql`${manufacturers.revision} + 1`,
      })
      .where(and(
        eq(manufacturers.id, mfr.id),
        eq(manufacturers.revision, parsedBody.data.expectedRevision),
      ))
      .returning();
    if (!updated) return profilePhotoConflict(res);

    // The database is authoritative. Only remove an object after its path is
    // no longer referenced by the successfully updated profile.
    if (!remainingPhotos.includes(removedObjectPath)) {
      await objectStorage.deleteObjectEntity(removedObjectPath).catch((error) => {
        req.log.warn({ err: error, objectPath: removedObjectPath }, "Deleted factory photo from profile but could not remove its object");
      });
    }

    return res.json(await serializeMyManufacturer(updated));
  } catch (error) {
    req.log.error({ err: error }, "Manufacturer photo deletion failed");
    return res.status(500).json({ error: "Unable to delete factory photo" });
  }
});

router.patch("/me", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = UpdateMyManufacturerProfileBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });

  const { expectedRevision, ...changes } = parsed.data;
  if (changes.timeZone !== undefined && changes.timeZone !== "" && !isValidTimeZone(changes.timeZone)) {
    return res.status(400).json({ error: "Choose a valid time zone" });
  }
  if (changes.yearsInBusiness != null && (changes.yearsInBusiness < 0 || changes.yearsInBusiness > 200)) {
    return res.status(400).json({ error: "Years in business must be between 0 and 200" });
  }
  const [updated] = await db
    .update(manufacturers)
    .set({
      ...changes,
      ...(changes.timeZone === "" ? { timeZone: null } : {}),
      updatedAt: new Date(),
      revision: sql`${manufacturers.revision} + 1`,
    })
    .where(and(eq(manufacturers.id, mfr.id), eq(manufacturers.revision, expectedRevision)))
    .returning();
  if (!updated) {
    return res.status(409).json({
      error: "Profile changed since it was loaded; refresh and review the latest values",
      code: "STALE_WRITE",
    });
  }

  return res.json({
    ...updated,
    photos: await signedProfilePhotos(updated.photos),
    verifiedAt: updated.verifiedAt?.toISOString() ?? null,
    createdAt:  updated.createdAt.toISOString(),
    updatedAt:  updated.updatedAt.toISOString(),
  });
});

router.post("/register", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = RegisterManufacturerBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await resolveManufacturer(userId);
  if (existing) return res.status(409).json({ error: "Already registered" });
  if (parsed.data.yearsInBusiness != null && (parsed.data.yearsInBusiness < 0 || parsed.data.yearsInBusiness > 200)) {
    return res.status(400).json({ error: "Years in business must be between 0 and 200" });
  }

  // Self-serve signups go live in the public directory immediately; there is
  // no manual approval step.
  const [mfr] = await db
    .insert(manufacturers)
    .values({
      clerkId: userId, isPublicDirectory: true, status: "active", ...parsed.data,
      timeZone: resolveTimeZone(parsed.data.timeZone, parsed.data.country),
      photos: [],
    })
    .returning();

  const signupEmail = await resolveManufacturerEmail(userId, parsed.data.contactEmail);
  if (signupEmail) {
    void sendManufacturerSignupEmail({
      to: signupEmail,
      businessName: mfr.businessName,
      idempotencyKey: `manufacturer-signup/${mfr.id}`,
    }).then((sent) => {
      if (!sent) req.log.error({ manufacturerId: mfr.id }, "Manufacturer signup email delivery failed");
    }).catch((err) => {
      req.log.error({ err, manufacturerId: mfr.id }, "Manufacturer signup email delivery failed");
    });
  }

  return res.status(201).json(await serializeMyManufacturer(mfr));
});

// ═══════════════════════════════════════════════════════════════════════════════
// MANUFACTURER DASHBOARD, THREADS, MESSAGES, ORDERS
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/me/dashboard", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });

  const threads = await db
    .select()
    .from(manufacturerThreads)
    .where(eq(manufacturerThreads.manufacturerId, mfr.id));

  const sharedOrders = await db.select().from(sampleOrders)
    .where(eq(sampleOrders.manufacturerId, mfr.id))
    .orderBy(desc(sampleOrders.updatedAt));
  const terminalStatuses = ["delivered", "approved", "rejected", "cancelled", "complete"];
  const active = sharedOrders.filter((o) => !terminalStatuses.includes(o.status));
  const completed = sharedOrders.filter((o) => terminalStatuses.includes(o.status));
  const activeSellers = new Map(threads.map((thread) => [thread.buyerClerkId, {
    sellerId: thread.buyerClerkId,
    sellerName: thread.buyerName,
    sellerAvatar: thread.buyerAvatar,
  }]));

  const activeOrders    = active.length;
  const completedOrders = completed.length;
  const pendingMessages = threads.reduce((sum, t) => sum + t.manufacturerUnreadCount, 0);
  const totalRevenue    = completed.reduce((s, o) => s + o.priceCents, 0);

  const named = new Map((await withSellerNames(sharedOrders.map(serializeSampleOrder))).map((order) => [order.id, order]));
  const withName = (order: typeof sampleOrders.$inferSelect) => named.get(order.id)!;
  const recentOrders = sharedOrders.slice(0, 5).map(withName);

  return res.json({
    activeOrders, pendingMessages, completedOrders,
    totalRevenueCents: totalRevenue, recentOrders,
    activeSellers: [...activeSellers.values()],
    messages: threads.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()).map((thread) => ({
      ...thread,
      unreadCount: thread.manufacturerUnreadCount,
      lastMessageAt: thread.lastMessageAt.toISOString(),
      createdAt: thread.createdAt.toISOString(),
    })),
    sampleOrders: {
      active: active.filter((o) => o.orderType === "sample").map(withName),
      completed: completed.filter((o) => o.orderType === "sample").map(withName),
    },
    bulkOrders: {
      active: active.filter((o) => o.orderType === "bulk").map(withName),
      completed: completed.filter((o) => o.orderType === "bulk").map(withName),
    },
    orderHistory: completed.map(withName),
  });
});

// Seller-side: get or create a thread with a manufacturer
router.post("/threads", ...requireGrowthSeller, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { manufacturerId, subject = "General" } = req.body;

  if (!isUuid(manufacturerId)) { res.status(400).json({ error: "A canonical manufacturer UUID is required" }); return; }
  const [manufacturer] = await db.select({ id: manufacturers.id, isPublicDirectory: manufacturers.isPublicDirectory })
    .from(manufacturers)
    .where(and(eq(manufacturers.id, manufacturerId), eq(manufacturers.status, "active")))
    .limit(1);
  if (!manufacturer) { res.status(404).json({ error: "Manufacturer not found" }); return; }
  if (!manufacturer.isPublicDirectory) {
    // Private manufacturers only talk to sellers they are already connected to.
    const [relationship] = await db.select({ id: manufacturerRelationships.id }).from(manufacturerRelationships)
      .where(and(eq(manufacturerRelationships.sellerId, sellerId), eq(manufacturerRelationships.manufacturerId, manufacturerId)))
      .limit(1);
    if (!relationship) { res.status(404).json({ error: "Manufacturer not found" }); return; }
  }
  await db.insert(manufacturerRelationships).values({ sellerId, manufacturerId })
    .onConflictDoNothing();

  const sellerName = await sellerDisplayName(sellerId);

  // Check for existing thread
  const [existing] = await db
    .select()
    .from(manufacturerThreads)
    .where(and(
      eq(manufacturerThreads.manufacturerId, manufacturerId),
      eq(manufacturerThreads.buyerClerkId, sellerId),
    ))
    .limit(1);

  if (existing) {
    res.json({ ...existing, sellerId, lastMessageAt: existing.lastMessageAt.toISOString(), createdAt: existing.createdAt.toISOString() });
    return;
  }

  const [created] = await db
    .insert(manufacturerThreads)
    .values({ manufacturerId, buyerClerkId: sellerId, buyerName: sellerName, subject })
    .onConflictDoNothing({
      target: [manufacturerThreads.manufacturerId, manufacturerThreads.buyerClerkId],
    })
    .returning();
  const thread = created ?? (await db.select().from(manufacturerThreads).where(and(
    eq(manufacturerThreads.manufacturerId, manufacturerId),
    eq(manufacturerThreads.buyerClerkId, sellerId),
  )).limit(1))[0];
  if (!thread) { res.status(500).json({ error: "Unable to create thread" }); return; }

  res.status(201).json({ ...thread, sellerId, lastMessageAt: thread.lastMessageAt.toISOString(), createdAt: thread.createdAt.toISOString() });
});

// Seller-side: list threads I'm in
router.get("/threads", ...requireGrowthSeller, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;

  const rows = await db
    .select({
      thread:      manufacturerThreads,
      mfrName:     manufacturers.businessName,
      mfrCountry:  manufacturers.country,
      mfrPhotos:   manufacturers.photos,
      mfrTimeZone: manufacturers.timeZone,
    })
    .from(manufacturerThreads)
    .leftJoin(manufacturers, eq(manufacturerThreads.manufacturerId, manufacturers.id))
    .where(eq(manufacturerThreads.buyerClerkId, sellerId))
    .orderBy(desc(manufacturerThreads.lastMessageAt));

  res.json(await Promise.all(rows.map(async (r) => ({
    ...r.thread,
    sellerId,
    manufacturerName:    r.mfrName,
    manufacturerCountry: r.mfrCountry,
    manufacturerTimeZone: r.mfrTimeZone,
    manufacturerPhoto:   (await signedProfilePhotos((r.mfrPhotos ?? []).slice(0, 1)))[0] ?? null,
    unreadCount: r.thread.sellerUnreadCount,
    lastMessageAt: r.thread.lastMessageAt.toISOString(),
    createdAt:     r.thread.createdAt.toISOString(),
  }))));
});

// Seller-side GET/POST messages. Manufacturer accounts use the /me routes.
router.get("/threads/:threadId/messages", ...requireGrowthSeller, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const threadId = req.params.threadId as string;
  const [thread] = await db
    .select({ id: manufacturerThreads.id })
    .from(manufacturerThreads)
    .where(and(
      eq(manufacturerThreads.id, threadId),
      eq(manufacturerThreads.buyerClerkId, sellerId),
    ))
    .limit(1);
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }

  await db.update(manufacturerThreads)
    .set({ sellerUnreadCount: 0 })
    .where(eq(manufacturerThreads.id, threadId));
  const messages = await db
    .select()
    .from(manufacturerMessages)
    .where(eq(manufacturerMessages.threadId, threadId))
    .orderBy(manufacturerMessages.sentAt);

  res.json(await attachOrderSnapshots(await Promise.all(messages.map(serializeMessage))));
});

router.post("/threads/:threadId/messages", ...requireGrowthSeller, async (req, res) => {
  const parsed = SendThreadMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const threadId = req.params.threadId as string;
  const { content, messageType = "text", mediaUrls, cardData, clientRequestId } = parsed.data;
  const sellerId = (req as any).clerkUserId as string;

  const [thread] = await db
    .select({ id: manufacturerThreads.id, manufacturerId: manufacturerThreads.manufacturerId })
    .from(manufacturerThreads)
    .where(and(
      eq(manufacturerThreads.id, threadId),
      eq(manufacturerThreads.buyerClerkId, sellerId),
    ))
    .limit(1);
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }
  const [duplicate] = await db.select().from(manufacturerMessages).where(and(
    eq(manufacturerMessages.threadId, threadId),
    eq(manufacturerMessages.senderClerkId, sellerId),
    eq(manufacturerMessages.clientRequestId, clientRequestId),
  )).limit(1);
  if (duplicate) {
    if (!isSameMessageSubmission(duplicate, parsed.data)) {
      res.status(409).json({ error: "clientRequestId was already used for a different message" }); return;
    }
    res.json(await serializeMessage(duplicate)); return;
  }
  const paths = Array.isArray(mediaUrls) ? mediaUrls : [];
  if (!(content?.trim() || paths.length || messageType === "sample_card" || messageType === "bulk_card")) {
    res.status(400).json({ error: "Message content, an attachment, or an order card is required" }); return;
  }
  if (!await cardIsBoundToThread(threadId, thread.manufacturerId, sellerId, messageType ?? "text", cardData)) {
    res.status(400).json({ error: "Order cards must reference an order in this thread" }); return;
  }
  if (!await mediaAreBoundToSender(threadId, sellerId, paths)) {
    res.status(400).json({ error: "Every attachment must be uploaded by you for this thread before sending" }); return;
  }

  const [msg] = await db
    .insert(manufacturerMessages)
    .values({
      threadId,
      senderRole:  "seller",
      senderClerkId: sellerId,
      clientRequestId,
      content:     content ?? "",
      messageType: messageType ?? "text",
      mediaUrls:   paths,
      cardData:    cardData ?? null,
    }).onConflictDoNothing()
    .returning();
  if (!msg) {
    const [existing] = await db.select().from(manufacturerMessages).where(and(
      eq(manufacturerMessages.threadId, threadId),
      eq(manufacturerMessages.senderClerkId, sellerId),
      eq(manufacturerMessages.clientRequestId, clientRequestId),
    )).limit(1);
    if (!existing) { res.status(409).json({ error: "Message request conflicted; refresh and retry" }); return; }
    res.json(await serializeMessage(existing)); return;
  }
  if (paths.length) {
    await db.update(manufacturerThreadAttachments).set({ consumedAt: new Date() })
      .where(and(eq(manufacturerThreadAttachments.threadId, threadId),
        eq(manufacturerThreadAttachments.uploaderClerkId, sellerId),
        inArray(manufacturerThreadAttachments.objectPath, paths)));
  }

  await db
    .update(manufacturerThreads)
    .set({
      lastMessage: content ?? "",
      lastMessageAt: new Date(),
      manufacturerUnreadCount: sql`${manufacturerThreads.manufacturerUnreadCount} + 1`,
      unreadCount: sql`${manufacturerThreads.unreadCount} + 1`,
    })
    .where(eq(manufacturerThreads.id, threadId));

  const [recipient] = await db.select({ clerkId: manufacturers.clerkId, businessName: manufacturers.businessName })
    .from(manufacturers).where(eq(manufacturers.id, thread.manufacturerId)).limit(1);
  if (recipient?.clerkId) {
    await notify(req, {
      userId: recipient.clerkId, category: "message", type: "manufacturer_message",
      title: "New seller message", body: content || "Sent an attachment",
      actorName: (req as any).clerkUserName ?? "Seller",
      targetId: threadId, targetType: "manufacturer_thread",
      cta: `/manufacturers/messages/${threadId}`,
    });
  }

  res.status(201).json(await serializeMessage(msg));
});

// Manufacturer dashboard: their own threads
router.get("/me/threads", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });

  const threads = await db
    .select()
    .from(manufacturerThreads)
    .where(eq(manufacturerThreads.manufacturerId, mfr.id))
    .orderBy(desc(manufacturerThreads.lastMessageAt));

  return res.json(threads.map(t => ({
    ...t,
    sellerId: t.buyerClerkId,
    lastMessageAt: t.lastMessageAt.toISOString(),
    createdAt:     t.createdAt.toISOString(),
    unreadCount: t.manufacturerUnreadCount,
  })));
});

router.get("/me/threads/:threadId/messages", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });
  const [thread] = await db.select({ id: manufacturerThreads.id }).from(manufacturerThreads)
    .where(and(
      eq(manufacturerThreads.id, req.params.threadId),
      eq(manufacturerThreads.manufacturerId, mfr.id),
    ))
    .limit(1);
  if (!thread) return res.status(404).json({ error: "Thread not found" });

  await db.update(manufacturerThreads)
    .set({ manufacturerUnreadCount: 0, unreadCount: 0 })
    .where(eq(manufacturerThreads.id, req.params.threadId));
  const messages = await db
    .select()
    .from(manufacturerMessages)
    .where(eq(manufacturerMessages.threadId, req.params.threadId))
    .orderBy(manufacturerMessages.sentAt);

  return res.json(await attachOrderSnapshots(await Promise.all(messages.map(serializeMessage))));
});

router.post("/me/threads/:threadId/messages", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = SendThreadMessageBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { threadId } = req.params;
  const { content, messageType, mediaUrls, cardData, clientRequestId } = parsed.data;
  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });
  const [thread] = await db.select({
    id: manufacturerThreads.id,
    buyerClerkId: manufacturerThreads.buyerClerkId,
    manufacturerId: manufacturerThreads.manufacturerId,
  }).from(manufacturerThreads)
    .where(and(
      eq(manufacturerThreads.id, threadId),
      eq(manufacturerThreads.manufacturerId, mfr.id),
    ))
    .limit(1);
  if (!thread) return res.status(404).json({ error: "Thread not found" });
  const [duplicate] = await db.select().from(manufacturerMessages).where(and(
    eq(manufacturerMessages.threadId, threadId),
    eq(manufacturerMessages.senderClerkId, userId),
    eq(manufacturerMessages.clientRequestId, clientRequestId),
  )).limit(1);
  if (duplicate) {
    if (!isSameMessageSubmission(duplicate, parsed.data)) {
      return res.status(409).json({ error: "clientRequestId was already used for a different message" });
    }
    return res.json(await serializeMessage(duplicate));
  }
  const paths = Array.isArray(mediaUrls) ? mediaUrls : [];
  if (!(content?.trim() || paths.length || messageType === "sample_card" || messageType === "bulk_card")) {
    return res.status(400).json({ error: "Message content, an attachment, or an order card is required" });
  }
  if (!await cardIsBoundToThread(threadId, thread.manufacturerId, thread.buyerClerkId, messageType ?? "text", cardData)) {
    return res.status(400).json({ error: "Order cards must reference an order in this thread" });
  }
  if (!await mediaAreBoundToSender(threadId, userId, paths)) {
    return res.status(400).json({ error: "Every attachment must be uploaded by you for this thread before sending" });
  }

  const [msg] = await db
    .insert(manufacturerMessages)
    .values({
      threadId,
      senderRole:  "manufacturer",
      senderClerkId: userId,
      clientRequestId,
      content:     content ?? "",
      messageType: messageType ?? "text",
      mediaUrls:   paths,
      cardData:    cardData ?? null,
    }).onConflictDoNothing()
    .returning();
  if (!msg) {
    const [existing] = await db.select().from(manufacturerMessages).where(and(
      eq(manufacturerMessages.threadId, threadId),
      eq(manufacturerMessages.senderClerkId, userId),
      eq(manufacturerMessages.clientRequestId, clientRequestId),
    )).limit(1);
    if (!existing) return res.status(409).json({ error: "Message request conflicted; refresh and retry" });
    return res.json(await serializeMessage(existing));
  }
  if (paths.length) {
    await db.update(manufacturerThreadAttachments).set({ consumedAt: new Date() })
      .where(and(eq(manufacturerThreadAttachments.threadId, threadId),
        eq(manufacturerThreadAttachments.uploaderClerkId, userId),
        inArray(manufacturerThreadAttachments.objectPath, paths)));
  }

  await db
    .update(manufacturerThreads)
    .set({
      lastMessage: content ?? "",
      lastMessageAt: new Date(),
      sellerUnreadCount: sql`${manufacturerThreads.sellerUnreadCount} + 1`,
    })
    .where(eq(manufacturerThreads.id, threadId));

  await notify(req, {
    userId: thread.buyerClerkId, category: "message", type: "manufacturer_message",
    title: `New message from ${mfr.businessName}`, body: content || "Sent an attachment",
    actorName: mfr.businessName, targetId: threadId, targetType: "manufacturer_thread",
    cta: `/manufacturer-messages/${threadId}`,
  });

  return res.status(201).json(await serializeMessage(msg));
});

async function uploadThreadAttachment(req: express.Request, res: express.Response, role: "seller" | "manufacturer") {
  const clerkId = (req as any).clerkUserId as string;
  const threadId = req.params.threadId as string;
  const mfr = role === "manufacturer" ? await resolveManufacturer(clerkId) : null;
  const condition = role === "seller"
    ? eq(manufacturerThreads.buyerClerkId, clerkId)
    : mfr ? eq(manufacturerThreads.manufacturerId, mfr.id) : sql`false`;
  const [thread] = await db.select({ id: manufacturerThreads.id }).from(manufacturerThreads)
    .where(and(eq(manufacturerThreads.id, threadId), condition)).limit(1);
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: "Attachment body is required" }); return;
  }
  const contentType = String(req.headers["content-type"] ?? "").split(";")[0];
  if (!isSupportedAttachment(req.body, contentType)) {
    res.status(400).json({ error: "Attachment content does not match a supported JPEG, PNG, WebP, or PDF type" }); return;
  }
  const objectPath = await objectStorage.createObjectEntityFromBuffer(req.body, contentType);
  try {
    await objectStorage.trySetObjectEntityAclPolicy(objectPath, { owner: clerkId, visibility: "private" });
    await db.insert(manufacturerThreadAttachments).values({ threadId, uploaderClerkId: clerkId, objectPath });
  } catch (error) {
    await objectStorage.deleteObjectEntity(objectPath).catch(() => undefined);
    throw error;
  }
  res.status(201).json({ objectPath });
}

router.post(
  "/threads/:threadId/attachments",
  ...requireGrowthSeller,
  express.raw({ type: ["image/*", "application/pdf"], limit: MAX_MESSAGE_ATTACHMENT_BYTES }),
  async (req, res) => uploadThreadAttachment(req, res, "seller"),
);

router.post(
  "/me/threads/:threadId/attachments",
  requireAuth,
  express.raw({ type: ["image/*", "application/pdf"], limit: MAX_MESSAGE_ATTACHMENT_BYTES }),
  async (req, res) => uploadThreadAttachment(req, res, "manufacturer"),
);

// Manufacturer view/actions over the same sample_orders rows used by sellers.
router.get("/me/sample-orders", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });
  const rows = await db.select().from(sampleOrders)
    .where(eq(sampleOrders.manufacturerId, mfr.id))
    .orderBy(desc(sampleOrders.updatedAt));
  return res.json(await withSellerNames(rows.map(serializeSampleOrder)));
});

router.get("/me/sample-orders/:orderId", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });
  const [order] = await db.select().from(sampleOrders).where(and(
    eq(sampleOrders.id, req.params.orderId),
    eq(sampleOrders.manufacturerId, mfr.id),
  )).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });
  return res.json((await withSellerNames([await serializeManufacturerOrderDetail(order)]))[0]);
});

router.patch("/me/sample-orders/:orderId/status", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });
  const stages = ["payment_received", "processing", "cut_and_sew", "packing", "shipped", "delivered"] as const;
  const status = req.body?.status;
  const expectedRevision = req.body?.expectedRevision;
  if (!stages.includes(status)) return res.status(400).json({ error: "Invalid status" });
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return res.status(400).json({ error: "expectedRevision is required" });
  }
  if (status === "shipped" && (
    typeof req.body?.trackingNumber !== "string" || !req.body.trackingNumber.trim()
    || typeof req.body?.carrier !== "string" || !req.body.carrier.trim()
  )) {
    return res.status(400).json({ error: "carrier and trackingNumber are required when shipping an order" });
  }
  const [current] = await db.select().from(sampleOrders).where(and(
    eq(sampleOrders.id, req.params.orderId),
    eq(sampleOrders.manufacturerId, mfr.id),
  )).limit(1);
  if (!current) return res.status(404).json({ error: "Order not found" });
  const transition = validateTransition({
    from: current.status, to: status, actor: "manufacturer",
    carrier: req.body?.carrier, trackingNumber: req.body?.trackingNumber,
  });
  if (!transition.ok) {
    return res.status(409).json({ error: transition.message, code: transition.code });
  }
  const now = new Date();
  const [updated] = await db.update(sampleOrders).set({
    status,
    trackingNumber: status === "shipped" ? req.body.trackingNumber.trim() : current.trackingNumber,
    carrier: status === "shipped" ? req.body.carrier.trim() : current.carrier,
    shippedAt: status === "shipped" ? now : current.shippedAt,
    deliveredAt: status === "delivered" ? now : current.deliveredAt,
    updatedAt: now, revision: sql`${sampleOrders.revision} + 1`,
  }).where(and(
    eq(sampleOrders.id, current.id),
    eq(sampleOrders.manufacturerId, mfr.id),
    eq(sampleOrders.status, current.status),
    eq(sampleOrders.revision, expectedRevision),
  )).returning();
  if (!updated) return res.status(409).json({ error: "Order changed; refresh and retry", code: "STALE_WRITE" });
  await afterStageChange({
    order: updated, actorRole: "manufacturer", actorClerkId: userId,
    fromStatus: current.status, toStatus: status,
    carrier: updated.carrier, trackingNumber: updated.trackingNumber,
  }).catch((err) => req.log.error({ err, orderId: updated.id }, "Failed to record order stage event"));
  const notificationContext = sellerOrderNotificationContext(current);
  await notify(req, {
    userId: current.sellerId, category: "production", type: "manufacturer_order_status",
    title: `${current.title} is now ${status.replaceAll("_", " ")}`,
    body: `${mfr.businessName} updated your ${current.orderType} order.`,
    actorName: mfr.businessName, targetId: current.id, targetType: notificationContext.targetType,
    cta: notificationContext.cta,
  });
  return res.json(serializeSampleOrder(updated));
});

// Payment setup (legacy bank/PayPal/Wise)
router.get("/me/payment", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });

  const [payment] = await db
    .select()
    .from(manufacturerPayments)
    .where(eq(manufacturerPayments.manufacturerId, mfr.id))
    .limit(1);

  if (!payment) {
    return res.json({ isSetup: false, method: null, bankLast4: null, bankName: null, currency: null, setupAt: null });
  }

  return res.json({
    isSetup:   true,
    method:    payment.method,
    bankLast4: payment.bankLast4,
    bankName:  payment.bankName,
    currency:  payment.currency,
    setupAt:   payment.createdAt.toISOString(),
  });
});

router.post("/me/payment", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = SetupManufacturerPaymentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });

  const accountNumber = parsed.data.accountNumber ?? "";
  const last4 = accountNumber.length >= 4 ? accountNumber.slice(-4) : accountNumber;

  await db.delete(manufacturerPayments).where(eq(manufacturerPayments.manufacturerId, mfr.id));

  const [payment] = await db
    .insert(manufacturerPayments)
    .values({
      manufacturerId:  mfr.id,
      method:          parsed.data.method,
      bankLast4:       last4,
      bankName:        parsed.data.bankName,
      currency:        parsed.data.currency,
      routingMasked:   "****",
      paypalEmail:     parsed.data.paypalEmail ?? undefined,
      wiseEmail:       parsed.data.wiseEmail ?? undefined,
    })
    .returning();

  return res.json({
    isSetup:   true,
    method:    payment.method,
    bankLast4: payment.bankLast4,
    bankName:  payment.bankName,
    currency:  payment.currency,
    setupAt:   payment.createdAt.toISOString(),
  });
});

export default router;
