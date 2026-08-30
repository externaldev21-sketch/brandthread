import express, { Router } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  manufacturers,
  manufacturerPayments,
  manufacturerThreads,
  manufacturerMessages,
  manufacturerOrders,
  manufacturerInviteTokens,
  savedManufacturers,
  sampleOrders,
  manufacturerThreadAttachments,
} from "@workspace/db";
import { eq, desc, and, sql, inArray, isNull } from "drizzle-orm";
import crypto from "crypto";
import {
  RegisterManufacturerBody,
  UpdateMyManufacturerProfileBody,
  SendThreadMessageBody,
  UpdateManufacturerOrderStatusBody,
  SetupManufacturerPaymentBody,
} from "@workspace/api-zod";
import { requireAuth, requirePlan } from "../middlewares/requireAuth";
import { teamContext } from "../middlewares/requireRole";
import { getWebOrigin } from "../lib/webOrigin";
import { ObjectStorageService } from "../lib/objectStorage";
import { sendManufacturerSignupEmail } from "../lib/brandthreadEmail";
import { logger } from "../lib/logger";
import { publishNotification } from "./notifications-feed";

const router = Router();
const objectStorage = new ObjectStorageService();
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_MESSAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
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

// ── Helper ─────────────────────────────────────────────────────────────────────

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
async function serializeMessage(message: typeof manufacturerMessages.$inferSelect) {
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
    mediaUrls: mediaUrls.filter((url): url is string => !!url),
    sentAt: message.sentAt.toISOString(),
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

// ═══════════════════════════════════════════════════════════════════════════════
// INVITE TOKENS — seller creates private invite links for manufacturers
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/manufacturers/invite-tokens — seller creates a private invite token
router.post("/invite-tokens", ...requireGrowthSeller, async (req, res) => {
  const sellerId   = (req as any).clerkUserId as string;
  const { companyName, contactName, contactEmail, notes } = req.body;

  const token = crypto.randomBytes(24).toString("hex");

  const [inv] = await db
    .insert(manufacturerInviteTokens)
    .values({ sellerId, token, companyName, contactName, contactEmail, notes })
    .returning();

  const inviteUrl = `${getWebOrigin()}/manufacturer-onboard?token=${inv.token}`;

  res.status(201).json({ ...inv, inviteUrl, createdAt: inv.createdAt.toISOString() });
});

// GET /api/manufacturers/invite-tokens — seller lists their tokens
router.get("/invite-tokens", ...requireGrowthSeller, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const rows = await db
    .select()
    .from(manufacturerInviteTokens)
    .where(eq(manufacturerInviteTokens.sellerId, sellerId))
    .orderBy(desc(manufacturerInviteTokens.createdAt));

  const domain = getWebOrigin();

  res.json(rows.map(inv => ({
    ...inv,
    inviteUrl: `${domain}/manufacturer-onboard?token=${inv.token}`,
    usedAt:    inv.usedAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
  })));
});

// GET /api/manufacturers/invite-tokens/resolve/:token — look up an invite token (no auth — for onboard form)
router.get("/invite-tokens/resolve/:token", async (req, res) => {
  const [inv] = await db
    .select()
    .from(manufacturerInviteTokens)
    .where(eq(manufacturerInviteTokens.token, req.params.token))
    .limit(1);

  if (!inv) { res.status(404).json({ error: "Invalid or expired invite token" }); return; }
  if (inv.usedAt) { res.status(410).json({ error: "This invite has already been used" }); return; }

  res.json({
    valid:        true,
    companyName:  inv.companyName,
    contactName:  inv.contactName,
    contactEmail: inv.contactEmail,
    sellerId:     inv.sellerId,
  });
});

