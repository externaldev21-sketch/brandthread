/**
 * Monthly seller statement builder (pure, integer cents, no I/O).
 *
 * SOURCE OF TRUTH: the seller's Stripe Connect balance transactions for the
 * UTC month (created >= monthStart, < nextMonthStart). Every balance
 * transaction is one row that moves the seller's balance, so the statement
 * reconciles to Stripe by construction: the sum of `net` over all rows equals
 *   grossSales + refunds + disputes + platformFees + stripeFees + adjustments + payouts.
 * The builder asserts that identity and throws StatementReconciliationError
 * if it ever fails. Orders are only used (optionally) to label rows with an
 * order number; they never contribute to totals.
 *
 * Sign convention: every total is the signed effect on the seller's balance.
 * grossSales is positive; refunds, disputes (net of reversals), platformFees,
 * stripeFees and payouts are normally negative. `netCents` (net earnings)
 * excludes payouts; `balanceChangeCents` includes them.
 *
 * Opening/closing balances are NOT derivable from balance transactions alone
 * (Stripe does not expose running balances), so they are null unless the
 * caller injects `closingBalanceCents`, in which case opening = closing -
 * balanceChange.
 */

export type StatementTxn = {
  id: string;
  /** Unix seconds. */
  created: number;
  type: string;
  reportingCategory: string | null;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  description: string | null;
  source: string | null;
  feeDetails?: { type: string; amount: number }[] | null;
};

export type StatementCategory =
  | "sale" | "refund" | "dispute" | "platform_fee" | "stripe_fee" | "adjustment" | "payout";

export type StatementLine = {
  id: string;
  date: string; // ISO
  type: string;
  category: StatementCategory;
  description: string;
  orderNumber: string | null;
  amountCents: number;
  /** Fee magnitudes (positive = charged to the seller). */
  platformFeeCents: number;
  stripeFeeCents: number;
  netCents: number;
};

export type StatementTotals = {
  grossSalesCents: number;
  refundsCents: number;
  disputesCents: number;
  platformFeesCents: number;
  stripeFeesCents: number;
  adjustmentsCents: number;
  payoutsCents: number;
  /** Net earnings: everything except payouts. */
  netCents: number;
  /** Net earnings plus payouts: the change in the Stripe balance. */
  balanceChangeCents: number;
};

export type Statement = {
  period: { month: string; start: string; end: string; label: string };
  currency: string;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  totals: StatementTotals;
  counts: { sales: number; refunds: number; disputes: number; payouts: number; lines: number };
  lines: StatementLine[];
};

export class StatementError extends Error {
  constructor(message: string, readonly code: "INVALID_MONTH" | "FUTURE_MONTH") {
    super(message);
    this.name = "StatementError";
  }
}
export class StatementReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementReconciliationError";
  }
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseMonth(input: unknown, now: Date = new Date()): { month: string; start: Date; end: Date } {
  if (typeof input !== "string") throw new StatementError("Month must be YYYY-MM", "INVALID_MONTH");
  const m = MONTH_RE.exec(input);
  if (!m) throw new StatementError("Month must be YYYY-MM", "INVALID_MONTH");
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (year < 2000) throw new StatementError("Month must be YYYY-MM", "INVALID_MONTH");
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  if (start.getTime() > now.getTime()) throw new StatementError("Month is in the future", "FUTURE_MONTH");
  return { month: input, start, end };
}

/** Months from `first` through `now` inclusive (UTC), newest first. */
export function monthsBetween(first: Date, now: Date = new Date()): string[] {
  const out: string[] = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  const fy = first.getUTCFullYear();
  const fm = first.getUTCMonth();
  while ((y > fy || (y === fy && m >= fm)) && out.length < 600) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  return out;
}

export function monthLabel(month: string): string {
  const { start } = parseMonth(month, new Date(8.64e15));
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
}

