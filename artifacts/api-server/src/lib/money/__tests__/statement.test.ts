import { describe, expect, it } from "vitest";
import {
  buildStatement, centsToDecimal, classify, csvCell, monthsBetween, parseMonth, statementToCsv,
  StatementError, StatementReconciliationError, type StatementTxn,
} from "../statement";
import { renderStatementPdf } from "../statementPdf";

const NOW = new Date("2026-09-30T12:00:00Z");
const ts = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function txn(p: Omit<Partial<StatementTxn>, "created"> & { id: string; created: string; type: string; amount: number; fee?: number }): StatementTxn {
  const fee = p.fee ?? 0;
  return {
    reportingCategory: p.type, currency: "usd", description: null, source: null,
    ...p, created: ts(p.created), fee, net: p.amount - fee,
  } as StatementTxn;
}

const sample: StatementTxn[] = [
  txn({ id: "txn_1", created: "2026-08-03T10:00:00Z", type: "charge", amount: 10_000, fee: 500, source: "ch_1",
        feeDetails: [{ type: "application_fee", amount: 500 }] }),
  txn({ id: "txn_2", created: "2026-08-10T10:00:00Z", type: "charge", amount: 2_501, fee: 103,
        feeDetails: [{ type: "stripe_fee", amount: 103 }] }),
  txn({ id: "txn_3", created: "2026-08-12T10:00:00Z", type: "refund", amount: -2_501 }),
  txn({ id: "txn_4", created: "2026-08-15T10:00:00Z", type: "dispute", amount: -4_000, fee: 1_500 }),
  txn({ id: "txn_5", created: "2026-08-20T10:00:00Z", type: "adjustment", reportingCategory: "other_adjustment", amount: 250 }),
  txn({ id: "txn_6", created: "2026-08-31T23:59:59Z", type: "payout", amount: -3_000 }),
  txn({ id: "txn_out", created: "2026-09-01T00:00:00Z", type: "charge", amount: 999 }), // next month
  txn({ id: "txn_before", created: "2026-07-31T23:59:59Z", type: "charge", amount: 999 }),
];

