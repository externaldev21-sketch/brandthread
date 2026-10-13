/**
 * Opt-in SMS order updates — mounted at /api/notification-prefs/sms.
 *
 * GET  /                → { available, phone, enabled }
 * PUT  /  { enabled: false }                → opt out
 * PUT  /  { enabled: true, phone }          → texts a 6-digit code to `phone`
 *                                             ({ ..., codeSentTo }); a number the
 *                                             buyer already confirmed re-enables
 *                                             directly
 * POST /verify { code }                     → confirms the number, opts in and
 *                                             sends one confirmation text
 *
 * `available` is false whenever Twilio isn't configured (lib/sms.ts
 * smsEnabled()); the client then shows nothing. Opting out always works.
 */
import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, smsPhoneVerifications, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  CONFIRMATION_SMS, generateVerificationCode, hashVerificationCode, normalizeE164,
  recentVerificationCount, sendLoggedSms, smsEnabled, verificationSms,
} from "../lib/sms";

const router = Router();
router.use(requireAuth);

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODES_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

async function state(clerkId: string) {
  const [row] = await db.select({ phone: users.smsPhone, enabled: users.smsOrderUpdates })
    .from(users).where(eq(users.clerkId, clerkId)).limit(1);
  const available = smsEnabled();
  return {
    available,
    phone: row?.phone ?? null,
    enabled: available && row?.enabled === true && Boolean(row?.phone),
  };
}

async function optIn(clerkId: string, phone: string, now = new Date()) {
  await db.update(users).set({
    smsPhone: phone, smsOrderUpdates: true, smsOptedInAt: now, smsOptedOutAt: null,
  }).where(eq(users.clerkId, clerkId));
  await sendLoggedSms({ userId: clerkId, kind: "confirmation", to: phone, body: CONFIRMATION_SMS });
}

router.get("/", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  try {
    res.json(await state(clerkId));
  } catch (err) {
    req.log.error({ err }, "Failed to read SMS preferences");
    res.json({ available: false, phone: null, enabled: false });
  }
});

router.put("/", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { enabled, phone: rawPhone } = (req.body ?? {}) as { enabled?: unknown; phone?: unknown };
  if (typeof enabled !== "boolean") { res.status(400).json({ error: "enabled must be a boolean" }); return; }
  try {
    if (!enabled) {
      await db.update(users).set({ smsOrderUpdates: false, smsOptedOutAt: new Date() })
        .where(and(eq(users.clerkId, clerkId), eq(users.smsOrderUpdates, true)));
      await db.delete(smsPhoneVerifications).where(eq(smsPhoneVerifications.userId, clerkId));
      res.json(await state(clerkId));
      return;
    }
    if (!smsEnabled()) { res.status(409).json({ error: "Text messages aren't available" }); return; }
    const phone = normalizeE164(rawPhone);
    if (!phone) {
      res.status(400).json({ error: "Enter a valid mobile number with its country code, like +1 555 123 4567." });
      return;
    }
    const [user] = await db.select({ phone: users.smsPhone }).from(users)
      .where(eq(users.clerkId, clerkId)).limit(1);
    if (!user) { res.status(404).json({ error: "Account not found" }); return; }
    // A number this buyer already confirmed doesn't need a second code.
    if (user.phone === phone) {
      await optIn(clerkId, phone);
      res.json(await state(clerkId));
      return;
    }
    if (await recentVerificationCount(clerkId) >= MAX_CODES_PER_HOUR) {
      res.status(429).json({ error: "Too many codes requested. Try again in an hour." });
      return;
    }
    const code = generateVerificationCode();
    const now = new Date();
    const values = {
      userId: clerkId, phone, codeHash: hashVerificationCode(clerkId, phone, code),
      attempts: 0, expiresAt: new Date(now.getTime() + CODE_TTL_MS), createdAt: now,
    };
    await db.insert(smsPhoneVerifications).values(values).onConflictDoUpdate({
      target: smsPhoneVerifications.userId,
      set: { phone: values.phone, codeHash: values.codeHash, attempts: 0, expiresAt: values.expiresAt, createdAt: now },
    });
    const sent = await sendLoggedSms({ userId: clerkId, kind: "verify", to: phone, body: verificationSms(code) });
    if (!sent.ok) {
      await db.delete(smsPhoneVerifications).where(eq(smsPhoneVerifications.userId, clerkId));
      res.status(502).json({ error: "We couldn't text that number. Check it and try again." });
      return;
    }
    res.json({ ...(await state(clerkId)), codeSentTo: phone });
  } catch (err) {
    req.log.error({ err }, "Failed to update SMS preferences");
    res.status(500).json({ error: "Failed to update text message settings" });
  }
});

router.post("/verify", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const code = typeof req.body?.code === "string" ? req.body.code.replace(/\D/g, "") : "";
  if (code.length !== 6) { res.status(400).json({ error: "Enter the 6-digit code." }); return; }
  if (!smsEnabled()) { res.status(409).json({ error: "Text messages aren't available" }); return; }
  try {
    const [pending] = await db.select().from(smsPhoneVerifications)
      .where(eq(smsPhoneVerifications.userId, clerkId)).limit(1);
    if (!pending || pending.expiresAt.getTime() < Date.now() || pending.attempts >= MAX_ATTEMPTS) {
      res.status(410).json({ error: "That code expired. Send a new code." });
      return;
    }
    if (hashVerificationCode(clerkId, pending.phone, code) !== pending.codeHash) {
      await db.update(smsPhoneVerifications).set({ attempts: sql`${smsPhoneVerifications.attempts} + 1` })
        .where(eq(smsPhoneVerifications.userId, clerkId));
      res.status(400).json({ error: "That code isn't right. Check it and try again." });
      return;
    }
    await db.delete(smsPhoneVerifications).where(eq(smsPhoneVerifications.userId, clerkId));
    await optIn(clerkId, pending.phone);
    res.json(await state(clerkId));
  } catch (err) {
    req.log.error({ err }, "Failed to verify SMS phone");
    res.status(500).json({ error: "Failed to verify the code" });
  }
});

export default router;
