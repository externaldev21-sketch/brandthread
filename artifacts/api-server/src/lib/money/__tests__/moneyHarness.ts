/**
 * Shared setup for the money integration tests: real Postgres rows, a fake
 * Stripe (./fakeStripe), and helpers that drive the same code paths
 * production uses (the checkout webhook handler, the money services, and the
 * HTTP routes). Test files must declare their vi.mock calls themselves.
 */
import crypto from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import {
  db, checkoutSessions, drops, dropWallets, manufacturers, orders, productVariants, products, sampleOrders,
  shippingLabels, users,
} from "@workspace/db";
import { handleCheckoutPaid } from "../../../routes/webhooks";
import { destinationApplicationFeeCents } from "../fees";
import { accountBalanceCents, findUnbalancedTransactions } from "../ledger";
import { recordLabelPurchased } from "../escrow";
import { fake } from "./fakeStripe";

export const RUN = crypto.randomBytes(5).toString("hex");
let seq = 0;
export const uid = (tag: string) => `${tag}-${RUN}-${++seq}`;

export async function seedSeller(tag: string, options: { stripeAccount?: boolean } = {}): Promise<string> {
  const clerkId = uid(`money-seller-${tag}`);
  await db.insert(users).values({
    clerkId,
    email: `${clerkId}@money-tests.invalid`,
    name: `Seller ${tag}`,
    role: "seller",
    stripeAccountId: options.stripeAccount === false ? null : `acct_${clerkId.replace(/-/g, "_")}`,
    stripeAccountStatus: options.stripeAccount === false ? null : "active",
  });
  return clerkId;
}

export async function seedBuyer(tag: string): Promise<string> {
  const clerkId = uid(`money-buyer-${tag}`);
  await db.insert(users).values({
    clerkId,
    email: `${clerkId}@money-tests.invalid`,
    name: `Buyer ${tag}`,
    role: "buyer",
  });
  return clerkId;
}

export async function seedDrop(sellerId: string, options: { deadlineDays?: number; status?: string } = {}) {
  const [drop] = await db.insert(drops).values({
    ownerId: sellerId,
    name: `Preorder drop ${uid("drop")}`,
    type: "pre-order",
    status: options.status ?? "active",
    payoutStatus: "held",
    escrowState: "collecting",
    fulfillmentDeadlineAt: new Date(Date.now() + (options.deadlineDays ?? 60) * 86_400_000),
  }).returning();
  return drop;
}

export async function seedProduct(sellerId: string, options: { priceCents: number; dropId?: string | null; stock?: number }) {
  const [product] = await db.insert(products).values({
    ownerId: sellerId,
    name: `Tee ${uid("product")}`,
    status: "active",
    dropId: options.dropId ?? null,
    isPreOrder: Boolean(options.dropId),
  }).returning();
  const [variant] = await db.insert(productVariants).values({
    productId: product.id,
    sku: uid("sku"),
    size: "M",
    priceCents: options.priceCents,
    stock: options.stock ?? 100,
  }).returning();
  return { productId: product.id, variantId: variant.id, productName: product.name, priceCents: options.priceCents };
}

export type PayInput = {
  sellerId: string;
  buyerId: string;
  items: Array<{ variantId: string; productName: string; priceCents: number; quantity: number }>;
  chargeModel: "destination" | "held";
  dropId?: string | null;
  shippingCents?: number;
  taxCents?: number;
  discountCents?: number;
  /** Stripe's actual processing fee for this charge. */
  stripeFeeCents?: number | null;
};

/**
 * Simulates a buyer completing Stripe Checkout: persists the checkout row
 * exactly as the checkout route does, then runs the real paid-checkout
 * webhook handler. Returns the created order.
 */
export async function pay(input: PayInput) {
  const subtotal = input.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const shipping = input.shippingCents ?? 0;
  const tax = input.taxCents ?? 0;
  const discount = input.discountCents ?? 0;
  const fee = destinationApplicationFeeCents({
    merchandiseCents: Math.max(0, subtotal - discount),
    preTaxTotalCents: Math.max(0, subtotal + shipping - discount),
  });
  const [checkout] = await db.insert(checkoutSessions).values({
    buyerId: input.buyerId,
    sellerId: input.sellerId,
    items: input.items.map((item) => ({ ...item, variantLabel: "M" })),
    chargeModel: input.chargeModel,
    dropId: input.dropId ?? null,
    platformFeeCents: fee.platformFeeCents,
    processingFeeEstimateCents: fee.processingFeeEstimateCents,
  }).returning();
  const sessionId = `cs_${uid("session").replace(/-/g, "_")}`;
  const paymentIntentId = `pi_${uid("pi").replace(/-/g, "_")}`;
  if (input.stripeFeeCents !== undefined) fake.state.chargeFees.set(paymentIntentId, input.stripeFeeCents);
  await db.update(checkoutSessions).set({ stripeSessionId: sessionId }).where(eq(checkoutSessions.id, checkout.id));
  const session = {
    id: sessionId,
    payment_intent: paymentIntentId,
    payment_status: "paid",
    amount_total: subtotal + shipping + tax - discount,
    total_details: { amount_tax: tax, amount_shipping: shipping, amount_discount: discount },
    metadata: { csRef: checkout.id, ...(input.dropId ? { dropId: input.dropId } : {}) },
  };
  await handleCheckoutPaid(session, `evt_${uid("paid")}`, new Date());
  const [order] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId)).limit(1);
  if (!order) throw new Error("checkout did not create an order");
  return { order, session, fee };
}