// POST /api/manufacturers/register-via-invite/:token — manufacturer registers through a private invite
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

  // Check if manufacturer already registered
  const existing = await resolveManufacturer(userId);
  if (existing) {
    res.status(409).json({ error: "Already registered as a manufacturer" }); return;
  }

  const parsed = RegisterManufacturerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const [mfr] = await db
    .insert(manufacturers)
    .values({
      clerkId:           userId,
       isPublicDirectory: true,
      status:            "active",
      ...parsed.data,
    })
    .returning();

  // Mark invite as used
  await db
    .update(manufacturerInviteTokens)
    .set({ usedAt: new Date(), manufacturerId: mfr.id })
    .where(eq(manufacturerInviteTokens.id, inv.id));

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
    }).catch((err) => {
      req.log.error({ err, manufacturerId: mfr.id }, "Manufacturer signup email delivery failed");
    });
  }

  res.status(201).json({
    ...mfr,
    invitedBySellerId: inv.sellerId,
    verifiedAt: null,
    createdAt:  mfr.createdAt.toISOString(),
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
    verifiedAt: mfr.verifiedAt?.toISOString() ?? null,
    createdAt:  mfr.createdAt.toISOString(),
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
      if (!Buffer.isBuffer(req.body) || req.body.length === 0 || !isSupportedImage(req.body)) {
        return res.status(400).json({ error: "Upload a valid JPEG, PNG, or WebP image" });
      }

      const contentType = req.headers["content-type"]?.split(";")[0] ?? "application/octet-stream";
      const objectPath = await objectStorage.createObjectEntityFromBuffer(req.body, contentType);
      await objectStorage.trySetObjectEntityAclPolicy(objectPath, {
        owner: clerkId,
        visibility: "public",
      });
      const photos = [...(mfr.photos ?? []), objectPath].slice(-8);
      const [updated] = await db
        .update(manufacturers)
        .set({ photos, updatedAt: new Date() })
        .where(eq(manufacturers.id, mfr.id))
        .returning({ photos: manufacturers.photos });

      return res.status(201).json({ photo: objectPath, photos: updated.photos });
    } catch (error) {
      req.log.error({ err: error }, "Manufacturer photo upload failed");
      return res.status(500).json({ error: "Unable to upload factory image" });
    }
  },
);

router.patch("/me", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = UpdateMyManufacturerProfileBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });

  const [updated] = await db
    .update(manufacturers)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(manufacturers.id, mfr.id))
    .returning();

  return res.json({
    ...updated,
    verifiedAt: updated.verifiedAt?.toISOString() ?? null,
    createdAt:  updated.createdAt.toISOString(),
  });
});

router.post("/register", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = RegisterManufacturerBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await resolveManufacturer(userId);
  if (existing) return res.status(409).json({ error: "Already registered" });

  const [mfr] = await db
    .insert(manufacturers)
    .values({ clerkId: userId, isPublicDirectory: true, status: "active", ...parsed.data })
    .returning();

  const signupEmail = await resolveManufacturerEmail(userId, parsed.data.contactEmail);
  if (signupEmail) {
    void sendManufacturerSignupEmail({
      to: signupEmail,
      businessName: mfr.businessName,
      idempotencyKey: `manufacturer-signup/${mfr.id}`,
    }).catch((err) => {
      req.log.error({ err, manufacturerId: mfr.id }, "Manufacturer signup email delivery failed");
    });
  }

  return res.status(201).json({
    ...mfr,
    verifiedAt: null,
    createdAt:  mfr.createdAt.toISOString(),
  });
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

  const recentOrders = sharedOrders.slice(0, 5).map(serializeSampleOrder);

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
      active: active.filter((o) => o.orderType === "sample").map(serializeSampleOrder),
      completed: completed.filter((o) => o.orderType === "sample").map(serializeSampleOrder),
    },
    bulkOrders: {
      active: active.filter((o) => o.orderType === "bulk").map(serializeSampleOrder),
      completed: completed.filter((o) => o.orderType === "bulk").map(serializeSampleOrder),
    },
    orderHistory: completed.map(serializeSampleOrder),
  });
});

// Seller-side: get or create a thread with a manufacturer
router.post("/threads", ...requireGrowthSeller, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { manufacturerId, subject = "General" } = req.body;

  if (!manufacturerId) { res.status(400).json({ error: "manufacturerId required" }); return; }

  // Get seller name from auth
  const sellerName = (req as any).clerkUserName ?? "Seller";

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
    res.json({ ...existing, lastMessageAt: existing.lastMessageAt.toISOString(), createdAt: existing.createdAt.toISOString() });
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

  res.status(201).json({ ...thread, lastMessageAt: thread.lastMessageAt.toISOString(), createdAt: thread.createdAt.toISOString() });
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
    })
    .from(manufacturerThreads)
    .leftJoin(manufacturers, eq(manufacturerThreads.manufacturerId, manufacturers.id))
    .where(eq(manufacturerThreads.buyerClerkId, sellerId))
    .orderBy(desc(manufacturerThreads.lastMessageAt));

  res.json(rows.map(r => ({
    ...r.thread,
    manufacturerName:    r.mfrName,
    manufacturerCountry: r.mfrCountry,
    manufacturerPhoto:   r.mfrPhotos?.[0] ?? null,
    unreadCount: r.thread.sellerUnreadCount,
    lastMessageAt: r.thread.lastMessageAt.toISOString(),
    createdAt:     r.thread.createdAt.toISOString(),
  })));
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

  res.json(await Promise.all(messages.map(serializeMessage)));
});

