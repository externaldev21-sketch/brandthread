/**
 * Live auctions (F6 item 94): start / bid / cancel / settle, and the
 * checkout hooks that charge the winner the winning price.
 *
 * Concurrency: every bid runs in a transaction that locks the auction row
 * (SELECT … FOR UPDATE), re-checks the rules from lib/liveAuctionRules.ts
 * against the locked row, then writes. Settling also locks the row, so a bid
 * and the settle can't interleave. Settle runs from a 1s job
 * (jobs/liveAuctionSettle.ts) and on every read/bid ("settle on read").
 *
 * Checkout: a winner pays through the normal checkout (routes/buyer.ts
 * hosted session, or routes/checkout-intent.ts) with `auctionId` on the line
 * item. resolveAuctionLinePrice() is the only place that price comes from —
 * a client-sent price is never used. While an auction is open, or sold and
 * waiting for the winner's payment, the piece can't be bought any other way.
 */
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { broadcastToRoom } from "../ws/liveHub";
import { logger } from "./logger";
import { isBlockedEitherWay } from "./safety";
import { loadRestriction } from "./liveModerationState";
import {
  BID_REJECTION_MESSAGES, bidRejection, bidderDisplayName, extendedEndsAt, minIncrementCents, minNextBidCents,
  oneOfOneVariant, settleOutcome, type BidRejection, type StartInput,
} from "./liveAuctionRules";

export const LIVE_AUCTIONS_FLAG = "live_auctions";

/** Fails closed: a lookup error means auctions are off. */
export async function isLiveAuctionsEnabled(): Promise<boolean> {
  try {
    const r = await pool.query<{ enabled: boolean }>(`SELECT enabled FROM feature_flags WHERE key = $1`, [LIVE_AUCTIONS_FLAG]);
    return r.rows[0]?.enabled === true;
  } catch {
    return false;
  }
}

export class AuctionError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Row = Record<string, any>;

function toAuction(r: Row) {
  return {
    id: String(r.id),
    streamId: String(r.stream_id),
    sellerId: String(r.seller_id),
    productId: String(r.product_id),
    variantId: r.variant_id ? String(r.variant_id) : null,
    productName: String(r.product_name ?? ""),
    imageUri: r.image_uri ?? null,
    startingBidCents: Number(r.starting_bid_cents),
    currentBidCents: r.current_bid_cents == null ? null : Number(r.current_bid_cents),
    leaderUserId: r.leader_user_id ?? null,
    bidCount: Number(r.bid_count ?? 0),
    durationSeconds: Number(r.duration_seconds),
    suddenDeath: r.sudden_death === true,
    endsAt: new Date(r.ends_at),
    status: String(r.status),
    winnerUserId: r.winner_user_id ?? null,
    winnerOrderId: r.winner_order_id ?? null,
    payBy: r.pay_by ? new Date(r.pay_by) : null,
    settledAt: r.settled_at ? new Date(r.settled_at) : null,
  };
}
export type Auction = ReturnType<typeof toAuction>;

async function displayNameOf(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const r = await db.execute(sql`SELECT username, display_name, name FROM users WHERE clerk_id = ${userId} LIMIT 1`);
  const u = r.rows[0] as any;
  return bidderDisplayName({ username: u?.username, displayName: u?.display_name ?? u?.name });
}

/** The shape every client sees (socket events + GET). `viewerId` adds the "you" fields. */
export async function publicAuction(a: Auction, viewerId: string | null = null, now: Date = new Date()) {
  const leaderName = await displayNameOf(a.leaderUserId);
  const current = a.currentBidCents;
  const nextMin = minNextBidCents(a);
  const youWon = !!viewerId && a.status === "sold" && a.winnerUserId === viewerId;
  return {
    id: a.id,
    streamId: a.streamId,
    sellerId: a.sellerId,
    productId: a.productId,
    variantId: a.variantId,
    productName: a.productName,
    imageUri: a.imageUri,
    startingBidCents: a.startingBidCents,
    currentBidCents: current,
    nextMinBidCents: nextMin,
    incrementCents: minIncrementCents(current ?? a.startingBidCents),
    bidCount: a.bidCount,
    leaderUserId: a.leaderUserId,
    leaderName,
    suddenDeath: a.suddenDeath,
    endsAt: a.endsAt.toISOString(),
    serverNow: now.toISOString(),
    status: a.status,
    winnerName: a.status === "sold" ? leaderName : null,
    ...(viewerId ? {
      youAreLeading: a.status === "open" && a.leaderUserId === viewerId,
      youWon,
      payable: youWon && !a.winnerOrderId && !!a.payBy && a.payBy.getTime() > now.getTime(),
      paid: youWon && !!a.winnerOrderId,
      isHost: viewerId === a.sellerId,
    } : {}),
  };
}

