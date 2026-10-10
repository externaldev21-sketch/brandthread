/**
 * Campaign send queue. `enqueueCampaign` snapshots the consented audience into
 * email_campaign_sends (queued); `processCampaign` drains it in batches while
 * enforcing the per-seller daily cap and re-checking suppression for every
 * recipient immediately before sending. Safe to run from several instances:
 * rows are claimed with FOR UPDATE SKIP LOCKED.
 */
import { db, emailCampaigns, emailSettings, products, productVariants, storefronts, users } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../logger";
import { getWebOrigin } from "../webOrigin";
import { resolveAudience, isSendableStatus } from "./audience";
import { getEmailProvider, type EmailProvider } from "./provider";
import { renderCampaign, type RenderProduct } from "./render";
import { signToken, tokenSecret } from "./tokens";
import { monthlyEmailsLeft } from "./allowance";
import type { Audience, CampaignBody } from "./validation";

export const DEFAULT_DAILY_CAP = 1000;
export const DEFAULT_BATCH_SIZE = 50;
const SEND_CONCURRENCY = 5;
const STALE_CLAIM_MINUTES = 15;

export function dailySendCap(): number {
  const n = Number(process.env.EMAIL_DAILY_SEND_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

export function batchSize(): number {
  const n = Number(process.env.EMAIL_BATCH_SIZE);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_BATCH_SIZE;
}

/** How many emails the next batch may contain. Pure so the cap maths is unit-tested. */
export function planBatch(opts: { cap: number; sentToday: number; queued: number; batchSize: number }): number {
  return Math.max(0, Math.min(opts.batchSize, opts.queued, opts.cap - opts.sentToday));
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function unsubscribeUrl(rawToken: string): string {
  return `${getWebOrigin()}/api/public/email/unsubscribe/${signToken("unsub", rawToken)}`;
}

export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function sentToday(sellerId: string, now = new Date()): Promise<number> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM email_campaign_sends
    WHERE seller_id = ${sellerId}
      AND ((status = 'sent' AND sent_at >= ${startOfUtcDay(now)}) OR status = 'sending')
  `);
  return Number((r.rows[0] as { n: number }).n);
}

export type CampaignRow = typeof emailCampaigns.$inferSelect;

export async function loadSenderContext(sellerId: string) {
  const [settings] = await db.select().from(emailSettings).where(eq(emailSettings.sellerId, sellerId)).limit(1);
  const [sf] = await db.select({ title: storefronts.title, slug: storefronts.slug, status: storefronts.status })
    .from(storefronts).where(eq(storefronts.ownerId, sellerId)).limit(1);
  const [u] = await db.select({ name: users.name, displayName: users.displayName, email: users.email })
    .from(users).where(eq(users.clerkId, sellerId)).limit(1);
  const storeName = (sf?.title || settings?.fromName || u?.displayName || u?.name || "Store").trim();
  return {
    settings: settings ?? null,
    storeName,
    fromName: settings?.fromName || storeName,
    replyTo: settings?.replyTo ?? null,
    postalAddress: settings?.postalAddress ?? null,
    storeUrl: sf && sf.status === "published" ? `${getWebOrigin()}/api/store/site/${sf.slug}` : null,
    ownerEmail: u?.email ?? null,
  };
}

export async function loadRenderProducts(sellerId: string, ids: string[]): Promise<RenderProduct[]> {
  if (ids.length === 0) return [];
  const rows = await db.select({ id: products.id, name: products.name, images: products.images })
    .from(products).where(and(eq(products.ownerId, sellerId), inArray(products.id, ids)));
  const variants = rows.length
    ? await db.select({ productId: productVariants.productId, priceCents: productVariants.priceCents })
        .from(productVariants).where(inArray(productVariants.productId, rows.map((r) => r.id)))
    : [];
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r)).map((p) => {
    const prices = variants.filter((v) => v.productId === p.id).map((v) => v.priceCents);
    const imgs = Array.isArray(p.images) ? (p.images as string[]) : [];
    return { id: p.id, name: p.name, imageUrl: imgs[0] ?? null, priceCents: prices.length ? Math.min(...prices) : null };
  });
}

export function missingSenderFields(ctx: { postalAddress: string | null }): string[] {
  return ctx.postalAddress ? [] : ["mailing_address"];
}

/** Snapshot the audience into the queue and flip the campaign to 'sending'. Returns the recipient count. */
export async function enqueueCampaign(campaign: CampaignRow): Promise<number> {
  const recipients = await resolveAudience(campaign.sellerId, campaign.audience as Audience);
  if (recipients.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < recipients.length; i += CHUNK) {
      await db.execute(sql`
        INSERT INTO email_campaign_sends (campaign_id, seller_id, subscriber_id, email)
        SELECT ${campaign.id}::uuid, ${campaign.sellerId}, r.sid::uuid, r.email
        FROM jsonb_to_recordset(${JSON.stringify(recipients.slice(i, i + CHUNK).map((r) => ({ sid: r.subscriberId, email: r.email })))}::jsonb)
          AS r(sid text, email text)
        ON CONFLICT (campaign_id, subscriber_id) DO NOTHING
      `);
    }
  }
  await db.update(emailCampaigns)
    .set({ status: "sending", recipientCount: recipients.length, updatedAt: new Date() })
    .where(eq(emailCampaigns.id, campaign.id));
  return recipients.length;
}

export type ProcessResult = {
  sent: number; failed: number; skipped: number; remaining: number;
  capReached: boolean; retryLater: boolean; completed: boolean;
};

export type ProcessDeps = {
  provider?: EmailProvider;
  now?: () => Date;
  cap?: number;
  batchSize?: number;
  maxBatches?: number;
  /** Monthly plan allowance left (allowance.ts); injectable for tests. */
  monthlyLeft?: (sellerId: string, now: Date) => Promise<number>;
};

export async function processCampaign(campaignId: string, deps: ProcessDeps = {}): Promise<ProcessResult> {
  const provider = deps.provider ?? getEmailProvider();
  const now = deps.now ?? (() => new Date());
  const cap = deps.cap ?? dailySendCap();
  const size = deps.batchSize ?? batchSize();
  const result: ProcessResult = { sent: 0, failed: 0, skipped: 0, remaining: 0, capReached: false, retryLater: false, completed: false };

  const [campaign] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)).limit(1);
  if (!campaign || campaign.status !== "sending") return result;

  // Rows claimed by a worker that died are failed, not retried, so a recipient is never emailed twice.
  await db.execute(sql`
    UPDATE email_campaign_sends SET status = 'failed', error = 'interrupted'
    WHERE campaign_id = ${campaignId} AND status = 'sending'
      AND claimed_at < ${new Date(now().getTime() - STALE_CLAIM_MINUTES * 60_000)}
  `);

  if (!provider.isConfigured() || !tokenSecret()) {
    result.retryLater = true;
    result.remaining = await queuedCount(campaignId);
    return result;
  }

  const ctx = await loadSenderContext(campaign.sellerId);
  const body = campaign.body as CampaignBody;
  const renderProducts = await loadRenderProducts(campaign.sellerId, body.productIds ?? []);

  for (let batch = 0; batch < (deps.maxBatches ?? Number.MAX_SAFE_INTEGER); batch++) {
    const queued = await queuedCount(campaignId);
    if (queued === 0) break;
    const allowed = Math.min(
      planBatch({ cap, sentToday: await sentToday(campaign.sellerId, now()), queued, batchSize: size }),
      deps.monthlyLeft ? await deps.monthlyLeft(campaign.sellerId, now()) : await monthlyEmailsLeft(campaign.sellerId, now()),
    );
    if (allowed === 0) { result.capReached = true; break; }

    const claimed = (await db.execute(sql`
      UPDATE email_campaign_sends SET status = 'sending', claimed_at = ${now()}
      WHERE id IN (
        SELECT id FROM email_campaign_sends WHERE campaign_id = ${campaignId} AND status = 'queued'
        ORDER BY created_at, id LIMIT ${allowed} FOR UPDATE SKIP LOCKED
      )
      RETURNING id, subscriber_id AS "subscriberId", email
    `)).rows as Array<{ id: string; subscriberId: string; email: string }>;
    if (claimed.length === 0) break;

    // Suppression is re-read here, not trusted from enqueue time.
    const subs = await db.execute(sql`
      SELECT id, status, unsubscribe_token AS token FROM email_subscribers
      WHERE id IN (${sql.join(claimed.map((c) => sql`${c.subscriberId}::uuid`), sql`, `)})
    `);
    const subById = new Map((subs.rows as Array<{ id: string; status: string; token: string }>).map((s) => [s.id, s]));

    let stop = false;
    for (let i = 0; i < claimed.length; i += SEND_CONCURRENCY) {
      const chunk = claimed.slice(i, i + SEND_CONCURRENCY);
      await Promise.all(chunk.map(async (row) => {
        if (stop) { await setSend(row.id, "queued"); return; }
        const sub = subById.get(row.subscriberId);
        if (!sub || !isSendableStatus(sub.status)) {
          await setSend(row.id, "skipped", { error: "suppressed" });
          result.skipped++;
          return;
        }
        const url = unsubscribeUrl(sub.token);
        const { html, text } = renderCampaign({
          storeName: ctx.storeName, subject: campaign.subject, preheader: campaign.preheader,
          body, products: renderProducts, storeUrl: ctx.storeUrl, postalAddress: ctx.postalAddress, unsubscribeUrl: url,
        });
        const r = await provider.send({
          to: row.email, subject: campaign.subject, html, text,
          fromName: ctx.fromName, replyTo: ctx.replyTo, headers: listUnsubscribeHeaders(url),
        });
        if (r.ok) {
          await setSend(row.id, "sent", { providerMessageId: r.id, sentAt: now() });
          result.sent++;
        } else if (r.retryable) {
          stop = true;
          result.retryLater = true;
          await setSend(row.id, "queued");
        } else {
          await setSend(row.id, "failed", { error: r.error.slice(0, 300) });
          result.failed++;
        }
      }));
      if (stop) {
        for (const row of claimed.slice(i + SEND_CONCURRENCY)) await setSend(row.id, "queued");
        break;
      }
    }
    if (stop) break;
  }

  result.remaining = await queuedCount(campaignId);
  const open = await db.execute(sql`
    SELECT count(*)::int AS n FROM email_campaign_sends WHERE campaign_id = ${campaignId} AND status IN ('queued','sending')
  `);
  if (Number((open.rows[0] as { n: number }).n) === 0) {
    await db.update(emailCampaigns)
      .set({ status: "sent", sentAt: now(), updatedAt: now() })
      .where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.status, "sending")));
    result.completed = true;
  }
  return result;
}

async function queuedCount(campaignId: string): Promise<number> {
  const r = await db.execute(sql`SELECT count(*)::int AS n FROM email_campaign_sends WHERE campaign_id = ${campaignId} AND status = 'queued'`);
  return Number((r.rows[0] as { n: number }).n);
}

async function setSend(
  id: string,
  status: "queued" | "sent" | "failed" | "skipped",
  extra: { error?: string; providerMessageId?: string | null; sentAt?: Date } = {},
): Promise<void> {
  await db.execute(sql`
    UPDATE email_campaign_sends SET status = ${status},
      error = ${extra.error ?? null},
      provider_message_id = ${extra.providerMessageId ?? null},
      sent_at = ${extra.sentAt ?? null},
      claimed_at = ${status === "queued" ? null : sql`claimed_at`}
    WHERE id = ${id}
  `);
}

/** Job body: start due scheduled campaigns, then drain every campaign still sending. */
export async function processDueCampaigns(deps: ProcessDeps = {}): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const due = await db.execute(sql`
    UPDATE email_campaigns SET status = 'sending', updated_at = now()
    WHERE status = 'scheduled' AND scheduled_at <= ${now}
    RETURNING id
  `);
  for (const row of due.rows as Array<{ id: string }>) {
    const [c] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, row.id)).limit(1);
    if (c) await enqueueCampaign(c);
  }
  const sending = await db.select({ id: emailCampaigns.id }).from(emailCampaigns).where(eq(emailCampaigns.status, "sending"));
  for (const c of sending) {
    try { await processCampaign(c.id, deps); }
    catch (err) { logger.error({ err, campaignId: c.id }, "Campaign processing failed"); }
  }
  return sending.length;
}
