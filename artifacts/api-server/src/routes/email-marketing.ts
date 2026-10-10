/**
 * Seller email marketing (authenticated, team-context scoped, "marketing" permission).
 * Mounted at /api/marketing/email:
 *   GET  /status                       whether sending is available, caps, tracking
 *   GET/PUT /settings                  sender name, reply-to, mailing address, double opt-in
 *   GET  /audience                     counts per audience + subscriber page
 *   GET  /audience/export              CSV of the seller's list
 *   DELETE /subscribers/:id            remove an active subscriber
 *   GET/POST /campaigns, GET/PUT/DELETE /campaigns/:id
 *   POST /campaigns/:id/preview | test | send | unschedule
 * Every query is scoped to req.clerkUserId (the store owner after team context).
 */
import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, emailCampaigns, emailSettings, emailSubscribers } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { consumeRateLimitBucket, type RateLimitPolicy } from "../middlewares/rateLimit";
import { countAudiences, resolveAudience } from "../lib/emailMarketing/audience";
import { getEmailProvider, isTrackingConfigured } from "../lib/emailMarketing/provider";
import { renderCampaign } from "../lib/emailMarketing/render";
import {
  dailySendCap, enqueueCampaign, loadRenderProducts, loadSenderContext,
  missingSenderFields, processCampaign, sentToday,
} from "../lib/emailMarketing/sender";
import { tokenSecret } from "../lib/emailMarketing/tokens";
import {
  parseCampaignInput, parseSettingsInput, type Audience, type CampaignBody,
} from "../lib/emailMarketing/validation";
import { toCSV } from "./seller-export";
import { users } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);
router.use(requirePermission("marketing"));

const TEST_SEND_POLICY: RateLimitPolicy = {
  id: "mutation", limit: 10, windowMs: 60 * 60_000,
  message: "You have sent a lot of test emails. Try again in an hour.",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SCHEDULE_DAYS = 30;

const sellerOf = (req: any): string => req.clerkUserId as string;

function sendingAvailable(): boolean {
  return getEmailProvider().isConfigured() && Boolean(tokenSecret());
}

router.get("/status", async (req, res) => {
  const sellerId = sellerOf(req);
  const enabled = sendingAvailable();
  const ctx = await loadSenderContext(sellerId);
  const cap = dailySendCap();
  const used = await sentToday(sellerId);
  res.json({
    enabled,
    provider: enabled ? getEmailProvider().name : null,
    message: enabled
      ? null
      : "Email sending isn't set up yet. Drafts are saved and nothing is sent.",
    dailyCap: cap,
    sentToday: used,
    remainingToday: Math.max(0, cap - used),
    tracking: {
      delivered: enabled && isTrackingConfigured(),
      opened: enabled && isTrackingConfigured(),
      clicked: enabled && isTrackingConfigured(),
    },
    missing: missingSenderFields(ctx),
  });
});

router.get("/settings", async (req, res) => {
  const ctx = await loadSenderContext(sellerOf(req));
  res.json({
    fromName: ctx.settings?.fromName ?? "",
    replyTo: ctx.settings?.replyTo ?? "",
    postalAddress: ctx.settings?.postalAddress ?? "",
    doubleOptIn: ctx.settings?.doubleOptIn ?? false,
    defaultFromName: ctx.storeName,
  });
});

router.put("/settings", async (req, res) => {
  const parsed = parseSettingsInput(req.body);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const sellerId = sellerOf(req);
  const v = parsed.value;
  await db.insert(emailSettings)
    .values({ sellerId, ...v })
    .onConflictDoUpdate({ target: emailSettings.sellerId, set: { ...v, updatedAt: new Date() } });
  res.json({ ok: true });
});

router.get("/audience", async (req, res) => {
  const sellerId = sellerOf(req);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const counts = await countAudiences(sellerId);
  const totals = await db.execute(sql`
    SELECT status, count(*)::int AS n FROM email_subscribers WHERE seller_id = ${sellerId} GROUP BY status
  `);
  const byStatus: Record<string, number> = {};
  for (const r of totals.rows as Array<{ status: string; n: number }>) byStatus[r.status] = Number(r.n);
  const rows = await db.select({
    id: emailSubscribers.id, email: emailSubscribers.email, status: emailSubscribers.status,
    source: emailSubscribers.source, createdAt: emailSubscribers.createdAt,
  }).from(emailSubscribers)
    .where(eq(emailSubscribers.sellerId, sellerId))
    .orderBy(desc(emailSubscribers.createdAt), desc(emailSubscribers.id))
    .limit(limit + 1).offset(offset);
  res.json({
    counts, byStatus,
    subscribers: rows.slice(0, limit),
    hasMore: rows.length > limit,
  });
});

router.get("/audience/export", async (req, res) => {
  const sellerId = sellerOf(req);
  const rows = await db.select({
    email: emailSubscribers.email, status: emailSubscribers.status,
    source: emailSubscribers.source, subscribed_at: emailSubscribers.consentAt, joined_at: emailSubscribers.createdAt,
  }).from(emailSubscribers).where(eq(emailSubscribers.sellerId, sellerId)).orderBy(desc(emailSubscribers.createdAt));
  const csv = toCSV(
    rows.map((r) => ({ ...r, subscribed_at: r.subscribed_at?.toISOString() ?? "", joined_at: r.joined_at.toISOString() })),
    ["email", "status", "source", "subscribed_at", "joined_at"],
  );
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="email-subscribers-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

router.delete("/subscribers/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid subscriber" }); return; }
  // Suppressed rows (unsubscribed / bounced / complained) are kept so they can never be re-emailed.
  const del = await db.execute(sql`
    DELETE FROM email_subscribers
    WHERE id = ${id}::uuid AND seller_id = ${sellerOf(req)} AND status IN ('subscribed','pending')
    RETURNING id
  `);
  if (del.rows.length === 0) {
    const [row] = await db.select({ id: emailSubscribers.id }).from(emailSubscribers)
      .where(and(eq(emailSubscribers.id, id), eq(emailSubscribers.sellerId, sellerOf(req)))).limit(1);
    if (!row) { res.status(404).json({ error: "Subscriber not found" }); return; }
    res.status(409).json({ error: "This address unsubscribed or bounced and stays on the suppression list." });
    return;
  }
  res.json({ ok: true });
});