async function broadcastAuction(type: "auction_started" | "auction_bid" | "auction_ended", a: Auction): Promise<void> {
  try {
    broadcastToRoom(a.streamId, { type, auction: await publicAuction(a) });
  } catch (err) {
    logger.warn({ err, auctionId: a.id }, "auction broadcast failed");
  }
}

// ─── Start ───────────────────────────────────────────────────────────────────

export async function startAuction(sellerId: string, streamId: string, input: StartInput, now: Date = new Date()): Promise<Auction> {
  const stream = await db.execute(sql`SELECT status FROM live_streams WHERE id = ${streamId}::uuid AND seller_id = ${sellerId}`);
  if (!stream.rows.length) throw new AuctionError(404, "NOT_FOUND", "Not found or not your stream");
  if ((stream.rows[0] as any).status !== "live") throw new AuctionError(409, "LIVE_ENDED", "This live has ended");

  const product = await db.execute(sql`
    SELECT id, name, images FROM products
    WHERE id = ${input.productId}::uuid AND owner_id = ${sellerId} AND status = 'active' AND deleted_at IS NULL
  `);
  const p = product.rows[0] as any;
  if (!p) throw new AuctionError(400, "PRODUCT_UNAVAILABLE", "Choose one of your active products.");
  const variants = await db.execute(sql`SELECT id, stock FROM product_variants WHERE product_id = ${input.productId}::uuid`);
  const variantId = oneOfOneVariant((variants.rows as any[]).map((v) => ({ id: String(v.id), stock: Number(v.stock) })));
  if (!variantId) throw new AuctionError(400, "NOT_ONE_OF_ONE", "Only 1-of-1 pieces (exactly one in stock) can be auctioned.");
  const held = await db.execute(sql`
    SELECT 1 FROM live_auctions
    WHERE product_id = ${input.productId}::uuid
      AND (status = 'open' OR (status = 'sold' AND winner_order_id IS NULL AND pay_by > ${now.toISOString()}::timestamptz))
    LIMIT 1
  `);
  if (held.rows.length) throw new AuctionError(409, "ALREADY_AUCTIONED", "This piece is already in an auction.");

  const images = Array.isArray(p.images) ? p.images : [];
  try {
    const inserted = await db.execute(sql`
      INSERT INTO live_auctions (stream_id, seller_id, product_id, variant_id, product_name, image_uri,
        starting_bid_cents, duration_seconds, sudden_death, ends_at)
      VALUES (${streamId}::uuid, ${sellerId}, ${input.productId}::uuid, ${variantId}::uuid, ${String(p.name ?? "")},
        ${typeof images[0] === "string" ? images[0] : null}, ${input.startingBidCents}, ${input.durationSeconds},
        ${input.suddenDeath}, ${new Date(now.getTime() + input.durationSeconds * 1000).toISOString()}::timestamptz)
      RETURNING *
    `);
    const a = toAuction(inserted.rows[0] as Row);
    await broadcastAuction("auction_started", a);
    return a;
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      throw new AuctionError(409, "AUCTION_RUNNING", "An auction is already running in this live.");
    }
    throw err;
  }
}

// ─── Settle ──────────────────────────────────────────────────────────────────

