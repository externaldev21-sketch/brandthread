/**
 * Renders the buyer order receipt for a sample order to HTML files (for PR
 * screenshots / visual review). Captures exactly what would be POSTed to
 * Resend, so the output is the real email body.
 *   npx tsx scripts/render-sample-receipt.ts <outDir> [modulePath]
 * modulePath defaults to ../src/lib/brandthreadEmail (pass a copy of an older
 * version to render the "before" receipt).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const outDir = process.argv[2] ?? "receipt-samples";
const modulePath = process.argv[3] ?? "../src/lib/brandthreadEmail";
mkdirSync(outDir, { recursive: true });

process.env.RESEND_API_KEY = "sample-render";
const captured: Array<{ html: string; text?: string; subject: string }> = [];
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  captured.push(JSON.parse(init?.body ?? "{}"));
  return { ok: true, status: 202 } as Response;
}) as typeof fetch;

const mod = await import(modulePath);
const logoPath = path.resolve(import.meta.dirname, "../../mobile/assets/images/brandthread-logo.png");
const logoDataUri = `data:image/png;base64,${readFileSync(logoPath).toString("base64")}`;

const order = {
  to: "alex@example.com",
  orderNumber: "BT-00042",
  items: [
    { productName: "Leather ankle boots", variantLabel: "9 / Black", quantity: 1, priceCents: 18_500, imageUrl: "https://cdn.example.com/leather-ankle-boots.jpg" },
    { productName: "Chrome logo tee", variantLabel: "M / Black", quantity: 2, priceCents: 3_500, imageUrl: null },
  ],
  subtotalCents: 25_500,
  discountCents: 2_550,
  threadCashCents: 500,
  shippingCents: 795,
  taxCents: 2_021,
  totalCents: 25_266,
  shippingAddress: { name: "Alex Rivera", street: "12 Mercer St", line2: "Apt 4", city: "New York", state: "NY", zip: "10013", country: "US" },
  idempotencyKey: "order-confirmation/sample",
};

const variants: Array<[string, Record<string, unknown>]> = [
  ["receipt-store-name", { store: { name: "Northbound Studio", contactEmail: "hello@northbound.example" } }],
  ["receipt-store-logo", { store: { name: "Northbound Studio", logoUrl: "https://cdn.example.com/northbound-logo.svg", contactEmail: "hello@northbound.example" } }],
  ["receipt-no-store", { store: null, discountCents: 0, threadCashCents: 0, taxCents: 0, totalCents: 26_295 }],
];
for (const [name, overrides] of variants) {
  captured.length = 0;
  await mod.sendOrderConfirmationEmail({ ...order, ...overrides });
  const sent = captured[0];
  writeFileSync(path.join(outDir, `${name}.html`), sent.html.replaceAll("cid:brandthread-logo", logoDataUri));
  if (sent.text) writeFileSync(path.join(outDir, `${name}.txt`), sent.text);
  console.log(`${name}: ${sent.subject}`);
}

// Shipping email header with the store branding (ignored by versions without it).
captured.length = 0;
await mod.sendOrderShippingEmail({
  to: order.to,
  orderNumber: order.orderNumber,
  carrier: "UPS",
  trackingNumber: "1Z999AA10123456784",
  store: { name: "Northbound Studio", logoUrl: "https://cdn.example.com/northbound-logo.svg" },
  idempotencyKey: "order-shipped/sample",
});
writeFileSync(path.join(outDir, "shipping-store-logo.html"), captured[0].html.replaceAll("cid:brandthread-logo", logoDataUri));
console.log(`shipping-store-logo: ${captured[0].subject}`);
