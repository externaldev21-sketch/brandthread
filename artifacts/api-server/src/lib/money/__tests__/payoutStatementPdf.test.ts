import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPayoutBreakdown } from "../payoutBreakdown";
import {
  buildPayoutStatementModel, renderPayoutStatementPdf, type PayoutStatementInput,
} from "../payoutStatementPdf";

const txns = [
  {
    id: "txn_a", created: 1_789_800_000, type: "payment", reporting_category: "charge",
    amount: 10_000, fee: 820, net: 9_180, source: "py_a", description: null,
    fee_details: [{ type: "application_fee", amount: 500 }, { type: "stripe_fee", amount: 320 }],
  },
  {
    id: "txn_b", created: 1_789_700_000, type: "refund", reporting_category: "refund",
    amount: -2_000, fee: 0, net: -2_000, source: "re_b", description: "REFUND FOR CHARGE",
    fee_details: [],
  },
];

function input(extra: Partial<PayoutStatementInput> = {}): PayoutStatementInput {
  return {
    payout: {
      id: "po_test123", amountCents: 7_180, currency: "usd", status: "paid", method: "standard", automatic: true,
      arrivalDate: new Date("2026-09-28T00:00:00Z"), created: new Date("2026-09-25T00:00:00Z"),
      destination: { brand: "Chase", last4: "6789" }, instantFeeCents: null,
    },
    breakdown: buildPayoutBreakdown({ payoutAmountCents: 7_180, transactions: txns }),
    transactions: txns.map((t) => ({ id: t.id, created: t.created, type: t.type, description: t.description, amount: t.amount, fee: t.fee, net: t.net, source: t.source })),
    orderNumbersBySource: new Map([["py_a", "BT-1001"]]),
    storeName: "Acme Studio",
    ...extra,
  };
}

describe("buildPayoutStatementModel", () => {
  it("lists the breakdown with the same labels as the app and adds up to the payout", () => {
    const m = buildPayoutStatementModel(input());
    expect(m.summary.map((l) => [l.label, l.cents])).toEqual([
      ["Sales", 10_000], ["Platform fee", -500], ["Stripe fee", -320], ["Refunds", -2_000], ["Net payout", 7_180],
    ]);
    const lines = m.summary.filter((l) => l.key !== "net").reduce((s, l) => s + l.cents, 0);
    expect(lines).toBe(7_180);
    expect(m.meta).toEqual([
      ["Payout", "po_test123"], ["Status", "Paid"], ["Arrived", "2026-09-28"], ["Initiated", "2026-09-25"],
      ["Bank account", "Chase ****6789"],
    ]);
    expect(m.storeName).toBe("Acme Studio");
    expect(m.fileName).toBe("brandthread-payout-po_test123.pdf");
  });

  it("lists transactions oldest first with order numbers when known", () => {
    const m = buildPayoutStatementModel(input());
    expect(m.transactions).toEqual([
      { date: "2026-09-18", description: "REFUND FOR CHARGE", amountCents: -2_000, feeCents: 0, netCents: -2_000 },
      { date: "2026-09-19", description: "BT-1001  payment", amountCents: 10_000, feeCents: -820, netCents: 9_180 },
    ]);
  });

  it("does not invent a breakdown for a manual payout", () => {
    const m = buildPayoutStatementModel(input({
      breakdown: null, transactions: [],
      payout: { ...input().payout, automatic: false, method: "instant", status: "in_transit", instantFeeCents: 99 },
    }));
    expect(m.summary).toEqual([
      { key: "net", label: "Payout amount", cents: 7_180, strong: true },
      { key: "instantFee", label: "Instant fee", cents: -99 },
    ]);
    expect(m.meta).toContainEqual(["Arrives", "2026-09-28"]);
    expect(m.meta).toContainEqual(["Debit card", "Chase ****6789"]);
    expect(m.notes[0]).toMatch(/manual payout/);
  });
});

describe("renderPayoutStatementPdf", () => {
  it("renders a PDF that contains the payout and its amounts", async () => {
    const pdf = await renderPayoutStatementPdf(buildPayoutStatementModel(input()), { generatedAt: new Date("2026-10-01T00:00:00Z") });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    let text: string | null = null;
    try {
      const dir = mkdtempSync(join(tmpdir(), "payout-pdf-"));
      const file = join(dir, "p.pdf");
      writeFileSync(file, pdf);
      text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
    } catch { /* pdftotext (poppler) not installed: header check above still runs */ }
    if (text !== null) {
      for (const s of ["Payout statement", "$71.80 payout", "Acme Studio", "po_test123", "Chase ****6789", "Sales", "$100.00", "-$5.00", "-$3.20", "-$20.00", "Net payout", "BT-1001", "Page 1 of 1"]) {
        expect(text).toContain(s);
      }
    }
  });

  it("paginates long transaction lists", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      id: `txn_${i}`, created: 1_789_800_000 + i, type: "payment", description: `Sale ${i}`, amount: 1_000, fee: 0, net: 1_000, source: null,
    }));
    const pdf = await renderPayoutStatementPdf(buildPayoutStatementModel(input({ transactions: many })));
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
});
