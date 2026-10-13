/**
 * Seller customers derived from real orders (Customers screen).
 *
 * The `customers` table only holds rows a seller typed in by hand (plus tags
 * and notes); nothing populates it from checkout, so on its own it shows an
 * empty list with $0 lifetime spend. This module builds the list from the
 * seller's orders instead and merges the manual rows on top:
 *
 *  - one customer per signed-in buyer (orders.buyer_id);
 *  - one customer per guest checkout email (orders.guest_email, case-folded),
 *    so guests are never collapsed into a single "Guest" bucket;
 *  - seller-created orders with only a customer_id fold into that row;
 *  - a guest email that matches a signed-in buyer's account email folds into
 *    that buyer; a manual row folds into the customer it matches by
 *    customer_id or email, contributing its name, phone, tags and notes.
 *
 * Lifetime spend counts non-cancelled orders net of refunds
 * (total_cents - refunded_cents, never below zero). A signed-in buyer's
 * account email is used only for matching and is never returned.
 */
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, orders, users } from "@workspace/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

// ─── Ids ─────────────────────────────────────────────────────────────────────

export function buyerKey(clerkId: string): string {
  return `buyer_${clerkId}`;
}

export function guestKey(email: string): string {
  return `guest_${Buffer.from(email.trim().toLowerCase(), "utf8").toString("base64url")}`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** One identity group aggregated from orders (SQL row, normalised). */
export interface OrderGroup {
  buyerId: string | null;
  guestEmail: string | null;
  customerIds: string[];
  orderCount: number;
  spentCents: number;
  lastOrderAt: Date;
  firstOrderAt: Date;
  shippingName: string | null;
}

export interface BuyerAccount {
  clerkId: string;
  displayName: string | null;
  username: string | null;
  /** Used only for matching; never returned to the seller. */
  email: string | null;
}

export interface ManualCustomer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  tags: string[];
  notes: string | null;
  createdAt: Date;
}

export interface SellerCustomer {
  id: string;
  kind: "account" | "guest" | "manual";
  name: string;
  email: string;
  handle: string | null;
  phone: string | null;
  tags: string[];
  notes: string | null;
  orderCount: number;
  totalSpentCents: number;
  lastOrderAt: string | null;
  firstOrderAt: string | null;
  createdAt: string;
  /** The manual `customers` row merged into this customer, when there is one. */
  customerRowId: string | null;
  /** Identities whose orders belong to this customer (used for order history). */
  buyerIds: string[];
  guestEmails: string[];
  customerIds: string[];
}

// ─── Pure merge ──────────────────────────────────────────────────────────────

interface Acc {
  buyerIds: Set<string>;
  guestEmails: Set<string>;
  customerIds: Set<string>;
  orderCount: number;
  spentCents: number;
  lastOrderAt: Date | null;
  firstOrderAt: Date | null;
  shippingName: string | null;
  account: BuyerAccount | null;
  manual: ManualCustomer | null;
}

function addGroup(acc: Acc, g: OrderGroup) {
  if (g.buyerId) acc.buyerIds.add(g.buyerId);
  if (g.guestEmail) acc.guestEmails.add(g.guestEmail);
  for (const c of g.customerIds) acc.customerIds.add(c);
  acc.orderCount += g.orderCount;
  acc.spentCents += g.spentCents;
  if (!acc.lastOrderAt || g.lastOrderAt > acc.lastOrderAt) {
    acc.lastOrderAt = g.lastOrderAt;
    if (g.shippingName) acc.shippingName = g.shippingName;
  }
  if (!acc.shippingName && g.shippingName) acc.shippingName = g.shippingName;
  if (!acc.firstOrderAt || g.firstOrderAt < acc.firstOrderAt) acc.firstOrderAt = g.firstOrderAt;
}

const lower = (v: string | null | undefined) => (v ? v.trim().toLowerCase() : "");

