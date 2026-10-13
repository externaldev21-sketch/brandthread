/**
 * Live auction rules — pure, unit-tested in lib/__tests__/liveAuctionRules.test.ts.
 * Mirrored on the client in artifacts/mobile/lib/live/liveAuction.ts (for the
 * "Bid: $X" button); the server is the only authority.
 */

/** Auction lengths the host can pick (seconds), as on Whatnot. */
export const AUCTION_DURATIONS = [10, 15, 30, 60] as const;
/** A bid this close to the end pushes the end out to this much time left. */
export const ANTI_SNIPE_SECONDS = 10;
/** How long the winner's checkout honours the winning price. */
export const PAY_WINDOW_HOURS = 24;
export const MIN_STARTING_BID_CENTS = 100;
export const MAX_BID_CENTS = 10_000_000;

/** Fixed increments by price band. */
export function minIncrementCents(currentCents: number): number {
  if (currentCents < 2_000) return 100;
  if (currentCents < 10_000) return 200;
  if (currentCents < 50_000) return 500;
  if (currentCents < 100_000) return 1_000;
  return 2_500;
}

/** The smallest bid that would be accepted now. */
export function minNextBidCents(a: { startingBidCents: number; currentBidCents: number | null; bidCount: number }): number {
  if (!a.bidCount || a.currentBidCents == null) return a.startingBidCents;
  return a.currentBidCents + minIncrementCents(a.currentBidCents);
}

export type BidRejection =
  | "AUCTION_CLOSED"
  | "SELF_BID"
  | "ALREADY_LEADING"
  | "BID_TOO_LOW"
  | "INVALID_AMOUNT";

/** Why a bid can't be placed, or null when it can. Checked under the row lock. */
export function bidRejection(input: {
  auction: { status: string; endsAt: Date; sellerId: string; leaderUserId: string | null; startingBidCents: number; currentBidCents: number | null; bidCount: number };
  bidderId: string;
  amountCents: number;
  now: Date;
}): BidRejection | null {
  const { auction, bidderId, amountCents, now } = input;
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_BID_CENTS) return "INVALID_AMOUNT";
  if (auction.status !== "open" || auction.endsAt.getTime() <= now.getTime()) return "AUCTION_CLOSED";
  if (bidderId === auction.sellerId) return "SELF_BID";
  if (auction.leaderUserId === bidderId) return "ALREADY_LEADING";
  if (amountCents < minNextBidCents(auction)) return "BID_TOO_LOW";
  return null;
}

export const BID_REJECTION_MESSAGES: Record<BidRejection, string> = {
  AUCTION_CLOSED: "This auction has ended.",
  SELF_BID: "You can't bid on your own auction.",
  ALREADY_LEADING: "You're already winning.",
  BID_TOO_LOW: "Someone bid first. Bid again.",
  INVALID_AMOUNT: "Enter a valid bid.",
};

/** Anti-snipe: a bid in the last N seconds resets the clock to N (never in sudden death). */
export function extendedEndsAt(endsAt: Date, now: Date, suddenDeath: boolean, windowSeconds = ANTI_SNIPE_SECONDS): Date {
  if (suddenDeath) return endsAt;
  const floor = now.getTime() + windowSeconds * 1000;
  return endsAt.getTime() < floor ? new Date(floor) : endsAt;
}

/** Only true 1-of-1s can be auctioned: exactly one unit across all variants. */
export function oneOfOneVariant(variants: Array<{ id: string; stock: number }>): string | null {
  const total = variants.reduce((sum, v) => sum + Math.max(0, v.stock), 0);
  if (total !== 1) return null;
  return variants.find((v) => v.stock > 0)?.id ?? null;
}

export type StartInput = { productId: string; startingBidCents: number; durationSeconds: number; suddenDeath: boolean };

export function parseStartInput(body: any): { ok: true; value: StartInput } | { ok: false; error: string } {
  const productId = typeof body?.productId === "string" ? body.productId : "";
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return { ok: false, error: "Choose a product to auction." };
  const startingBidCents = Number(body?.startingBidCents);
  if (!Number.isInteger(startingBidCents) || startingBidCents < MIN_STARTING_BID_CENTS || startingBidCents > MAX_BID_CENTS) {
    return { ok: false, error: "The starting bid must be at least $1." };
  }
  const durationSeconds = Number(body?.durationSeconds);
  if (!(AUCTION_DURATIONS as readonly number[]).includes(durationSeconds)) {
    return { ok: false, error: `Auctions run for ${AUCTION_DURATIONS.join(", ")} seconds.` };
  }
  return { ok: true, value: { productId, startingBidCents, durationSeconds, suddenDeath: body?.suddenDeath === true } };
}

/** What an auction becomes once its time is up. */
export function settleOutcome(a: { leaderUserId: string | null; currentBidCents: number | null }, now: Date): {
  status: "sold" | "unsold"; winnerUserId: string | null; payBy: Date | null;
} {
  if (a.leaderUserId && a.currentBidCents != null) {
    return { status: "sold", winnerUserId: a.leaderUserId, payBy: new Date(now.getTime() + PAY_WINDOW_HOURS * 3_600_000) };
  }
  return { status: "unsold", winnerUserId: null, payBy: null };
}

/** The name shown for the leader / winner: @handle, else first name. */
export function bidderDisplayName(u: { username?: string | null; displayName?: string | null } | null | undefined): string {
  const handle = (u?.username ?? "").trim().replace(/^@/, "");
  if (handle) return handle.slice(0, 30);
  const first = (u?.displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return first && !first.includes("@") ? first.slice(0, 24) : "Someone";
}
