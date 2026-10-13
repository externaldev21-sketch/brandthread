/**
 * Per-payout statement PDF (GET /api/finance/payouts/:id/statement.pdf).
 *
 * Two steps so the numbers are testable without parsing a PDF:
 *  - buildPayoutStatementModel(): the payout header, the breakdown lines
 *    (same buckets and labels as the app's payout detail screen) and the
 *    balance transactions Stripe attributed to the payout;
 *  - renderPayoutStatementPdf(): draws that model with pdfkit in the same
 *    black-on-white Helvetica style as the monthly statement (statementPdf.ts).
 */
import PDFDocument from "pdfkit";
import type { PayoutBreakdown } from "./payoutBreakdown";
import { INK, MUTED, RULE, money } from "./statementPdf";

export type PayoutStatementTxn = {
  id: string;
  /** Unix seconds. */
  created: number;
  type: string;
  description: string | null;
  amount: number;
  fee: number;
  net: number;
  source: string | null;
};

export type PayoutStatementInput = {
  payout: {
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    method: string;
    automatic: boolean;
    arrivalDate: Date;
    created: Date;
    destination: { brand: string | null; last4: string | null } | null;
    instantFeeCents: number | null;
  };
  breakdown: PayoutBreakdown | null;
  transactions: PayoutStatementTxn[];
  /** Stripe charge / transfer id -> Brandthread order number (best effort). */
  orderNumbersBySource?: Map<string, string>;
  /** True when the transaction list hit the page cap. */
  truncated?: boolean;
  storeName?: string;
};

export type PayoutStatementLine = { key: string; label: string; cents: number; strong?: boolean };

export type PayoutStatementModel = {
  currency: string;
  storeName: string | null;
  payoutId: string;
  amountCents: number;
  meta: Array<[label: string, value: string]>;
  summary: PayoutStatementLine[];
  transactions: Array<{ date: string; description: string; amountCents: number; feeCents: number; netCents: number }>;
  notes: string[];
  fileName: string;
};