export function classify(t: Pick<StatementTxn, "type" | "reportingCategory">): StatementCategory {
  const c = t.reportingCategory ?? "";
  const ty = t.type;
  if (c === "charge" || ty === "charge" || ty === "payment") return "sale";
  if (c === "refund" || c === "refund_failure" || ty === "refund" || ty === "payment_refund" || ty === "payment_failure_refund") return "refund";
  if (c.startsWith("dispute") || ty === "dispute" || ty === "dispute_reversal") return "dispute";
  if (c === "payout" || c === "payout_reversal" || ty === "payout" || ty === "payout_cancel" || ty === "payout_failure") return "payout";
  if (c === "application_fee" || c === "application_fee_refund" || ty === "application_fee" || ty === "application_fee_refund") return "platform_fee";
  if (c === "fee" || ty === "stripe_fee") return "stripe_fee";
  return "adjustment";
}

function assertInt(n: unknown, label: string): number {
  if (typeof n !== "number" || !Number.isSafeInteger(n)) {
    throw new StatementReconciliationError(`${label} is not an integer cent amount`);
  }
  return n;
}

/** Splits a transaction fee into platform (application) fee and Stripe fee. */
function splitFee(t: StatementTxn): { platform: number; stripe: number } {
  const fee = assertInt(t.fee, "fee");
  let platform = 0;
  for (const d of t.feeDetails ?? []) {
    if (d.type === "application_fee") platform += assertInt(d.amount, "fee detail");
  }
  if (platform > fee && fee >= 0) platform = fee;
  return { platform, stripe: fee - platform };
}

export type BuildStatementInput = {
  month: string;
  now?: Date;
  transactions: StatementTxn[];
  currency?: string;
  /** Optional map of Stripe source id (ch_/tr_/py_) to order number. */
  orderNumbersBySource?: Map<string, string> | Record<string, string>;
  closingBalanceCents?: number | null;
};

export function buildStatement(input: BuildStatementInput): Statement {
  const { month, start, end } = parseMonth(input.month, input.now);
  const startS = start.getTime() / 1000;
  const endS = end.getTime() / 1000;
  const lookup = (s: string | null): string | null => {
    if (!s || !input.orderNumbersBySource) return null;
    const m = input.orderNumbersBySource;
    return (m instanceof Map ? m.get(s) : m[s]) ?? null;
  };

  const totals: StatementTotals = {
    grossSalesCents: 0, refundsCents: 0, disputesCents: 0, platformFeesCents: 0,
    stripeFeesCents: 0, adjustmentsCents: 0, payoutsCents: 0, netCents: 0, balanceChangeCents: 0,
  };
  const counts = { sales: 0, refunds: 0, disputes: 0, payouts: 0, lines: 0 };
  const lines: StatementLine[] = [];
  let txnNetSum = 0;
  const seen = new Set<string>();
  const currency = (input.currency ?? input.transactions[0]?.currency ?? "usd").toLowerCase();

  const sorted = [...input.transactions].sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  for (const t of sorted) {
    if (t.created < startS || t.created >= endS) continue; // period is exact
    if (seen.has(t.id)) continue; // pagination overlap guard
    seen.add(t.id);
    if (t.currency.toLowerCase() !== currency) continue; // single-currency statement
    const amount = assertInt(t.amount, "amount");
    const net = assertInt(t.net, "net");
    const { platform, stripe } = splitFee(t);
    if (amount - platform - stripe !== net) {
      throw new StatementReconciliationError(`Transaction ${t.id}: amount - fee != net`);
    }
    const category = classify(t);
    txnNetSum += net;
    totals.platformFeesCents -= platform;
    totals.stripeFeesCents -= stripe;
    switch (category) {
      case "sale": totals.grossSalesCents += amount; counts.sales++; break;
      case "refund": totals.refundsCents += amount; counts.refunds++; break;
      case "dispute": totals.disputesCents += amount; counts.disputes++; break;
      case "payout": totals.payoutsCents += amount; counts.payouts++; break;
      case "platform_fee": totals.platformFeesCents += amount; break;
      case "stripe_fee": totals.stripeFeesCents += amount; break;
      default: totals.adjustmentsCents += amount;
    }
    lines.push({
      id: t.id,
      date: new Date(t.created * 1000).toISOString(),
      type: t.reportingCategory ?? t.type,
      category,
      description: t.description ?? "",
      orderNumber: lookup(t.source),
      amountCents: amount,
      platformFeeCents: platform,
      stripeFeeCents: stripe,
      netCents: net,
    });
  }
  counts.lines = lines.length;
  totals.netCents =
    totals.grossSalesCents + totals.refundsCents + totals.disputesCents +
    totals.platformFeesCents + totals.stripeFeesCents + totals.adjustmentsCents;
  totals.balanceChangeCents = totals.netCents + totals.payoutsCents;

  if (totals.balanceChangeCents !== txnNetSum) {
    throw new StatementReconciliationError(
      `Statement ${month} does not reconcile: components ${totals.balanceChangeCents} != transactions ${txnNetSum}`,
    );
  }

  const closing = input.closingBalanceCents ?? null;
  return {
    period: {
      month,
      start: start.toISOString(),
      end: new Date(end.getTime() - 1).toISOString(),
      label: monthLabel(month),
    },
    currency,
    openingBalanceCents: closing === null ? null : closing - totals.balanceChangeCents,
    closingBalanceCents: closing,
    totals,
    counts,
    lines,
  };
}

