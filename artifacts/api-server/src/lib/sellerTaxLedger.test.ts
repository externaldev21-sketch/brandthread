import { describe, expect, it } from "vitest";
import {
  FEDERAL_1099K_GROSS_THRESHOLD_CENTS,
  FEDERAL_1099K_TRANSACTION_THRESHOLD,
  federal1099KProgress,
} from "./sellerTaxLedger";

describe("federal 1099-K threshold progress", () => {
  it("uses the pre-2024 $20,000 and 200-transaction rule", () => {
    expect(federal1099KProgress(2023, 2_000_000, 200)).toMatchObject({
      rule: "PRE_2024_20000_AND_200",
      exceedsGrossPaymentThreshold: false,
      exceedsTransactionThreshold: false,
      meetsFederalThreshold: false,
    });
    expect(federal1099KProgress(2023, 2_000_001, 201)).toMatchObject({
      exceedsGrossPaymentThreshold: true,
      exceedsTransactionThreshold: true,
      meetsFederalThreshold: true,
    });
  });

  it("does not mark the exact 2026 gross-only boundary as exceeded", () => {
    expect(federal1099KProgress(
      2026,
      FEDERAL_1099K_GROSS_THRESHOLD_CENTS,
      1,
    )).toMatchObject({
      exceedsGrossPaymentThreshold: false,
      exceedsTransactionThreshold: true,
      meetsFederalThreshold: false,
      grossPaymentProgress: 1,
      transactionProgress: null,
    });
  });

  it("uses a gross-only threshold from 2026", () => {
    expect(federal1099KProgress(
      2026,
      FEDERAL_1099K_GROSS_THRESHOLD_CENTS + 1,
      1,
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

  it("uses the 2025 $2,500 gross-only transition threshold", () => {
    expect(federal1099KProgress(2025, 250_000, 200).meetsFederalThreshold).toBe(false);
    expect(federal1099KProgress(2025, 250_001, 1)).toMatchObject({
      rule: "2025_TRANSITION_2500_GROSS",
      transactionThreshold: null,
      meetsFederalThreshold: true,
    });
  });
});