import { describe, expect, it } from "vitest";
import {
  FEDERAL_1099K_GROSS_THRESHOLD_CENTS,
  FEDERAL_1099K_TRANSACTION_THRESHOLD,
  federal1099KProgress,
} from "./sellerTaxLedger";

describe("federal 1099-K threshold progress", () => {
  it("does not mark the exact statutory boundaries as exceeded", () => {
    expect(federal1099KProgress(
      2026,
      FEDERAL_1099K_GROSS_THRESHOLD_CENTS,
      FEDERAL_1099K_TRANSACTION_THRESHOLD,
    )).toMatchObject({
      exceedsGrossPaymentThreshold: false,
      exceedsTransactionThreshold: false,
      meetsFederalThreshold: false,
      grossPaymentProgress: 1,
      transactionProgress: 1,
    });
  });

  it("requires both gross volume and transaction count to be strictly greater", () => {
    expect(federal1099KProgress(
      2026,
      FEDERAL_1099K_GROSS_THRESHOLD_CENTS + 1,
      FEDERAL_1099K_TRANSACTION_THRESHOLD,
    ).meetsFederalThreshold).toBe(false);
    expect(federal1099KProgress(
      2026,
      FEDERAL_1099K_GROSS_THRESHOLD_CENTS,
      FEDERAL_1099K_TRANSACTION_THRESHOLD + 1,
    ).meetsFederalThreshold).toBe(false);
    expect(federal1099KProgress(
      2026,
      FEDERAL_1099K_GROSS_THRESHOLD_CENTS + 1,
      FEDERAL_1099K_TRANSACTION_THRESHOLD + 1,
    ).meetsFederalThreshold).toBe(true);
  });

  it("uses the 2024 transitional gross-only threshold", () => {
    expect(federal1099KProgress(2024, 500_000, 1)).toMatchObject({
      rule: "2024_TRANSITION_5000_GROSS",
      transactionThreshold: null,
      exceedsGrossPaymentThreshold: false,
      meetsFederalThreshold: false,
    });
    expect(federal1099KProgress(2024, 500_001, 1)).toMatchObject({
      exceedsGrossPaymentThreshold: true,
      exceedsTransactionThreshold: true,
      meetsFederalThreshold: true,
    });
  });

  it("uses the restored federal rule for 2025 onward", () => {
    expect(federal1099KProgress(2025, 2_000_001, 200).meetsFederalThreshold).toBe(false);
    expect(federal1099KProgress(2025, 2_000_001, 201)).toMatchObject({
      rule: "RESTORED_20000_AND_200",
      meetsFederalThreshold: true,
    });
  });
});