/* ─── CSV (RFC 4180, formula-injection safe) ─────────────────────────────── */

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  let s = value;
  // OWASP CSV injection: neutralise leading formula triggers (incl. tab/CR).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Numeric cells come from centsToDecimal (never user text), so they bypass the injection prefix. */
export function statementToCsv(s: Statement): string {
  const rows: string[] = [];
  const raw = (c: number) => ({ raw: centsToDecimal(c) });
  type Cell = string | number | null | { raw: string };
  const out = (cells: Cell[]) =>
    rows.push(cells.map((c) => (c !== null && typeof c === "object" ? c.raw : csvCell(c))).join(","));
  const cur = s.currency.toUpperCase();
  out(["Brandthread seller statement", s.period.label]);
  out(["Period start", s.period.start.slice(0, 10)]);
  out(["Period end", s.period.end.slice(0, 10)]);
  out(["Currency", cur]);
  out([]);
  out(["Summary", "Amount"]);
  out(["Gross sales", raw(s.totals.grossSalesCents)]);
  out(["Refunds", raw(s.totals.refundsCents)]);
  out(["Disputes", raw(s.totals.disputesCents)]);
  out(["Platform fees", raw(s.totals.platformFeesCents)]);
  out(["Stripe fees", raw(s.totals.stripeFeesCents)]);
  out(["Adjustments", raw(s.totals.adjustmentsCents)]);
  out(["Net earnings", raw(s.totals.netCents)]);
  out(["Payouts", raw(s.totals.payoutsCents)]);
  out(["Balance change", raw(s.totals.balanceChangeCents)]);
  if (s.openingBalanceCents !== null) out(["Opening balance", raw(s.openingBalanceCents)]);
  if (s.closingBalanceCents !== null) out(["Closing balance", raw(s.closingBalanceCents)]);
  out([]);
  out(["Date", "Category", "Type", "Order", "Description", "Amount", "Platform fee", "Stripe fee", "Net", "Currency", "Transaction ID"]);
  for (const l of s.lines) {
    out([
      l.date, l.category, l.type, l.orderNumber ?? "", l.description,
      raw(l.amountCents), raw(-l.platformFeeCents), raw(-l.stripeFeeCents), raw(l.netCents), cur, l.id,
    ]);
  }
  return rows.join("\r\n") + "\r\n";
}