// ─── Campaigns ───────────────────────────────────────────────────────────────

async function campaignStats(campaignId: string) {
  const r = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'sent')::int AS sent,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
      count(*) FILTER (WHERE status IN ('queued','sending'))::int AS queued,
      count(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered,
      count(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
      count(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked,
      count(*) FILTER (WHERE bounced_at IS NOT NULL)::int AS bounced
    FROM email_campaign_sends WHERE campaign_id = ${campaignId}
  `);
  return r.rows[0] as Record<string, number>;
}

function serialize(c: typeof emailCampaigns.$inferSelect) {
  return {
    id: c.id, subject: c.subject, preheader: c.preheader, body: c.body, audience: c.audience,
    status: c.status, scheduledAt: c.scheduledAt, sentAt: c.sentAt, recipientCount: c.recipientCount,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

async function ownCampaign(req: any, res: any) {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Campaign not found" }); return null; }
  const [c] = await db.select().from(emailCampaigns)
    .where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.sellerId, sellerOf(req)))).limit(1);
  if (!c) { res.status(404).json({ error: "Campaign not found" }); return null; }
  return c;
}

async function validateOwnedProducts(sellerId: string, body: CampaignBody): Promise<boolean> {
  if (body.productIds.length === 0) return true;
  const found = await loadRenderProducts(sellerId, body.productIds);
  return found.length === body.productIds.length;
}

router.get("/campaigns", async (req, res) => {
  const rows = await db.select().from(emailCampaigns)
    .where(eq(emailCampaigns.sellerId, sellerOf(req)))
    .orderBy(desc(emailCampaigns.createdAt)).limit(100);
  const out = [];
  for (const c of rows) out.push({ ...serialize(c), stats: c.status === "draft" ? null : await campaignStats(c.id) });
  res.json({ campaigns: out });
});

router.post("/campaigns", async (req, res) => {
  const parsed = parseCampaignInput(req.body, { requireComplete: false });
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const sellerId = sellerOf(req);
  if (!(await validateOwnedProducts(sellerId, parsed.value.body))) {
    res.status(400).json({ error: "One of the selected products was not found." }); return;
  }
  const [c] = await db.insert(emailCampaigns).values({
    sellerId, subject: parsed.value.subject, preheader: parsed.value.preheader,
    audience: parsed.value.audience, body: parsed.value.body,
  }).returning();
  res.status(201).json(serialize(c));
});

router.get("/campaigns/:id", async (req, res) => {
  const c = await ownCampaign(req, res);
  if (!c) return;
  res.json({
    ...serialize(c),
    stats: c.status === "draft" ? null : await campaignStats(c.id),
    tracking: sendingAvailable() && isTrackingConfigured(),
  });
});

router.put("/campaigns/:id", async (req, res) => {
  const c = await ownCampaign(req, res);
  if (!c) return;
  if (c.status !== "draft" && c.status !== "scheduled") {
    res.status(409).json({ error: "This campaign has already been sent and can't be edited." }); return;
  }
  const parsed = parseCampaignInput(req.body, { requireComplete: false });
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  if (!(await validateOwnedProducts(sellerOf(req), parsed.value.body))) {
    res.status(400).json({ error: "One of the selected products was not found." }); return;
  }
  // Editing a scheduled campaign returns it to draft so it cannot go out half-edited.
  const [u] = await db.update(emailCampaigns).set({
    subject: parsed.value.subject, preheader: parsed.value.preheader, audience: parsed.value.audience,
    body: parsed.value.body, status: "draft", scheduledAt: null, updatedAt: new Date(),
  }).where(and(eq(emailCampaigns.id, c.id), sql`${emailCampaigns.status} IN ('draft','scheduled')`)).returning();
  if (!u) { res.status(409).json({ error: "This campaign has already started sending." }); return; }
  res.json(serialize(u));
});

router.delete("/campaigns/:id", async (req, res) => {
  const c = await ownCampaign(req, res);
  if (!c) return;
  if (c.status !== "draft") { res.status(409).json({ error: "Only drafts can be deleted." }); return; }
  await db.delete(emailCampaigns).where(and(eq(emailCampaigns.id, c.id), eq(emailCampaigns.status, "draft")));
  res.json({ ok: true });
});

async function buildPreview(sellerId: string, c: typeof emailCampaigns.$inferSelect, isTest: boolean) {
  const ctx = await loadSenderContext(sellerId);
  const body = c.body as CampaignBody;
  const out = renderCampaign({
    storeName: ctx.storeName, subject: c.subject, preheader: c.preheader, body,
    products: await loadRenderProducts(sellerId, body.productIds ?? []),
    storeUrl: ctx.storeUrl, postalAddress: ctx.postalAddress, unsubscribeUrl: null, isTest,
    campaignId: c.id,
  });
  return { ctx, ...out };
}

router.post("/campaigns/:id/preview", async (req, res) => {
  const c = await ownCampaign(req, res);
  if (!c) return;
  const { html, text } = await buildPreview(sellerOf(req), c, false);
  res.json({ html, text });
});

router.post("/campaigns/:id/test", async (req, res) => {
  const c = await ownCampaign(req, res);
  if (!c) return;
  if (!sendingAvailable()) { res.status(503).json({ error: "Email sending is not connected on this server.", code: "EMAIL_NOT_CONFIGURED" }); return; }
  const check = parseCampaignInput({ subject: c.subject, preheader: c.preheader, audience: c.audience, body: c.body }, { requireComplete: true });
  if (!check.ok) { res.status(400).json({ error: check.error }); return; }
  const sellerId = sellerOf(req);
  const counter = await consumeRateLimitBucket(`email-test:${sellerId}`, TEST_SEND_POLICY);
  if (counter.count > TEST_SEND_POLICY.limit) { res.status(429).json({ error: TEST_SEND_POLICY.message, code: "RATE_LIMITED" }); return; }

  const actorId = ((req as any).actorClerkId as string | undefined) ?? sellerId;
  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, actorId)).limit(1);
  if (!me?.email) { res.status(400).json({ error: "Your account has no email address." }); return; }
  const { ctx, html, text } = await buildPreview(sellerId, c, true);
  const r = await getEmailProvider().send({
    to: me.email, subject: `[Test] ${c.subject}`, html, text, fromName: ctx.fromName, replyTo: ctx.replyTo,
  });
  if (!r.ok) { res.status(502).json({ error: "The email provider could not send the test." }); return; }
  res.json({ ok: true, sentTo: me.email });
});

router.post("/campaigns/:id/send", async (req, res) => {
  const c = await ownCampaign(req, res);
  if (!c) return;
  if (!sendingAvailable()) {
    res.status(503).json({ error: "Email sending is not connected on this server.", code: "EMAIL_NOT_CONFIGURED" }); return;
  }
  if (c.status !== "draft" && c.status !== "scheduled") {
    res.status(409).json({ error: "This campaign has already been sent." }); return;
  }
  const check = parseCampaignInput({ subject: c.subject, preheader: c.preheader, audience: c.audience, body: c.body }, { requireComplete: true });
  if (!check.ok) { res.status(400).json({ error: check.error }); return; }
  const sellerId = sellerOf(req);
  const ctx = await loadSenderContext(sellerId);
  if (missingSenderFields(ctx).length) {
    res.status(400).json({ error: "Add your mailing address in email settings before sending.", code: "MAILING_ADDRESS_REQUIRED" }); return;
  }
  const recipients = await resolveAudience(sellerId, c.audience as Audience);
  if (recipients.length === 0) {
    res.status(400).json({ error: "No one in this audience can receive email yet.", code: "NO_RECIPIENTS" }); return;
  }

  const rawSchedule = (req.body as { scheduleAt?: unknown } | undefined)?.scheduleAt;
  if (rawSchedule !== undefined && rawSchedule !== null && rawSchedule !== "") {
    const at = new Date(String(rawSchedule));
    const now = Date.now();
    if (Number.isNaN(at.getTime()) || at.getTime() < now + 60_000 || at.getTime() > now + MAX_SCHEDULE_DAYS * 86_400_000) {
      res.status(400).json({ error: `Pick a time between 1 minute and ${MAX_SCHEDULE_DAYS} days from now.` }); return;
    }
    const [s] = await db.update(emailCampaigns).set({ status: "scheduled", scheduledAt: at, updatedAt: new Date() })
      .where(and(eq(emailCampaigns.id, c.id), sql`${emailCampaigns.status} IN ('draft','scheduled')`)).returning();
    if (!s) { res.status(409).json({ error: "This campaign has already been sent." }); return; }
    res.json(serialize(s));
    return;
  }

  const [claimed] = await db.update(emailCampaigns).set({ status: "sending", updatedAt: new Date() })
    .where(and(eq(emailCampaigns.id, c.id), sql`${emailCampaigns.status} IN ('draft','scheduled')`)).returning();
  if (!claimed) { res.status(409).json({ error: "This campaign has already started sending." }); return; }
  const n = await enqueueCampaign(claimed);
  void processCampaign(claimed.id).catch((err) => logger.error({ err, campaignId: claimed.id }, "Campaign send failed"));
  const [fresh] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c.id)).limit(1);
  res.status(202).json({ ...serialize(fresh), recipientCount: n });
});

router.post("/campaigns/:id/unschedule", async (req, res) => {
  const c = await ownCampaign(req, res);
  if (!c) return;
  const [u] = await db.update(emailCampaigns).set({ status: "draft", scheduledAt: null, updatedAt: new Date() })
    .where(and(eq(emailCampaigns.id, c.id), eq(emailCampaigns.status, "scheduled"))).returning();
  if (!u) { res.status(409).json({ error: "This campaign is not scheduled." }); return; }
  res.json(serialize(u));
});

export default router;
