/**
 * Server-side PDF for a seller statement. Uses pdfkit (already a dependency,
 * see routes/techpack.ts) with the built-in Helvetica, black on white.
 */
import PDFDocument from "pdfkit";
import type { Statement } from "./statement";

function money(cents: number, currency: string): string {
  const sym = currency.toLowerCase() === "usd" ? "$" : "";
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `${sym}${whole}.${String(abs % 100).padStart(2, "0")}`;
  const cur = sym ? "" : ` ${currency.toUpperCase()}`;
  return `${cents < 0 ? "-" : ""}${body}${cur}`;
}

const INK = "#000000";
const MUTED = "#6b6b6b";
const RULE = "#cfcfcf";

export function renderStatementPdf(s: Statement, opts: { sellerName?: string; generatedAt?: Date } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48, bufferPages: true, info: { Title: `Brandthread statement ${s.period.month}`, Author: "Brandthread" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = 48;
    const R = doc.page.width - 48;
    const W = R - L;
    const bottomLimit = () => doc.page.height - 72;
    const cur = s.currency;

    const rule = (y = doc.y) => doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(RULE).stroke();

    doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text("Brandthread", L, 48, { lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED)
      .text("Seller statement", L, 52, { width: W, align: "right", lineBreak: false });
    doc.y = 84;
    rule();
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(s.period.label, L);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    if (opts.sellerName) doc.text(opts.sellerName, L);
    doc.text(`${s.period.start.slice(0, 10)} to ${s.period.end.slice(0, 10)} (UTC)   |   Currency ${cur.toUpperCase()}`, L);
    doc.moveDown(1);

    // Summary table
    const t = s.totals;
    const summary: [string, number, boolean?][] = [
      ["Gross sales", t.grossSalesCents],
      ["Refunds", t.refundsCents],
      ["Disputes", t.disputesCents],
      ["Platform fees", t.platformFeesCents],
      ["Stripe fees", t.stripeFeesCents],
      ["Adjustments", t.adjustmentsCents],
      ["Net earnings", t.netCents, true],
      ["Payouts", t.payoutsCents],
      ["Balance change", t.balanceChangeCents, true],
    ];
    if (s.openingBalanceCents !== null) summary.push(["Opening balance", s.openingBalanceCents]);
    if (s.closingBalanceCents !== null) summary.push(["Closing balance", s.closingBalanceCents]);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Summary", L);
    doc.moveDown(0.4);
    for (const [label, cents, bold] of summary) {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK)
        .text(label, L, y, { width: W / 2, lineBreak: false })
        .text(money(cents, cur), L + W / 2, y, { width: W / 2, align: "right", lineBreak: false });
      doc.y = y + 16;
      if (bold) rule(doc.y - 3);
    }
    doc.moveDown(1.2);

    // Transactions table
    const cols = [
      { key: "date", label: "Date", x: L, w: 58, align: "left" as const },
      { key: "desc", label: "Description", x: L + 62, w: 196, align: "left" as const },
      { key: "amt", label: "Amount", x: L + 262, w: 68, align: "right" as const },
      { key: "fee", label: "Fees", x: L + 334, w: 64, align: "right" as const },
      { key: "net", label: "Net", x: L + 402, w: W - 402, align: "right" as const },
    ];
    const header = () => {
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
      for (const c of cols) doc.text(c.label.toUpperCase(), c.x, y, { width: c.w, align: c.align, lineBreak: false });
      doc.y = y + 13;
      rule(doc.y - 2);
    };
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(`Transactions (${s.counts.lines})`, L);
    doc.moveDown(0.4);
    header();
    if (s.lines.length === 0) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("No activity this month.", L, doc.y + 4);
    }
    for (const l of s.lines) {
      const label = l.orderNumber && !l.description.includes(l.orderNumber) ? `${l.orderNumber}  ${l.description}`.trim() : (l.description || l.orderNumber || l.type);
      const prefix = `${l.category === "sale" ? "" : `${l.category.replace("_", " ")}: `}`;
      const text = `${prefix}${label}`;
      doc.font("Helvetica").fontSize(8.5);
      const h = Math.max(13, doc.heightOfString(text, { width: cols[1].w }) + 4);
      if (doc.y + h > bottomLimit()) {
        doc.addPage();
        doc.y = 48;
        header();
      }
      const y = doc.y;
      doc.font("Helvetica").fontSize(8.5).fillColor(INK);
      doc.text(l.date.slice(0, 10), cols[0].x, y, { width: cols[0].w, lineBreak: false });
      doc.text(text, cols[1].x, y, { width: cols[1].w });
      doc.text(money(l.amountCents, cur), cols[2].x, y, { width: cols[2].w, align: "right", lineBreak: false });
      doc.text(money(-(l.platformFeeCents + l.stripeFeeCents), cur), cols[3].x, y, { width: cols[3].w, align: "right", lineBreak: false });
      doc.text(money(l.netCents, cur), cols[4].x, y, { width: cols[4].w, align: "right", lineBreak: false });
      doc.y = y + h;
      rule(doc.y - 2);
    }

    // Footer with page numbers on every page
    const range = doc.bufferedPageRange();
    const generated = (opts.generatedAt ?? new Date()).toISOString().slice(0, 10);
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // allow drawing in the footer band without auto page-break
      doc.font("Helvetica").fontSize(8).fillColor(MUTED);
      const y = doc.page.height - 40;
      doc.text(`Generated ${generated} | brandthread-statement-${s.period.month}`, L, y, { width: W / 2, lineBreak: false });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, L + W / 2, y, { width: W / 2, align: "right", lineBreak: false });
    }
    doc.end();
  });
}

