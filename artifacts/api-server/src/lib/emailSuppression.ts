/**
 * Account-wide email suppression list (migration 270). Filled from Resend's
 * bounce/complaint webhook (routes/email-marketing-webhook.ts) and checked
 * before every transactional send in lib/brandthreadEmail.ts.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type SuppressionReason = "bounced" | "complained";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function suppressEmails(emails: string[], reason: SuppressionReason): Promise<number> {
  const clean = [...new Set(emails.map(normalizeEmail).filter((e) => e.includes("@")))];
  for (const email of clean) {
    await db.execute(sql`
      INSERT INTO email_suppressions (email, reason) VALUES (${email}, ${reason})
      ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason, updated_at = now()
    `);
  }
  return clean.length;
}

export async function isEmailSuppressed(email: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 FROM email_suppressions WHERE email = ${normalizeEmail(email)} LIMIT 1`);
  return ((result as any).rows?.length ?? 0) > 0;
}
