/**
 * GET /api/seller/subscription/invoices row shape: the app labels a bill by
 * Stripe's human invoice number, never the raw `in_…` id.
 */
import { describe, expect, it, vi } from "vitest";

// The route module builds the db client at load (it never connects until a
// query runs); this pure mapper never queries, so any URL will do.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused";
});

import { invoiceSummary } from "../subscription";

const base = {
  id: "in_1PabcDEF",
  created: 1_788_000_000,
  description: null,
  amount_paid: 7900,
  amount_due: 7900,
  currency: "usd",
  status: "paid",
};

describe("invoiceSummary", () => {
  it("passes through Stripe's human invoice number", () => {
    expect(invoiceSummary({ ...base, number: "A1B2C3D4-0001" })).toEqual({
      id: "in_1PabcDEF",
      number: "A1B2C3D4-0001",
      created: new Date(1_788_000_000 * 1000).toISOString(),
      description: "Subscription invoice",
      amountCents: 7900,
      currency: "usd",
      status: "paid",
    });
  });

  it("returns number null for a draft without one", () => {
    expect(invoiceSummary({ ...base, number: null, status: "open", amount_paid: 0 })).toMatchObject({
      number: null,
      amountCents: 7900,
      status: "unpaid",
    });
    expect(invoiceSummary(base).number).toBeNull();
  });
});
