import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  manufacturers,
  manufacturerPayments,
  manufacturerThreads,
  manufacturerMessages,
  manufacturerOrders,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  RegisterManufacturerBody,
  UpdateMyManufacturerProfileBody,
  SendThreadMessageBody,
  UpdateManufacturerOrderStatusBody,
  SetupManufacturerPaymentBody,
} from "@workspace/api-zod";

const router = Router();

// ── Helper: resolve authenticated manufacturer ─────────────────────────────────

async function resolveManufacturer(clerkId: string) {
  const [mfr] = await db
    .select()
    .from(manufacturers)
    .where(eq(manufacturers.clerkId, clerkId))
    .limit(1);
  return mfr ?? null;
}

// ── GET /manufacturers/me ──────────────────────────────────────────────────────

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

// ── PATCH /manufacturers/me ────────────────────────────────────────────────────

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

// ── POST /manufacturers/register ───────────────────────────────────────────────

router.post("/register", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = RegisterManufacturerBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Check already registered
  const existing = await resolveManufacturer(userId);
  if (existing) return res.status(409).json({ error: "Already registered" });

  const [mfr] = await db
    .insert(manufacturers)
    .values({ clerkId: userId, ...parsed.data })
    .returning();

  return res.status(201).json({
    ...mfr,
    verifiedAt: null,
    createdAt:  mfr.createdAt.toISOString(),
  });
});

// ── GET /manufacturers/me/dashboard ───────────────────────────────────────────

router.get("/me/dashboard", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });

  const orders = await db
    .select()
    .from(manufacturerOrders)
    .where(eq(manufacturerOrders.manufacturerId, mfr.id))
    .orderBy(desc(manufacturerOrders.createdAt));

  const threads = await db
    .select()
    .from(manufacturerThreads)
    .where(eq(manufacturerThreads.manufacturerId, mfr.id));

  const activeOrders    = orders.filter(o => o.status !== "complete").length;
  const completedOrders = orders.filter(o => o.status === "complete").length;
  const pendingMessages = threads.reduce((sum, t) => sum + t.unreadCount, 0);
  const totalRevenue    = orders.filter(o => o.status === "complete").reduce((s, o) => s + o.totalCents, 0);
  const pendingPayout   = orders.filter(o => o.status !== "complete").reduce((s, o) => s + o.totalCents, 0);

  const recentOrders = orders.slice(0, 5).map(o => ({
    ...o,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  }));

  return res.json({
    activeOrders,
    pendingMessages,
    completedOrders,
    totalRevenueCents:  totalRevenue,
    pendingPayoutCents: pendingPayout,
    recentOrders,
  });
});

// ── GET /manufacturers/me/threads ─────────────────────────────────────────────

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

// ── GET /manufacturers/me/threads/:threadId/messages ──────────────────────────

router.get("/me/threads/:threadId/messages", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { threadId } = req.params;

  const messages = await db
    .select()
    .from(manufacturerMessages)
    .where(eq(manufacturerMessages.threadId, threadId))
    .orderBy(manufacturerMessages.sentAt);

  return res.json(messages.map(m => ({
    ...m,
    sentAt: m.sentAt.toISOString(),
  })));
});

// ── POST /manufacturers/me/threads/:threadId/messages ─────────────────────────

router.post("/me/threads/:threadId/messages", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = SendThreadMessageBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { threadId } = req.params;

  const [msg] = await db
    .insert(manufacturerMessages)
    .values({ threadId, senderRole: "manufacturer", content: parsed.data.content })
    .returning();

  // Update thread last message
  await db
    .update(manufacturerThreads)
    .set({ lastMessage: parsed.data.content, lastMessageAt: new Date() })
    .where(eq(manufacturerThreads.id, threadId));

  return res.status(201).json({ ...msg, sentAt: msg.sentAt.toISOString() });
});

// ── GET /manufacturers/me/orders ──────────────────────────────────────────────

router.get("/me/orders", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });

  const orders = await db
    .select()
    .from(manufacturerOrders)
    .where(eq(manufacturerOrders.manufacturerId, mfr.id))
    .orderBy(desc(manufacturerOrders.createdAt));

  return res.json(orders.map(o => ({
    ...o,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  })));
});

// ── PATCH /manufacturers/me/orders/:orderId/status ────────────────────────────

router.patch("/me/orders/:orderId/status", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = UpdateManufacturerOrderStatusBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { orderId } = req.params;

  const [updated] = await db
    .update(manufacturerOrders)
    .set({
      status:         parsed.data.status,
      trackingNumber: parsed.data.trackingNumber ?? undefined,
      notes:          parsed.data.notes ?? undefined,
      updatedAt:      new Date(),
    })
    .where(eq(manufacturerOrders.id, orderId))
    .returning();

  if (!updated) return res.status(404).json({ error: "Order not found" });

  return res.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

// ── GET /manufacturers/me/payment ─────────────────────────────────────────────

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

// ── POST /manufacturers/me/payment ────────────────────────────────────────────

router.post("/me/payment", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const parsed = SetupManufacturerPaymentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const mfr = await resolveManufacturer(userId);
  if (!mfr) return res.status(404).json({ error: "Not registered" });

  const accountNumber = parsed.data.accountNumber ?? "";
  const last4 = accountNumber.length >= 4
    ? accountNumber.slice(-4)
    : accountNumber;

  // Upsert: delete old, insert new
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

  // Mark manufacturer as having payment setup
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