router.post("/threads/:threadId/messages", ...requireGrowthSeller, async (req, res) => {
  const parsed = SendThreadMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const threadId = req.params.threadId as string;
  const { content, messageType = "text", mediaUrls, cardData } = req.body;
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
  const paths = Array.isArray(mediaUrls) ? mediaUrls : [];
  if (!await mediaAreBoundToSender(threadId, sellerId, paths)) {
    res.status(400).json({ error: "Every attachment must be uploaded by you for this thread before sending" }); return;
  }

  const [msg] = await db
    .insert(manufacturerMessages)
    .values({
      threadId,
      senderRole:  "seller",
      content:     content ?? "",
      messageType: messageType ?? "text",
      mediaUrls:   paths,
      cardData:    cardData ?? null,
    })
    .returning();
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

  return res.json(await Promise.all(messages.map(serializeMessage)));
});

router.post("/me/threads/:threadId/messages", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = SendThreadMessageBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { threadId } = req.params;
  const { content, messageType, mediaUrls, cardData } = req.body;
  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });
  const [thread] = await db.select({
    id: manufacturerThreads.id,
    buyerClerkId: manufacturerThreads.buyerClerkId,
  }).from(manufacturerThreads)
    .where(and(
      eq(manufacturerThreads.id, threadId),
      eq(manufacturerThreads.manufacturerId, mfr.id),
    ))
    .limit(1);
  if (!thread) return res.status(404).json({ error: "Thread not found" });
  const paths = Array.isArray(mediaUrls) ? mediaUrls : [];
  if (!await mediaAreBoundToSender(threadId, userId, paths)) {
    return res.status(400).json({ error: "Every attachment must be uploaded by you for this thread before sending" });
  }

  const [msg] = await db
    .insert(manufacturerMessages)
    .values({
      threadId,
      senderRole:  "manufacturer",
      content:     content ?? "",
      messageType: messageType ?? "text",
      mediaUrls:   paths,
      cardData:    cardData ?? null,
    })
    .returning();
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
  return res.json(rows.map(serializeSampleOrder));
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
  return res.json(await serializeManufacturerOrderDetail(order));
});

router.patch("/me/sample-orders/:orderId/status", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });
  const stages = ["payment_received", "processing", "cut_and_sew", "packing", "shipped", "delivered"] as const;
  const status = req.body?.status;
  if (!stages.includes(status)) return res.status(400).json({ error: "Invalid status" });
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
  if (stages.indexOf(status) !== stages.indexOf(current.status as typeof stages[number]) + 1) {
    return res.status(409).json({ error: "Order status must advance exactly one stage" });
  }
  const now = new Date();
  const [updated] = await db.update(sampleOrders).set({
    status,
    trackingNumber: status === "shipped" ? req.body.trackingNumber.trim() : current.trackingNumber,
    carrier: status === "shipped" ? req.body.carrier.trim() : current.carrier,
    shippedAt: status === "shipped" ? now : current.shippedAt,
    deliveredAt: status === "delivered" ? now : current.deliveredAt,
    updatedAt: now,
  }).where(and(
    eq(sampleOrders.id, current.id),
    eq(sampleOrders.manufacturerId, mfr.id),
    eq(sampleOrders.status, current.status),
  )).returning();
  if (!updated) return res.status(409).json({ error: "Order status changed; refresh and retry" });
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

// Manufacturer orders
router.get("/me/orders", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });

  const orderList = await db
    .select()
    .from(manufacturerOrders)
    .where(eq(manufacturerOrders.manufacturerId, mfr.id))
    .orderBy(desc(manufacturerOrders.createdAt));

  return res.json(orderList.map(o => ({
    ...o,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  })));
});

router.patch("/me/orders/:orderId/status", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = UpdateManufacturerOrderStatusBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });
  const [updated] = await db
    .update(manufacturerOrders)
    .set({
      status:         parsed.data.status,
      trackingNumber: parsed.data.trackingNumber ?? undefined,
      notes:          parsed.data.notes ?? undefined,
      updatedAt:      new Date(),
    })
    .where(and(
      eq(manufacturerOrders.id, req.params.orderId),
      eq(manufacturerOrders.manufacturerId, mfr.id),
    ))
    .returning();

  if (!updated) return res.status(404).json({ error: "Order not found" });

  return res.json({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
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