/** Settles one auction if its time is up. Returns the settled auction, or null. */
async function settleOne(auctionId: string, now: Date): Promise<Auction | null> {
  const settled = await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT * FROM live_auctions WHERE id = ${auctionId}::uuid FOR UPDATE`);
    const row = locked.rows[0] as Row | undefined;
    if (!row || row.status !== "open" || new Date(row.ends_at).getTime() > now.getTime()) return null;
    const outcome = settleOutcome({ leaderUserId: row.leader_user_id ?? null, currentBidCents: row.current_bid_cents ?? null }, now);
    const updated = await tx.execute(sql`
      UPDATE live_auctions
      SET status = ${outcome.status}, winner_user_id = ${outcome.winnerUserId},
          pay_by = ${outcome.payBy ? outcome.payBy.toISOString() : null}::timestamptz, settled_at = ${now.toISOString()}::timestamptz
      WHERE id = ${auctionId}::uuid
      RETURNING *
    `);
    return toAuction(updated.rows[0] as Row);
  });
  if (settled) await broadcastAuction("auction_ended", settled);
  return settled;
}

/** Settles every auction whose time is up (optionally only in one stream). */
export async function settleDueAuctions(now: Date = new Date(), streamId?: string): Promise<number> {
  const due = await db.execute(sql`
    SELECT id FROM live_auctions
    WHERE status = 'open' AND ends_at <= ${now.toISOString()}::timestamptz
    ${streamId ? sql`AND stream_id = ${streamId}::uuid` : sql``}
    LIMIT 100
  `);
  let n = 0;
  for (const r of due.rows as any[]) {
    if (await settleOne(String(r.id), now)) n++;
  }
  return n;
}

// ─── Bid ─────────────────────────────────────────────────────────────────────

export async function placeBid(streamId: string, auctionId: string, bidderId: string, amountCents: number, now: () => Date = () => new Date()): Promise<Auction> {
  const head = await db.execute(sql`SELECT seller_id FROM live_auctions WHERE id = ${auctionId}::uuid AND stream_id = ${streamId}::uuid`);
  const sellerId = (head.rows[0] as any)?.seller_id as string | undefined;
  if (!sellerId) throw new AuctionError(404, "NOT_FOUND", "Auction not found");
  // Same gates as joining the live: a block either way, or a ban from this live.
  if (bidderId !== sellerId) {
    if (await isBlockedEitherWay(bidderId, sellerId)) throw new AuctionError(404, "NOT_FOUND", "Auction not found");
    if ((await loadRestriction(streamId, bidderId)) === "ban") throw new AuctionError(403, "REMOVED", "The host removed you from this live.");
  }
  await settleDueAuctions(now(), streamId);

  const result = await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT * FROM live_auctions WHERE id = ${auctionId}::uuid FOR UPDATE`);
    const a = toAuction(locked.rows[0] as Row);
    const at = now();
    const rejection: BidRejection | null = bidRejection({ auction: a, bidderId, amountCents, now: at });
    if (rejection) return { rejection, auction: a };
    const endsAt = extendedEndsAt(a.endsAt, at, a.suddenDeath);
    const updated = await tx.execute(sql`
      UPDATE live_auctions
      SET current_bid_cents = ${amountCents}, leader_user_id = ${bidderId}, bid_count = bid_count + 1,
          ends_at = ${endsAt.toISOString()}::timestamptz
      WHERE id = ${auctionId}::uuid
      RETURNING *
    `);
    await tx.execute(sql`
      INSERT INTO live_auction_bids (auction_id, bidder_id, amount_cents, created_at)
      VALUES (${auctionId}::uuid, ${bidderId}, ${amountCents}, ${at.toISOString()}::timestamptz)
    `);
    return { rejection: null, auction: toAuction(updated.rows[0] as Row) };
  });
  if (result.rejection) {
    const status = result.rejection === "SELF_BID" ? 403 : result.rejection === "INVALID_AMOUNT" ? 400 : 409;
    const err = new AuctionError(status, result.rejection, BID_REJECTION_MESSAGES[result.rejection]);
    (err as any).auction = result.auction;
    throw err;
  }
  await broadcastAuction("auction_bid", result.auction);
  return result.auction;
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

/** The host can pull an auction only before the first bid. */
export async function cancelAuction(sellerId: string, streamId: string, auctionId: string): Promise<Auction> {
  const updated = await db.execute(sql`
    UPDATE live_auctions SET status = 'cancelled', settled_at = now()
    WHERE id = ${auctionId}::uuid AND stream_id = ${streamId}::uuid AND seller_id = ${sellerId}
      AND status = 'open' AND bid_count = 0
    RETURNING *
  `);
  if (!updated.rows.length) {
    const exists = await db.execute(sql`SELECT bid_count FROM live_auctions WHERE id = ${auctionId}::uuid AND seller_id = ${sellerId}`);
    if (!exists.rows.length) throw new AuctionError(404, "NOT_FOUND", "Auction not found");
    throw new AuctionError(409, "HAS_BIDS", "An auction can't be cancelled once someone has bid.");
  }
  const a = toAuction(updated.rows[0] as Row);
  await broadcastAuction("auction_ended", a);
  return a;
}

// ─── Read ────────────────────────────────────────────────────────────────────

/** How long a finished auction stays on screen ("<name> won!") before the card clears. */
export const RECENT_END_SECONDS = 20;

