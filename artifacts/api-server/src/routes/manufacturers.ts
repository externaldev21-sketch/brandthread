import express, { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  manufacturers,
  manufacturerPayments,
  manufacturerThreads,
  manufacturerMessages,
  manufacturerOrders,
  manufacturerInviteTokens,
  savedManufacturers,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import crypto from "crypto";
import {
  RegisterManufacturerBody,
  UpdateMyManufacturerProfileBody,
  SendThreadMessageBody,
  UpdateManufacturerOrderStatusBody,
  SetupManufacturerPaymentBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const objectStorage = new ObjectStorageService();
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

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

// ═══════════════════════════════════════════════════════════════════════════════
// FAVORITES — seller-scoped saved manufacturers, separate from relationships
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/favorites", requireAuth, async (req, res) => {
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

router.post("/favorites", requireAuth, async (req, res) => {
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

router.delete("/favorites/:manufacturerId", requireAuth, async (req, res) => {
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
router.post("/invite-tokens", requireAuth, async (req, res) => {
  const sellerId   = (req as any).clerkUserId as string;
  const { companyName, contactName, contactEmail, notes } = req.body;

  const token = crypto.randomBytes(24).toString("hex");

  const [inv] = await db
    .insert(manufacturerInviteTokens)
    .values({ sellerId, token, companyName, contactName, contactEmail, notes })
    .returning();

  const inviteUrl = `${process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "https://brandthread.app"}/manufacturer-onboard?token=${inv.token}`;

  res.status(201).json({ ...inv, inviteUrl, createdAt: inv.createdAt.toISOString() });
});

// GET /api/manufacturers/invite-tokens — seller lists their tokens
router.get("/invite-tokens", requireAuth, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const rows = await db
    .select()
    .from(manufacturerInviteTokens)
    .where(eq(manufacturerInviteTokens.sellerId, sellerId))
    .orderBy(desc(manufacturerInviteTokens.createdAt));

  const domain = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "https://brandthread.app";

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

  const orderList = await db
    .select()
    .from(manufacturerOrders)
    .where(eq(manufacturerOrders.manufacturerId, mfr.id))
    .orderBy(desc(manufacturerOrders.createdAt));

  const threads = await db
    .select()
    .from(manufacturerThreads)
    .where(eq(manufacturerThreads.manufacturerId, mfr.id));

  const activeOrders    = orderList.filter(o => o.status !== "complete").length;
  const completedOrders = orderList.filter(o => o.status === "complete").length;
  const pendingMessages = threads.reduce((sum, t) => sum + t.unreadCount, 0);
  const totalRevenue    = orderList.filter(o => o.status === "complete").reduce((s, o) => s + o.totalCents, 0);

  const recentOrders = orderList.slice(0, 5).map(o => ({
    ...o,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  }));

  return res.json({
    activeOrders, pendingMessages, completedOrders,
    totalRevenueCents: totalRevenue, recentOrders,
  });
});

// Seller-side: get or create a thread with a manufacturer
router.post("/threads", requireAuth, async (req, res) => {
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

  const [thread] = await db
    .insert(manufacturerThreads)
    .values({ manufacturerId, buyerClerkId: sellerId, buyerName: sellerName, subject })
    .returning();

  res.status(201).json({ ...thread, lastMessageAt: thread.lastMessageAt.toISOString(), createdAt: thread.createdAt.toISOString() });
});

// Seller-side: list threads I'm in
router.get("/threads", requireAuth, async (req, res) => {
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
    lastMessageAt: r.thread.lastMessageAt.toISOString(),
    createdAt:     r.thread.createdAt.toISOString(),
  })));
});

// GET/POST messages for a thread
router.get("/threads/:threadId/messages", async (req, res) => {
  const messages = await db
    .select()
    .from(manufacturerMessages)
    .where(eq(manufacturerMessages.threadId, req.params.threadId))
    .orderBy(manufacturerMessages.sentAt);

  res.json(messages.map(m => ({
    ...m,
    sentAt: m.sentAt.toISOString(),
  })));
});

router.post("/threads/:threadId/messages", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = SendThreadMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { threadId } = req.params;
  const { content, messageType = "text", mediaUrls, cardData, senderRole } = req.body;

  // Determine sender role: check if this user is the manufacturer for this thread
  const [thread] = await db
    .select({ manufacturerId: manufacturerThreads.manufacturerId, buyerClerkId: manufacturerThreads.buyerClerkId })
    .from(manufacturerThreads)
    .where(eq(manufacturerThreads.id, threadId))
    .limit(1);

  let resolvedRole = senderRole ?? "seller";
  if (thread) {
    const mfr = await resolveManufacturer(userId);
    if (mfr && mfr.id === thread.manufacturerId) {
      resolvedRole = "manufacturer";
    }
  }

  const [msg] = await db
    .insert(manufacturerMessages)
    .values({
      threadId,
      senderRole:  resolvedRole,
      content:     content ?? "",
      messageType: messageType ?? "text",
      mediaUrls:   Array.isArray(mediaUrls) ? mediaUrls : [],
      cardData:    cardData ?? null,
    })
    .returning();

  await db
    .update(manufacturerThreads)
    .set({ lastMessage: content ?? "", lastMessageAt: new Date() })
    .where(eq(manufacturerThreads.id, threadId));

  res.status(201).json({ ...msg, sentAt: msg.sentAt.toISOString() });
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
  })));
});

router.get("/me/threads/:threadId/messages", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const messages = await db
    .select()
    .from(manufacturerMessages)
    .where(eq(manufacturerMessages.threadId, req.params.threadId))
    .orderBy(manufacturerMessages.sentAt);

  return res.json(messages.map(m => ({
    ...m,
    sentAt: m.sentAt.toISOString(),
  })));
});

router.post("/me/threads/:threadId/messages", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = SendThreadMessageBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { threadId } = req.params;
  const { content, messageType, mediaUrls, cardData } = req.body;

  const [msg] = await db
    .insert(manufacturerMessages)
    .values({
      threadId,
      senderRole:  "manufacturer",
      content:     content ?? "",
      messageType: messageType ?? "text",
      mediaUrls:   Array.isArray(mediaUrls) ? mediaUrls : [],
      cardData:    cardData ?? null,
    })
    .returning();

  await db
    .update(manufacturerThreads)
    .set({ lastMessage: content ?? "", lastMessageAt: new Date() })
    .where(eq(manufacturerThreads.id, threadId));

  return res.status(201).json({ ...msg, sentAt: msg.sentAt.toISOString() });
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

  const [updated] = await db
    .update(manufacturerOrders)
    .set({
      status:         parsed.data.status,
      trackingNumber: parsed.data.trackingNumber ?? undefined,
      notes:          parsed.data.notes ?? undefined,
      updatedAt:      new Date(),
    })
    .where(eq(manufacturerOrders.id, req.params.orderId))
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

  await db
    .update(manufacturers)
    .set({ paymentSetup: true, updatedAt: new Date() })
    .where(eq(manufacturers.id, mfr.id));

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