export async function reloadOrder(orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return order;
}

export async function setTracking(orderId: string, trackingNumber = `1Z${uid("trk")}`) {
  await db.update(orders).set({ trackingNumber, carrier: "UPS" }).where(eq(orders.id, orderId));
}

/** Records a bought label the way the label route does after the carrier says yes. */
export async function buyLabel(orderId: string, sellerId: string, priceCents: number) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const [label] = await db.insert(shippingLabels).values({
    orderId,
    ownerId: sellerId,
    idempotencyKey: uid("label"),
    providerRateId: uid("rate"),
    carrier: "USPS",
    service: "Ground",
    trackingNumber: `9400${Date.now()}${++seq}`,
    priceCents,
    status: "active",
  }).returning();
  await db.transaction((tx) => recordLabelPurchased(tx, {
    labelId: label.id,
    orderId,
    sellerId,
    dropId: order.dropId,
    chargeModel: order.chargeModel,
    priceCents,
  }));
  return label;
}

export async function seedManufacturer() {
  const [manufacturer] = await db.insert(manufacturers).values({
    businessName: `Factory ${uid("mfr")}`,
    country: "PT",
    specialty: "Knitwear",
    status: "active",
    stripeAccountId: `acct_${uid("mfr").replace(/-/g, "_")}`,
    paymentSetup: true,
  }).returning();
  return manufacturer;
}

export async function seedBulkOrder(sellerId: string, manufacturerId: string, priceCents: number) {
  const [order] = await db.insert(sampleOrders).values({
    manufacturerId,
    sellerId,
    clientRequestId: uid("bulk"),
    orderType: "bulk",
    title: "Bulk run",
    quantity: 100,
    priceCents,
    status: "pending_payment",
    walletPaymentState: "pending",
  }).returning();
  return order;
}

export async function walletFor(dropId: string) {
  const [wallet] = await db.select().from(dropWallets).where(eq(dropWallets.dropId, dropId)).limit(1);
  return wallet;
}

export function held(sellerId: string, filter: { dropId?: string; orderId?: string | null } = {}) {
  return accountBalanceCents(db, { account: "seller_held", partyId: sellerId, ...filter });
}

export function paidOut(sellerId: string) {
  return accountBalanceCents(db, { account: "seller_paid_out", partyId: sellerId });
}

/**
 * The wallet columns are a projection of the ledger: what came in minus
 * what went out must equal the ledger's held balance for the drop.
 */
export async function expectWalletMatchesLedger(dropId: string, sellerId: string) {
  const wallet = await walletFor(dropId);
  const ledgerHeld = await held(sellerId, { dropId });
  if (wallet.balanceCents - wallet.releasedCents !== ledgerHeld) {
    throw new Error(`wallet ${wallet.balanceCents}-${wallet.releasedCents} != ledger ${ledgerHeld}`);
  }
}

export async function expectLedgerBalanced() {
  const unbalanced = await findUnbalancedTransactions(db);
  if (unbalanced.length) throw new Error(`unbalanced ledger transactions: ${unbalanced.join(", ")}`);
}

export async function ledgerKinds(orderId: string): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT kind FROM ledger_transactions WHERE order_id = ${orderId}::uuid ORDER BY created_at, kind
  `);
  return (result.rows as Array<{ kind: string }>).map((row) => row.kind);
}

export async function orderLedger(orderId: string) {
  const result = await db.execute(sql`
    SELECT account, party_id, SUM(amount_cents)::bigint AS total
    FROM ledger_postings WHERE order_id = ${orderId}::uuid
    GROUP BY account, party_id
  `);
  const out: Record<string, number> = {};
  for (const row of result.rows as Array<{ account: string; total: string }>) {
    out[row.account] = (out[row.account] ?? 0) + Number(row.total);
  }
  return out;
}

export async function startApp(mount: (app: express.Express) => void): Promise<{ base: string; close: () => Promise<void> }> {
  const app = express();
  app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).clerkUserId = req.headers["x-test-user"];
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  mount(app);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

export async function call(base: string, method: string, path: string, user: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, body: json };
}

export async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export { and, eq, sql };