/**
 * The auction a viewer should see in this live: the open one; else one that
 * just ended; else their own win that's still waiting for payment.
 */
export async function activeAuctionFor(streamId: string, viewerId: string | null, now: Date = new Date()): Promise<Auction | null> {
  await settleDueAuctions(now, streamId);
  const rows = await db.execute(sql`
    SELECT * FROM live_auctions
    WHERE stream_id = ${streamId}::uuid
      AND (
        status = 'open'
        OR settled_at > ${new Date(now.getTime() - RECENT_END_SECONDS * 1000).toISOString()}::timestamptz
        ${viewerId ? sql`OR (status = 'sold' AND winner_user_id = ${viewerId} AND winner_order_id IS NULL AND pay_by > ${now.toISOString()}::timestamptz)` : sql``}
      )
    ORDER BY (status = 'open') DESC, created_at DESC
    LIMIT 1
  `);
  return rows.rows[0] ? toAuction(rows.rows[0] as Row) : null;
}

// ─── Checkout ────────────────────────────────────────────────────────────────

/**
 * The server-side price for a checkout line.
 *  - With `auctionId`: only the winner, for that product/variant, unpaid and
 *    inside the pay window, gets the winning price; anything else is refused.
 *  - Without: null (normal price) — unless the piece is in an open auction or
 *    held for an unpaid winner, in which case it can't be bought.
 */
export async function resolveAuctionLinePrice(input: {
  buyerId: string | null; productId: string; variantId: string; quantity: number; auctionId?: string | null; now?: Date;
}): Promise<{ priceCents: number; auctionId: string } | null> {
  const now = input.now ?? new Date();
  if (input.auctionId) {
    if (!input.buyerId) throw new AuctionError(401, "AUCTION_SIGN_IN_REQUIRED", "Sign in to pay for an auction you won.");
    if (!/^[0-9a-f-]{36}$/i.test(input.auctionId)) throw new AuctionError(400, "AUCTION_INVALID", "This auction can't be paid for.");
    await settleOne(input.auctionId, now).catch(() => null);
    const r = await db.execute(sql`SELECT * FROM live_auctions WHERE id = ${input.auctionId}::uuid`);
    const row = r.rows[0] as Row | undefined;
    const a = row ? toAuction(row) : null;
    if (!a || a.status !== "sold" || a.winnerUserId !== input.buyerId || a.productId !== input.productId
      || (a.variantId && a.variantId !== input.variantId) || a.currentBidCents == null) {
      throw new AuctionError(403, "AUCTION_NOT_WON", "Only the winner can pay for this auction.");
    }
    if (a.winnerOrderId) throw new AuctionError(409, "AUCTION_PAID", "This auction is already paid for.");
    if (!a.payBy || a.payBy.getTime() <= now.getTime()) throw new AuctionError(410, "AUCTION_PAY_EXPIRED", "The time to pay for this auction has passed.");
    if (input.quantity !== 1) throw new AuctionError(400, "AUCTION_QUANTITY", "An auctioned piece is a single item.");
    return { priceCents: a.currentBidCents, auctionId: a.id };
  }
  const held = await db.execute(sql`
    SELECT 1 FROM live_auctions
    WHERE product_id = ${input.productId}::uuid
      AND (status = 'open' OR (status = 'sold' AND winner_order_id IS NULL AND pay_by > ${now.toISOString()}::timestamptz))
    LIMIT 1
  `);
  if (held.rows.length) throw new AuctionError(409, "AUCTION_HOLD", "This piece is being auctioned right now.");
  return null;
}

export async function recordAuctionCheckout(checkoutSessionId: string, auctionId: string, buyerId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO live_auction_checkouts (checkout_session_id, auction_id, buyer_id)
    VALUES (${checkoutSessionId}::uuid, ${auctionId}::uuid, ${buyerId})
    ON CONFLICT (checkout_session_id) DO NOTHING
  `);
}

/** Paid order for an auction checkout: the auction is done. Never throws. */
export async function markAuctionPaid(checkoutSessionId: string, orderId: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE live_auctions la SET winner_order_id = ${orderId}::uuid
      FROM live_auction_checkouts c
      WHERE c.checkout_session_id = ${checkoutSessionId}::uuid AND la.id = c.auction_id AND la.winner_order_id IS NULL
    `);
  } catch (err) {
    logger.warn({ err, checkoutSessionId }, "marking auction paid failed");
  }
}
