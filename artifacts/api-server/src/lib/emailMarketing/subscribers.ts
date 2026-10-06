/** Subscriber lifecycle: idempotent signup, confirm, unsubscribe. */
import { db, emailSubscribers } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { newRawToken } from "./tokens";

export type SubscribeOutcome = {
  subscriberId: string;
  status: "subscribed" | "pending" | "suppressed";
  created: boolean;
  /** true when a double opt-in confirmation email should be sent now */
  needsConfirmation: boolean;
  rawToken: string;
};

/**
 * Idempotent on (seller_id, lower(email)). Re-submitting an active address is a no-op;
 * an unsubscribed address that signs up again has given fresh consent and is
 * re-activated; bounced / complained addresses stay suppressed.
 */
export async function subscribeEmail(opts: {
  sellerId: string; email: string; source: string; ipHash: string | null; doubleOptIn: boolean;
  now?: Date;
}): Promise<SubscribeOutcome> {
  const now = opts.now ?? new Date();
  const initial = opts.doubleOptIn ? "pending" : "subscribed";
  const inserted = await db.execute(sql`
    INSERT INTO email_subscribers (seller_id, email, source, status, unsubscribe_token, consent_at, consent_ip_hash)
    VALUES (${opts.sellerId}, ${opts.email}, ${opts.source}, ${initial}, ${newRawToken()},
            ${opts.doubleOptIn ? null : now}, ${opts.ipHash})
    ON CONFLICT (seller_id, lower(email)) DO NOTHING
    RETURNING id
  `);
  const created = inserted.rows.length > 0;
  const [row] = await db.select().from(emailSubscribers)
    .where(and(eq(emailSubscribers.sellerId, opts.sellerId), sql`lower(${emailSubscribers.email}) = ${opts.email.toLowerCase()}`))
    .limit(1);

  const base = { subscriberId: row.id, rawToken: row.unsubscribeToken };
  if (row.status === "bounced" || row.status === "complained") {
    return { ...base, status: "suppressed", created: false, needsConfirmation: false };
  }
  if (row.status === "subscribed") {
    return { ...base, status: "subscribed", created, needsConfirmation: false };
  }
  // pending or unsubscribed -> apply current opt-in mode
  if (opts.doubleOptIn) {
    if (row.status === "unsubscribed") {
      await db.update(emailSubscribers)
        .set({ status: "pending", unsubscribedAt: null, updatedAt: now })
        .where(eq(emailSubscribers.id, row.id));
    }
    return { ...base, status: "pending", created, needsConfirmation: true };
  }
  await db.update(emailSubscribers)
    .set({ status: "subscribed", unsubscribedAt: null, consentAt: now, consentIpHash: opts.ipHash, updatedAt: now })
    .where(eq(emailSubscribers.id, row.id));
  return { ...base, status: "subscribed", created, needsConfirmation: false };
}

export async function findByRawToken(raw: string) {
  const [row] = await db.select().from(emailSubscribers).where(eq(emailSubscribers.unsubscribeToken, raw)).limit(1);
  return row ?? null;
}

/** Marks unsubscribed. Idempotent; never downgrades bounced/complained suppression. */
export async function unsubscribeByRawToken(raw: string): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE email_subscribers
    SET status = CASE WHEN status IN ('bounced','complained') THEN status ELSE 'unsubscribed' END,
        unsubscribed_at = COALESCE(unsubscribed_at, now()), updated_at = now()
    WHERE unsubscribe_token = ${raw}
    RETURNING id
  `);
  return res.rows.length > 0;
}

export async function confirmByRawToken(raw: string, ipHash: string | null): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE email_subscribers
    SET status = 'subscribed', consent_at = now(), consent_ip_hash = ${ipHash}, updated_at = now()
    WHERE unsubscribe_token = ${raw} AND status = 'pending'
    RETURNING id
  `);
  return res.rows.length > 0;
}
