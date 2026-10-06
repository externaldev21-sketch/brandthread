/**
 * Audience resolution. The ONLY source of recipients is email_subscribers rows
 * in status 'subscribed' (people who gave explicit consent on the seller's
 * store). Nothing in the codebase records marketing consent for customers or
 * followers (customers has no consent column and checkout has no opt-in box),
 * so "customers" and "followers" are narrower segments OF that consented list:
 * subscribers who have also ordered from the seller / follow the seller. Anyone
 * unsubscribed, bounced or complained is suppressed and never returned.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Audience } from "./validation";

export type Recipient = { subscriberId: string; email: string };

export const SENDABLE_STATUS = "subscribed";

/** Pure guard shared with the send loop: only fully consented rows can be emailed. */
export function isSendableStatus(status: string | null | undefined): boolean {
  return status === SENDABLE_STATUS;
}

/** Case-insensitive de-dupe that keeps the first occurrence. */
export function dedupeRecipients(list: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of list) {
    const key = r.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function segmentClause(sellerId: string, audience: Audience) {
  if (audience === "customers") {
    return sql`AND EXISTS (SELECT 1 FROM customers c WHERE c.owner_id = ${sellerId} AND lower(c.email) = lower(s.email))`;
  }
  if (audience === "followers") {
    return sql`AND EXISTS (SELECT 1 FROM follows f JOIN users u ON u.clerk_id = f.follower_id WHERE f.following_id = ${sellerId} AND lower(u.email) = lower(s.email))`;
  }
  return sql``;
}

export async function resolveAudience(sellerId: string, audience: Audience): Promise<Recipient[]> {
  const result = await db.execute(sql`
    SELECT s.id AS "subscriberId", s.email AS email
    FROM email_subscribers s
    WHERE s.seller_id = ${sellerId} AND s.status = ${SENDABLE_STATUS}
    ${segmentClause(sellerId, audience)}
    ORDER BY s.created_at ASC
  `);
  return dedupeRecipients(result.rows as Recipient[]);
}

export async function countAudiences(sellerId: string): Promise<Record<Audience, number>> {
  const out = { subscribers: 0, customers: 0, followers: 0 } as Record<Audience, number>;
  for (const a of ["subscribers", "customers", "followers"] as const) {
    const r = await db.execute(sql`
      SELECT count(*)::int AS n FROM email_subscribers s
      WHERE s.seller_id = ${sellerId} AND s.status = ${SENDABLE_STATUS}
      ${segmentClause(sellerId, a)}
    `);
    out[a] = Number((r.rows[0] as { n: number }).n);
  }
  return out;
}
