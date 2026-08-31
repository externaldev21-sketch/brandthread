import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const PROCESSING_LEASE_MS = 5 * 60_000;
export const STRIPE_WEBHOOK_HEARTBEAT_MS = 30_000;

export type StripeWebhookClaim =
  | { claimed: true; attemptCount: number }
  | { claimed: false; reason: "processed" | "in_flight" };

export function sanitizeWebhookError(error: unknown): string {
  const name = error instanceof Error && error.name ? error.name : "Error";
  return name.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80) || "Error";
}

export async function claimStripeWebhookEvent(
  eventId: string,
  eventType: string,
): Promise<StripeWebhookClaim> {
  const result = await db.execute(sql`
    INSERT INTO stripe_webhook_events (
      event_id, event_type, status, attempt_count, received_at,
      processing_started_at, processed_at, last_error
    )
    VALUES (${eventId}, ${eventType}, 'processing', 1, now(), now(), NULL, NULL)
    ON CONFLICT (event_id) DO UPDATE SET
      event_type = EXCLUDED.event_type,
      status = 'processing',
      attempt_count = stripe_webhook_events.attempt_count + 1,
      processing_started_at = now(),
      processed_at = NULL,
      last_error = NULL
    WHERE stripe_webhook_events.status = 'failed'
       OR (
         stripe_webhook_events.status = 'processing'
         AND stripe_webhook_events.processing_started_at
           <= now() - (${PROCESSING_LEASE_MS} * interval '1 millisecond')
       )
    RETURNING attempt_count
  `);
  const row = result.rows[0] as { attempt_count: number | string } | undefined;
  if (row) return { claimed: true, attemptCount: Number(row.attempt_count) };
  const statusResult = await db.execute(sql`
    SELECT status
    FROM stripe_webhook_events
    WHERE event_id = ${eventId}
  `);
  const status = (statusResult.rows[0] as { status?: string } | undefined)?.status;
  return { claimed: false, reason: status === "processed" ? "processed" : "in_flight" };
}

export async function completeStripeWebhookEvent(eventId: string, attemptCount: number): Promise<void> {
  await db.execute(sql`
    UPDATE stripe_webhook_events
    SET status = 'processed', processed_at = now(), last_error = NULL
    WHERE event_id = ${eventId}
      AND status = 'processing'
      AND attempt_count = ${attemptCount}
  `);
}

export async function renewStripeWebhookLease(
  eventId: string,
  attemptCount: number,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE stripe_webhook_events
    SET processing_started_at = now()
    WHERE event_id = ${eventId}
      AND status = 'processing'
      AND attempt_count = ${attemptCount}
    RETURNING event_id
  `);
  return result.rows.length === 1;
}

export async function failStripeWebhookEvent(
  eventId: string,
  attemptCount: number,
  error: unknown,
): Promise<void> {
  await db.execute(sql`
    UPDATE stripe_webhook_events
    SET status = 'failed', last_error = ${sanitizeWebhookError(error)}
    WHERE event_id = ${eventId}
      AND status = 'processing'
      AND attempt_count = ${attemptCount}
  `);
}

export async function waitForStripeWebhookOutcome(
  eventId: string,
  timeoutMs = 5_000,
): Promise<"processed" | "failed" | "in_flight"> {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await db.execute(sql`
      SELECT status
      FROM stripe_webhook_events
      WHERE event_id = ${eventId}
    `);
    const status = (result.rows[0] as { status?: string } | undefined)?.status;
    if (status === "processed" || status === "failed") return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return "in_flight";
}