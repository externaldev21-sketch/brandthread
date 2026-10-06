/**
 * Renders a sample statement PDF from fake balance transactions.
 *   npx tsx scripts/render-sample-statement.ts <out.pdf>
 */
import { writeFileSync } from "node:fs";
import { buildStatement, type StatementTxn } from "../src/lib/money/statement";
import { renderStatementPdf } from "../src/lib/money/statementPdf";

const ts = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const txns: StatementTxn[] = [];
for (let i = 0; i < 46; i++) {
  const amount = 4_800 + ((i * 1_370) % 14_000);
  const app = Math.round(amount * 0.05);
  const stripe = Math.round(amount * 0.029) + 30;
  txns.push({
    id: `txn_sale_${i}`, created: ts(`2026-08-${String(1 + (i % 28)).padStart(2, "0")}T1${i % 10}:00:00Z`),
    type: "charge", reportingCategory: "charge", amount, fee: app + stripe, net: amount - app - stripe, currency: "usd",
    description: `Order BT-${1000 + i}`, source: `ch_${i}`,
    feeDetails: [{ type: "application_fee", amount: app }, { type: "stripe_fee", amount: stripe }],
  });
}
txns.push({ id: "txn_ref", created: ts("2026-08-12T10:00:00Z"), type: "refund", reportingCategory: "refund", amount: -4_800, fee: 0, net: -4_800, currency: "usd", description: "Refund BT-1003", source: "re_1" });
txns.push({ id: "txn_po1", created: ts("2026-08-15T10:00:00Z"), type: "payout", reportingCategory: "payout", amount: -250_000, fee: 0, net: -250_000, currency: "usd", description: "STRIPE PAYOUT", source: "po_1" });
const orderNumbersBySource: Record<string, string> = {};
for (let i = 0; i < 46; i++) orderNumbersBySource[`ch_${i}`] = `BT-${1000 + i}`;
const s = buildStatement({ month: "2026-08", now: new Date("2026-09-30T00:00:00Z"), transactions: txns, orderNumbersBySource });
const pdf = await renderStatementPdf(s, { sellerName: "Northline Studio", generatedAt: new Date("2026-09-30T00:00:00Z") });
writeFileSync(process.argv[2] ?? "statement.pdf", pdf);