export function payoutStatusLabel(status: string): string {
  switch (status) {
    case "paid": return "Paid";
    case "in_transit": return "In transit";
    case "pending": return "Pending";
    case "failed": return "Failed";
    case "canceled": return "Canceled";
    default: {
      const s = status.replace(/_/g, " ");
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
  }
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function txnLabel(t: PayoutStatementTxn, orderNumbers: Map<string, string>): string {
  const order = t.source ? orderNumbers.get(t.source) : undefined;
  const base = (t.description ?? "").trim() || t.type.replace(/_/g, " ");
  if (order && !base.includes(order)) return `${order}  ${base}`;
  return base;
}

export function payoutStatementFileName(payoutId: string): string {
  return `brandthread-payout-${payoutId}.pdf`;
}

export function buildPayoutStatementModel(input: PayoutStatementInput): PayoutStatementModel {
  const p = input.payout;
  const orderNumbers = input.orderNumbersBySource ?? new Map<string, string>();
  const failed = p.status === "failed" || p.status === "canceled";
  const arrivalLabel = p.status === "paid" ? "Arrived" : failed ? "Was due" : "Arrives";
  const meta: Array<[string, string]> = [
    ["Payout", p.id],
    ["Status", payoutStatusLabel(p.status)],
    [arrivalLabel, day(p.arrivalDate)],
    ["Initiated", day(p.created)],
  ];
  if (p.destination?.last4) {
    meta.push([p.method === "instant" ? "Debit card" : "Bank account", `${p.destination.brand ? `${p.destination.brand} ` : ""}****${p.destination.last4}`]);
  }

  const summary: PayoutStatementLine[] = [];
  const notes: string[] = [];
  const b = input.breakdown;
  if (b) {
    const l = b.lines;
    const all: PayoutStatementLine[] = [
      { key: "sales", label: "Sales", cents: l.sales },
      { key: "platformFee", label: "Platform fee", cents: l.platformFee },
      { key: "stripeFee", label: "Stripe fee", cents: l.stripeFee },
      { key: "refunds", label: "Refunds", cents: l.refunds },
      { key: "disputes", label: "Disputes", cents: l.disputes },
      { key: "holds", label: "Holds", cents: l.holds },
      { key: "adjustments", label: "Adjustments", cents: l.adjustments },
    ];
    // Same rule as the app: sales and both fees always, the rest when non-zero.
    summary.push(...all.filter((x) => ["sales", "platformFee", "stripeFee"].includes(x.key) || x.cents !== 0));
    summary.push({ key: "net", label: "Net payout", cents: b.payoutCents, strong: true });
    if (input.truncated) notes.push("Only the first transactions Stripe attributed to this payout are listed; the difference is shown as Adjustments.");
  } else {
    summary.push({ key: "net", label: "Payout amount", cents: p.amountCents, strong: true });
    notes.push("This was a manual payout. It draws from your whole balance, so individual sales are not listed.");
  }
  if (p.instantFeeCents && p.instantFeeCents > 0) summary.push({ key: "instantFee", label: "Instant fee", cents: -p.instantFeeCents });

  const transactions = [...input.transactions]
    .sort((a, b2) => a.created - b2.created || a.id.localeCompare(b2.id))
    .map((t) => ({
      date: day(new Date(t.created * 1000)),
      description: txnLabel(t, orderNumbers),
      amountCents: t.amount,
      feeCents: -t.fee || 0,
      netCents: t.net,
    }));

  return {
    currency: p.currency,
    storeName: input.storeName?.trim() || null,
    payoutId: p.id,
    amountCents: p.amountCents,
    meta,
    summary,
    transactions,
    notes,
    fileName: payoutStatementFileName(p.id),
  };
}

export function renderPayoutStatementPdf(m: PayoutStatementModel, opts: { generatedAt?: Date } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48, bufferPages: true, info: { Title: `Brandthread payout ${m.payoutId}`, Author: "Brandthread" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = 48;
    const R = doc.page.width - 48;
    const W = R - L;
    const bottomLimit = () => doc.page.height - 72;
    const cur = m.currency;
    const rule = (y = doc.y) => doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(RULE).stroke();

    doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text("Brandthread", L, 48, { lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED)
      .text("Payout statement", L, 52, { width: W, align: "right", lineBreak: false });
    doc.y = 84;
    rule();
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(`${money(m.amountCents, cur)} payout`, L);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    if (m.storeName) doc.text(m.storeName, L);
    doc.text(`Currency ${cur.toUpperCase()}`, L);
    doc.moveDown(0.8);

    for (const [label, value] of m.meta) {
      const y = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(label, L, y, { width: W / 2, lineBreak: false });
      doc.fillColor(INK).text(value, L + W / 2, y, { width: W / 2, align: "right", lineBreak: false });
      doc.y = y + 16;
    }
    doc.moveDown(1);

    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Breakdown", L);
    doc.moveDown(0.4);
    for (const line of m.summary) {
      const y = doc.y;
      if (line.strong) rule(y - 3);
      doc.font(line.strong ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK)
        .text(line.label, L, y, { width: W / 2, lineBreak: false })
        .text(money(line.cents, cur), L + W / 2, y, { width: W / 2, align: "right", lineBreak: false });
      doc.y = y + 16;
    }
    for (const note of m.notes) {
      doc.moveDown(0.4);
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(note, L, doc.y, { width: W });
    }
    doc.moveDown(1.2);

    if (m.transactions.length > 0) {
      const cols = [
        { label: "Date", x: L, w: 58, align: "left" as const },
        { label: "Description", x: L + 62, w: 196, align: "left" as const },
        { label: "Amount", x: L + 262, w: 68, align: "right" as const },
        { label: "Fees", x: L + 334, w: 64, align: "right" as const },
        { label: "Net", x: L + 402, w: W - 402, align: "right" as const },
      ];
      const header = () => {
        const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
        for (const c of cols) doc.text(c.label.toUpperCase(), c.x, y, { width: c.w, align: c.align, lineBreak: false });
        doc.y = y + 13;
        rule(doc.y - 2);
      };
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(`Transactions (${m.transactions.length})`, L);
      doc.moveDown(0.4);
      header();
      for (const t of m.transactions) {
        doc.font("Helvetica").fontSize(8.5);
        const h = Math.max(13, doc.heightOfString(t.description, { width: cols[1].w }) + 4);
        if (doc.y + h > bottomLimit()) {
          doc.addPage();
          doc.y = 48;
          header();
        }
        const y = doc.y;
        doc.font("Helvetica").fontSize(8.5).fillColor(INK);
        doc.text(t.date, cols[0].x, y, { width: cols[0].w, lineBreak: false });
        doc.text(t.description, cols[1].x, y, { width: cols[1].w });
        doc.text(money(t.amountCents, cur), cols[2].x, y, { width: cols[2].w, align: "right", lineBreak: false });
        doc.text(money(t.feeCents, cur), cols[3].x, y, { width: cols[3].w, align: "right", lineBreak: false });
        doc.text(money(t.netCents, cur), cols[4].x, y, { width: cols[4].w, align: "right", lineBreak: false });
        doc.y = y + h;
        rule(doc.y - 2);
      }
    }

    const range = doc.bufferedPageRange();
    const generated = (opts.generatedAt ?? new Date()).toISOString().slice(0, 10);
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(8).fillColor(MUTED);
      const y = doc.page.height - 40;
      doc.text(`Generated ${generated} | brandthread-payout-${m.payoutId}`, L, y, { width: W / 2 + 60, lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, L + W / 2, y, { width: W / 2, align: "right", lineBreak: false });
    }
    doc.end();
  });
}