describe("parseMonth", () => {
  it.each<string>(["2026-13", "2026-00", "26-08", "2026-8", "2026-08-01", "", "abc", "1999-12"])("rejects %s", (m) => {
    expect(() => parseMonth(m, NOW)).toThrow(StatementError);
  });
  it("rejects non-strings and future months, accepts current month", () => {
    expect(() => parseMonth(undefined, NOW)).toThrow(/YYYY-MM/);
    expect(() => parseMonth("2026-10", NOW)).toThrow(/future/);
    expect(parseMonth("2026-09", NOW).start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(parseMonth("2026-12", new Date("2026-12-31T23:59:59Z")).end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("monthsBetween", () => {
  it("lists months newest first across a year boundary", () => {
    expect(monthsBetween(new Date("2025-11-15T00:00:00Z"), new Date("2026-02-01T00:00:00Z")))
      .toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });
});

describe("buildStatement", () => {
  const s = buildStatement({ month: "2026-08", now: NOW, transactions: sample });

  it("excludes transactions outside the UTC month (inclusive start, exclusive end)", () => {
    expect(s.lines.map((l) => l.id)).toEqual(["txn_1", "txn_2", "txn_3", "txn_4", "txn_5", "txn_6"]);
    expect(s.period.label).toBe("August 2026");
  });

  it("computes each total in integer cents", () => {
    expect(s.totals).toEqual({
      grossSalesCents: 12_501,
      refundsCents: -2_501,
      disputesCents: -4_000,
      platformFeesCents: -500,
      stripeFeesCents: -103 - 1_500,
      adjustmentsCents: 250,
      payoutsCents: -3_000,
      netCents: 12_501 - 2_501 - 4_000 - 500 - 1_603 + 250,
      balanceChangeCents: 12_501 - 2_501 - 4_000 - 500 - 1_603 + 250 - 3_000,
    });
    expect(s.counts).toEqual({ sales: 2, refunds: 1, disputes: 1, payouts: 1, lines: 6 });
  });

  it("reconciles to the sum of Stripe net amounts", () => {
    const netSum = s.lines.reduce((a, l) => a + l.netCents, 0);
    expect(s.totals.balanceChangeCents).toBe(netSum);
    expect(s.openingBalanceCents).toBeNull();
  });

  it("derives opening balance only when a closing balance is supplied", () => {
    const c = buildStatement({ month: "2026-08", now: NOW, transactions: sample, closingBalanceCents: 10_000 });
    expect(c.openingBalanceCents).toBe(10_000 - c.totals.balanceChangeCents);
  });

  it("is empty but valid with no activity", () => {
    const e = buildStatement({ month: "2026-01", now: NOW, transactions: [] });
    expect(e.lines).toEqual([]);
    expect(e.totals.netCents).toBe(0);
  });

  it("ignores duplicate ids from overlapping pages and labels orders", () => {
    const d = buildStatement({
      month: "2026-08", now: NOW, transactions: [...sample, sample[0]],
      orderNumbersBySource: new Map([["ch_1", "BT-1001"]]),
    });
    expect(d.counts.sales).toBe(2);
    expect(d.lines[0].orderNumber).toBe("BT-1001");
  });

  it("throws when amounts are not integer cents or net does not match", () => {
    expect(() => buildStatement({ month: "2026-08", now: NOW, transactions: [{ ...sample[0], amount: 10.5 }] }))
      .toThrow(StatementReconciliationError);
    expect(() => buildStatement({ month: "2026-08", now: NOW, transactions: [{ ...sample[0], net: 1 }] }))
      .toThrow(/amount - fee != net/);
  });

  it("classifies categories", () => {
    expect(classify({ type: "payment", reportingCategory: "charge" })).toBe("sale");
    expect(classify({ type: "adjustment", reportingCategory: "dispute_reversal" })).toBe("dispute");
    expect(classify({ type: "transfer", reportingCategory: "transfer" })).toBe("adjustment");
    expect(classify({ type: "application_fee", reportingCategory: "application_fee" })).toBe("platform_fee");
  });
});

describe("CSV", () => {
  it.each<[string, string]>([
    ["=SUM(A1)", "'=SUM(A1)"],
    ["+1", "'+1"],
    ["-2", "'-2"],
    ["@cmd", "'@cmd"],
    ["\tx", "'\tx"],
    ["plain", "plain"],
    ['say "hi"', '"say ""hi"""'],
    ["a,b", '"a,b"'],
    ["line\nbreak", '"line\nbreak"'],
    ["=1,2", `"'=1,2"`],
  ])("escapes %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("formats cents without floating point", () => {
    expect(centsToDecimal(-5)).toBe("-0.05");
    expect(centsToDecimal(123_456)).toBe("1234.56");
    expect(centsToDecimal(0)).toBe("0.00");
  });

  it("neutralises hostile descriptions and uses CRLF rows", () => {
    const hostile = buildStatement({
      month: "2026-08", now: NOW,
      transactions: [txn({ id: "txn_x", created: "2026-08-02T00:00:00Z", type: "charge", amount: 100, description: '=HYPERLINK("http://evil")' })],
    });
    const csv = statementToCsv(hostile);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv.split("\r\n").length).toBeGreaterThan(10);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).toContain("Gross sales,1.00");
  });
});

describe("PDF", () => {
  it("renders a multi-page PDF", async () => {
    const many: StatementTxn[] = Array.from({ length: 120 }, (_, i) =>
      txn({ id: `txn_${i}`, created: "2026-08-05T10:00:00Z", type: "charge", amount: 1_000 + i, fee: 50, description: `Order ${i}` }));
    const pdf = await renderStatementPdf(buildStatement({ month: "2026-08", now: NOW, transactions: many }), { sellerName: "Acme" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2_000);
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
});
