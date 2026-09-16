import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { cashOutableAmount, isValidPayoutIdempotencyKey } from "../payoutSafety";

const financeRoute = fs.readFileSync(
  path.resolve(__dirname, "../../routes/finance.ts"),
  "utf8",
);
const cashoutMigration = fs.readFileSync(
  path.resolve(__dirname, "../../../../../lib/db/migrations/075_seller_cashout_attempts.sql"),
  "utf8",
);
const cashoutDestinationMigration = fs.readFileSync(
  path.resolve(__dirname, "../../../../../lib/db/migrations/076_cashout_attempt_destination.sql"),
  "utf8",
);
const shippingLabelRoute = fs.readFileSync(
  path.resolve(__dirname, "../../routes/shipping-labels.ts"),
  "utf8",
);

describe("seller payout safety", () => {
  it("subtracts shipping-label reservations from the displayed cash-outable balance", () => {
    expect(cashOutableAmount(12_500, 2_500)).toBe(10_000);
    expect(cashOutableAmount(2_500, 12_500)).toBe(0);
  });

  it("fails closed for invalid provider amounts", () => {
    expect(cashOutableAmount(10.5, 0)).toBe(0);
    expect(cashOutableAmount(Number.NaN, 0)).toBe(0);
  });

  it("accepts only bounded retry-safe payout keys", () => {
    expect(isValidPayoutIdempotencyKey("cashout_1234567890_abcd")).toBe(true);
    expect(isValidPayoutIdempotencyKey("too-short")).toBe(false);
    expect(isValidPayoutIdempotencyKey("cashout key with spaces")).toBe(false);
    expect(isValidPayoutIdempotencyKey("x".repeat(129))).toBe(false);
  });

  it("persists and replays seller-scoped payout attempts", () => {
    expect(cashoutMigration).toContain("UNIQUE INDEX IF NOT EXISTS seller_cashout_attempts_owner_idempotency_unique");
    expect(cashoutDestinationMigration).toContain("stripe_account_id TEXT");
    expect(cashoutDestinationMigration).toContain("bank_destination_id TEXT");
    expect(financeRoute).toContain('existing.status === "succeeded"');
    expect(financeRoute).toContain("duplicate: true");
    expect(financeRoute).toContain('idempotencyKey: `brandthread-cashout/${current.id}`');
    expect(financeRoute).toContain("brandthread_cashout_attempt");
    expect(financeRoute).toContain("PAYOUT_REVIEW_REQUIRED");
    expect(financeRoute).toContain("const claimResult: CashoutResult");
    expect(shippingLabelRoute).toContain("CASHOUT_IN_PROGRESS");
  });

  it("binds payouts to a fresh exact USD amount and eligible bank account", () => {
    expect(financeRoute).toContain('currency !== PAYOUT_CURRENCY');
    expect(financeRoute).toContain("amount !== availableAfterReservations");
    expect(financeRoute).toContain("BALANCE_CHANGED");
    expect(financeRoute).toContain("findEligibleBankAccount(externalAccounts.data)");
    expect(financeRoute).toContain('method: "standard"');
  });
});