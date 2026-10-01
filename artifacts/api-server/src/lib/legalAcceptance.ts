import { users, legalAcceptances } from "@workspace/db";
import { eq } from "drizzle-orm";

export const LEGAL_ACCEPTANCE_SOURCES = ["signup", "update_prompt"] as const;
export type LegalAcceptanceSource = (typeof LEGAL_ACCEPTANCE_SOURCES)[number];

/** Anything that can run drizzle queries: the db itself or a transaction. */
type Executor = {
  update: (...args: any[]) => any;
  insert: (...args: any[]) => any;
};

/**
 * Records that an account agreed to a legal document set version.
 *
 * users.terms_version / terms_accepted_at always reflect the latest agreement.
 * legal_acceptances keeps the history: one row per account and version, so
 * repeating the same request (a retry, or the pending sign-up consent flushed
 * twice) never adds a second row and keeps the original timestamp and source.
 *
 * Returns false when the account doesn't exist yet (nothing is written).
 */
export async function recordLegalAcceptance(
  executor: Executor,
  input: { clerkId: string; version: string; source?: LegalAcceptanceSource; acceptedAt?: Date },
): Promise<boolean> {
  const acceptedAt = input.acceptedAt ?? new Date();
  const rows: Array<{ id: unknown }> = await executor
    .update(users)
    .set({ termsAcceptedAt: acceptedAt, termsVersion: input.version, updatedAt: acceptedAt })
    .where(eq(users.clerkId, input.clerkId))
    .returning({ id: users.id });
  if (rows.length === 0) return false;

  await executor
    .insert(legalAcceptances)
    .values({
      clerkId: input.clerkId,
      version: input.version,
      source: input.source ?? "signup",
      acceptedAt,
    })
    .onConflictDoNothing({ target: [legalAcceptances.clerkId, legalAcceptances.version] });
  return true;
}
