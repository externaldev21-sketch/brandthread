/**
 * First-payout identity gate (feature 62).
 *
 * A seller's first money out of Brandthread — the first order transfer to
 * their Stripe account, or their first manual cash-out — waits until the
 * person behind the store has passed Stripe Identity (government ID + live
 * selfie). Their bank account is already required by Stripe Connect
 * (payouts_enabled) before any payout can land.
 *
 * Sellers who were already paid before this shipped are not held: the ledger
 * shows money already reached them, so the gate only applies to new sellers.
 *
 * The held money stays on the platform balance — the money sweep retries the
 * transfer and it goes out as soon as the seller verifies.
 *
 * Kill switch: PAYOUT_REQUIRE_IDENTITY=off.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { DbExecutor } from "./ledger";

export type FirstPayoutCheck =
  | { ok: true; reason: "verified" | "already_paid" | "gate_off" }
  | { ok: false; reason: "identity_required" };

export function firstPayoutGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.PAYOUT_REQUIRE_IDENTITY ?? "").trim().toLowerCase();
  return !(v === "off" || v === "false" || v === "0");
}

export const IDENTITY_REQUIRED_MESSAGE =
  "Verify your identity to get your first payout. It takes a few minutes with a photo ID.";

type Row = { verified: boolean | null; verification_status: string | null; paid_before: boolean | null };

export async function checkFirstPayout(
  executor: DbExecutor | typeof db,
  sellerId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FirstPayoutCheck> {
  if (!firstPayoutGateEnabled(env)) return { ok: true, reason: "gate_off" };
  const result = await executor.execute(sql`
    SELECT u.verified, u.verification_status,
           EXISTS (
             SELECT 1 FROM ledger_postings p
             WHERE p.account = 'seller_paid_out' AND p.party_id = ${sellerId} AND p.amount_cents > 0
           ) OR EXISTS (
             SELECT 1 FROM seller_cashout_attempts c
             WHERE c.owner_id = ${sellerId} AND c.status = 'succeeded'
           ) AS paid_before
    FROM users u WHERE u.clerk_id = ${sellerId} LIMIT 1
  `);
  const row = ((result as { rows?: Row[] }).rows ?? [])[0];
  if (row?.verified === true && row.verification_status === "verified") return { ok: true, reason: "verified" };
  if (row?.paid_before) return { ok: true, reason: "already_paid" };
  return { ok: false, reason: "identity_required" };
}