export function mergeSellerCustomers(
  groups: readonly OrderGroup[],
  accounts: readonly BuyerAccount[],
  manual: readonly ManualCustomer[],
): SellerCustomer[] {
  const accountById = new Map(accounts.map((a) => [a.clerkId, a]));
  const manualById = new Map(manual.map((m) => [m.id, m]));
  const accs: Acc[] = [];
  const byBuyer = new Map<string, Acc>();
  const byEmail = new Map<string, Acc>();
  const byCustomerId = new Map<string, Acc>();
  const blank = (): Acc => ({
    buyerIds: new Set(), guestEmails: new Set(), customerIds: new Set(),
    orderCount: 0, spentCents: 0, lastOrderAt: null, firstOrderAt: null,
    shippingName: null, account: null, manual: null,
  });

  // 1. Signed-in buyers first, so guest checkouts with their email fold in.
  for (const g of groups) {
    if (!g.buyerId) continue;
    let acc = byBuyer.get(g.buyerId);
    if (!acc) {
      acc = blank();
      acc.account = accountById.get(g.buyerId) ?? null;
      accs.push(acc);
      byBuyer.set(g.buyerId, acc);
      const accountEmail = lower(acc.account?.email);
      if (accountEmail && !byEmail.has(accountEmail)) byEmail.set(accountEmail, acc);
    }
    addGroup(acc, g);
  }
  // 2. Guest emails.
  for (const g of groups) {
    if (g.buyerId || !g.guestEmail) continue;
    const email = lower(g.guestEmail);
    let acc = byEmail.get(email);
    if (!acc) { acc = blank(); accs.push(acc); byEmail.set(email, acc); }
    addGroup(acc, { ...g, guestEmail: email });
  }
  for (const acc of accs) for (const c of acc.customerIds) if (!byCustomerId.has(c)) byCustomerId.set(c, acc);
  // 3. Seller-created orders that only carry a customer_id.
  for (const g of groups) {
    if (g.buyerId || g.guestEmail) continue;
    const cid = g.customerIds[0];
    if (!cid) continue;
    const rowEmail = lower(manualById.get(cid)?.email);
    let acc = byCustomerId.get(cid) ?? (rowEmail ? byEmail.get(rowEmail) : undefined);
    if (!acc) { acc = blank(); accs.push(acc); }
    byCustomerId.set(cid, acc);
    addGroup(acc, g);
  }
  // 4. Manual rows: fold into a match, otherwise list on their own.
  for (const row of manual) {
    const email = lower(row.email);
    let acc = byCustomerId.get(row.id) ?? (email ? byEmail.get(email) : undefined);
    if (acc && acc.manual) acc = undefined; // a customer only carries one manual row
    if (!acc) { acc = blank(); accs.push(acc); }
    acc.manual = row;
    acc.customerIds.add(row.id);
    if (email && !byEmail.has(email)) byEmail.set(email, acc);
  }

  return accs.map((acc) => {
    const buyerIds = [...acc.buyerIds];
    const guestEmails = [...acc.guestEmails];
    const kind: SellerCustomer["kind"] = buyerIds.length ? "account" : guestEmails.length ? "guest" : "manual";
    const id = buyerIds.length
      ? buyerKey(buyerIds[0]!)
      : guestEmails.length
        ? guestKey(guestEmails[0]!)
        : (acc.manual?.id ?? [...acc.customerIds][0]!);
    const handle = acc.account?.username ? `@${acc.account.username}` : null;
    const email = guestEmails[0] ?? lower(acc.manual?.email) ?? "";
    const name = acc.manual?.name?.trim()
      || acc.account?.displayName?.trim()
      || acc.account?.username?.trim()
      || acc.shippingName?.trim()
      || (email ? email.split("@")[0]! : "")
      || "Customer";
    const createdAt = acc.firstOrderAt ?? acc.manual?.createdAt ?? new Date(0);
    return {
      id,
      kind,
      name,
      email,
      handle,
      phone: acc.manual?.phone ?? null,
      tags: acc.manual?.tags ?? [],
      notes: acc.manual?.notes ?? null,
      orderCount: acc.orderCount,
      totalSpentCents: acc.spentCents,
      lastOrderAt: acc.lastOrderAt?.toISOString() ?? null,
      firstOrderAt: acc.firstOrderAt?.toISOString() ?? null,
      createdAt: createdAt.toISOString(),
      customerRowId: acc.manual?.id ?? null,
      buyerIds,
      guestEmails,
      customerIds: [...acc.customerIds],
    };
  });
}

/** Case-insensitive match on name, email, @handle or a tag. */
export function matchesCustomerSearch(c: SellerCustomer, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return [c.name, c.email, c.handle ?? "", ...c.tags].some((v) => v.toLowerCase().includes(t));
}

/** Highest lifetime spend first; ties go to the most recent order. */
export function topCustomers(list: readonly SellerCustomer[], limit: number): SellerCustomer[] {
  return list
    .filter((c) => c.orderCount > 0)
    .sort((a, b) => b.totalSpentCents - a.totalSpentCents
      || (b.lastOrderAt ?? "").localeCompare(a.lastOrderAt ?? ""))
    .slice(0, limit);
}

/** What the client sees: identity sets stay server-side. */
export function publicCustomer(c: SellerCustomer) {
  const { buyerIds: _b, guestEmails: _g, customerIds: _c, ...rest } = c;
  return rest;
}

// ─── DB ──────────────────────────────────────────────────────────────────────

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const date = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

