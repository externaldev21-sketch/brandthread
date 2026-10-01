/**
 * Seller statements: shared types plus the small pure helpers the statements
 * screen uses. Money is integer cents end to end (see lib/money.ts).
 */

export interface StatementMonthRow {
  month: string; // YYYY-MM (UTC)
  label: string;
  netCents: number | null;
  payoutsCents: number | null;
  grossSalesCents: number | null;
  transactionCount: number | null;
}

export interface StatementList {
  connected: boolean;
  months: StatementMonthRow[];
}

export interface StatementTotals {
  grossSalesCents: number;
  refundsCents: number;
  disputesCents: number;
  platformFeesCents: number;
  stripeFeesCents: number;
  adjustmentsCents: number;
  payoutsCents: number;
  netCents: number;
  balanceChangeCents: number;
}

export interface StatementDetail {
  period: { month: string; start: string; end: string; label: string };
  currency: string;
  totals: StatementTotals;
  counts: { sales: number; refunds: number; disputes: number; payouts: number; lines: number };
}

export type StatementFormat = 'pdf' | 'csv';

export const STATEMENT_MIME: Record<StatementFormat, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
};

export function statementFileName(month: string, format: StatementFormat): string {
  return `brandthread-statement-${month}.${format}`;
}

export function isStatementMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Signed cents for display: "-$12.00" (never a floating-point dollar value). */
export function formatSignedCents(cents: number): string {
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/** Demo dataset, only ever used when the URL carries &demo=1 in the web preview. */
export function demoStatementList(): StatementList {
  return {
    connected: true,
    months: [
      { month: '2026-09', label: 'September 2026', netCents: 184_250, payoutsCents: -120_000, grossSalesCents: 214_000, transactionCount: 41 },
      { month: '2026-08', label: 'August 2026', netCents: 162_980, payoutsCents: -158_400, grossSalesCents: 190_500, transactionCount: 37 },
      { month: '2026-07', label: 'July 2026', netCents: 97_415, payoutsCents: -97_415, grossSalesCents: 113_900, transactionCount: 22 },
    ],
  };
}

export function demoStatementDetail(month: string): StatementDetail {
  const rows = demoStatementList().months;
  const row = rows.find((m) => m.month === month) ?? rows[0];
  const gross = row.grossSalesCents ?? 0;
  const platform = -Math.round(gross * 0.05);
  const stripe = -Math.round(gross * 0.03);
  const refunds = -Math.round(gross * 0.02);
  const net = gross + platform + stripe + refunds;
  const payouts = row.payoutsCents ?? 0;
  return {
    period: { month: row.month, start: `${row.month}-01T00:00:00.000Z`, end: `${row.month}-28T23:59:59.999Z`, label: row.label },
    currency: 'usd',
    totals: {
      grossSalesCents: gross, refundsCents: refunds, disputesCents: 0, platformFeesCents: platform,
      stripeFeesCents: stripe, adjustmentsCents: 0, payoutsCents: payouts,
      netCents: net, balanceChangeCents: net + payouts,
    },
    counts: { sales: row.transactionCount ?? 0, refunds: 2, disputes: 0, payouts: 2, lines: (row.transactionCount ?? 0) + 4 },
  };
}
