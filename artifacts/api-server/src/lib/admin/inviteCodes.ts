import { randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, adminInviteCodes, adminInviteCodeUses } from "@workspace/db";

// Unambiguous characters only (no 0/O, 1/I/L), matching user referral codes,
// but 8 long so an admin code can never collide with a 6-character user code.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ADMIN_CODE_LENGTH = 8;

export function generateAdminInviteCode(length = ADMIN_CODE_LENGTH): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export type RedeemResult = "ok" | "invalid" | "expired" | "exhausted" | "already_used";

type Tx = Pick<typeof db, "select" | "insert" | "update">;

/**
 * Redeems an admin-issued invite code for one user. The uses counter is
 * incremented with a guarded UPDATE, so concurrent redemptions can never push
 * a code past max_uses; the unique user_id row makes a retry idempotent.
 */
export async function redeemAdminInviteCode(tx: Tx, rawCode: string, userId: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  const [row] = await tx.select().from(adminInviteCodes).where(eq(adminInviteCodes.code, code)).limit(1);
  if (!row || row.disabledAt) return "invalid";
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return "expired";

  const [used] = await tx.insert(adminInviteCodeUses)
    .values({ codeId: row.id, userId })
    .onConflictDoNothing()
    .returning({ id: adminInviteCodeUses.id });
  if (!used) return "already_used";

  const bumped = await tx.update(adminInviteCodes)
    .set({ uses: sql`${adminInviteCodes.uses} + 1` })
    .where(and(
      eq(adminInviteCodes.id, row.id),
      isNull(adminInviteCodes.disabledAt),
      sql`(${adminInviteCodes.maxUses} IS NULL OR ${adminInviteCodes.uses} < ${adminInviteCodes.maxUses})`,
    ))
    .returning({ id: adminInviteCodes.id });
  if (bumped.length === 0) {
    // Over the limit: undo the claim inside the caller's transaction.
    await (tx as any).delete(adminInviteCodeUses).where(eq(adminInviteCodeUses.id, used.id));
    return "exhausted";
  }
  return "ok";
}