export async function listSellerCustomers(ownerId: string): Promise<SellerCustomer[]> {
  const res = await db.execute(sql`
    WITH o AS (
      SELECT o.*,
        CASE
          WHEN o.buyer_id IS NOT NULL THEN 'b:' || o.buyer_id
          WHEN NULLIF(btrim(o.guest_email), '') IS NOT NULL THEN 'g:' || lower(btrim(o.guest_email))
          WHEN o.customer_id IS NOT NULL THEN 'c:' || o.customer_id::text
        END AS ckey
      FROM orders o
      WHERE o.owner_id = ${ownerId} AND o.status <> 'cancelled'
    )
    SELECT
      ckey,
      MAX(buyer_id) AS buyer_id,
      MAX(CASE WHEN buyer_id IS NULL THEN lower(btrim(guest_email)) END) AS guest_email,
      COALESCE(array_agg(DISTINCT customer_id::text) FILTER (WHERE customer_id IS NOT NULL), '{}') AS customer_ids,
      COUNT(*)::int AS order_count,
      COALESCE(SUM(GREATEST(total_cents - refunded_cents, 0)), 0)::bigint AS spent_cents,
      MAX(created_at) AS last_order_at,
      MIN(created_at) AS first_order_at,
      (array_agg(NULLIF(btrim(shipping_address->>'name'), '') ORDER BY created_at DESC)
        FILTER (WHERE NULLIF(btrim(shipping_address->>'name'), '') IS NOT NULL))[1] AS shipping_name
    FROM o
    WHERE ckey IS NOT NULL
    GROUP BY ckey
  `);
  const groups: OrderGroup[] = (((res as any).rows ?? []) as any[]).map((r) => ({
    buyerId: r.buyer_id ?? null,
    guestEmail: r.guest_email ?? null,
    customerIds: Array.isArray(r.customer_ids) ? r.customer_ids : [],
    orderCount: num(r.order_count),
    spentCents: num(r.spent_cents),
    lastOrderAt: date(r.last_order_at),
    firstOrderAt: date(r.first_order_at),
    shippingName: r.shipping_name ?? null,
  }));
  const buyerIds = groups.map((g) => g.buyerId).filter((v): v is string => !!v);
  const [accounts, manualRows] = await Promise.all([
    buyerIds.length
      ? db.select({ clerkId: users.clerkId, displayName: users.displayName, username: users.username, email: users.email })
        .from(users).where(inArray(users.clerkId, buyerIds))
      : Promise.resolve([] as BuyerAccount[]),
    // tags/notes are added by migration 271 (and the customers route's
    // startup ALTER) but are not in the Drizzle table, so read them raw.
    db.execute(sql`
      SELECT id, name, email, phone, tags, notes, created_at
      FROM customers WHERE owner_id = ${ownerId}
    `),
  ]);
  const manual: ManualCustomer[] = (((manualRows as any).rows ?? []) as any[]).map((r) => ({
    id: String(r.id),
    name: r.name ?? "",
    email: r.email ?? "",
    phone: r.phone ?? null,
    tags: Array.isArray(r.tags) ? r.tags.filter((t: unknown) => typeof t === "string") : [],
    notes: r.notes ?? null,
    createdAt: date(r.created_at),
  }));
  return mergeSellerCustomers(groups, accounts, manual);
}

/** Finds a customer by its list id, any of its identity keys, or its manual row id. */
export async function findSellerCustomer(ownerId: string, id: string): Promise<SellerCustomer | null> {
  const list = await listSellerCustomers(ownerId);
  return list.find((c) =>
    c.id === id
    || c.customerRowId === id
    || c.customerIds.includes(id)
    || c.buyerIds.some((b) => buyerKey(b) === id)
    || c.guestEmails.some((e) => guestKey(e) === id),
  ) ?? null;
}

/** Every order (any status) that belongs to this customer, newest first. */
export async function sellerCustomerOrders(ownerId: string, c: SellerCustomer) {
  const conds: SQL[] = [];
  if (c.buyerIds.length) conds.push(inArray(orders.buyerId, c.buyerIds));
  if (c.guestEmails.length) {
    conds.push(and(sql`${orders.buyerId} IS NULL`, sql`lower(btrim(${orders.guestEmail})) IN (${sql.join(c.guestEmails.map((e) => sql`${e}`), sql`, `)})`)!);
  }
  if (c.customerIds.length) conds.push(inArray(orders.customerId, c.customerIds));
  if (!conds.length) return [];
  return db.select().from(orders)
    .where(and(eq(orders.ownerId, ownerId), or(...conds)))
    .orderBy(sql`${orders.createdAt} DESC`);
}
