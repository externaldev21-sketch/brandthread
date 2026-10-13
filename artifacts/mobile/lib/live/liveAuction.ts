/**
 * Live auctions — client types + pure helpers (unit-tested in
 * tests/live-auction.test.ts). Mirrors the server's increment ladder
 * (api-server lib/liveAuctionRules.ts) so the "Bid: $X" button shows the next
 * valid bid; the server stays the only authority.
 */

export interface LiveAuction {
  id: string;
  streamId: string;
  sellerId: string;
  productId: string;
  variantId: string | null;
  productName: string;
  imageUri: string | null;
  startingBidCents: number;
  currentBidCents: number | null;
  nextMinBidCents: number;
  incrementCents: number;
  bidCount: number;
  leaderUserId: string | null;
  leaderName: string | null;
  suddenDeath: boolean;
  /** ISO. */
  endsAt: string;
  /** ISO server clock when this snapshot was made (corrects device clock skew). */
  serverNow: string;
  status: 'open' | 'sold' | 'unsold' | 'cancelled';
  winnerName: string | null;
  youAreLeading?: boolean;
  youWon?: boolean;
  payable?: boolean;
  paid?: boolean;
  isHost?: boolean;
}

export const AUCTION_DURATIONS = [10, 15, 30, 60] as const;

export function minIncrementCents(currentCents: number): number {
  if (currentCents < 2_000) return 100;
  if (currentCents < 10_000) return 200;
  if (currentCents < 50_000) return 500;
  if (currentCents < 100_000) return 1_000;
  return 2_500;
}

/** Next valid bid for a given current price (custom-bid stepper "+"). */
export function nextBidAbove(currentCents: number): number {
  return currentCents + minIncrementCents(currentCents);
}

/** Previous stepper value, never below the minimum valid bid. */
export function prevBid(valueCents: number, minCents: number): number {
  if (valueCents <= minCents) return minCents;
  let v = minCents;
  while (nextBidAbove(v) < valueCents) v = nextBidAbove(v);
  return v;
}

/**
 * Milliseconds left on the auction, using the server's clock at snapshot time
 * plus how long ago (device time) the snapshot arrived.
 */
export function auctionRemainingMs(a: Pick<LiveAuction, 'endsAt' | 'serverNow'>, receivedAtMs: number, nowMs: number): number {
  const end = Date.parse(a.endsAt);
  const serverNow = Date.parse(a.serverNow);
  if (!Number.isFinite(end) || !Number.isFinite(serverNow)) return 0;
  return Math.max(0, end - (serverNow + (nowMs - receivedAtMs)));
}

/** Whatnot shows the clock as 00:07. */
export function formatAuctionClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "$12" for whole dollars, "$12.50" otherwise (bid buttons). */
export function formatBid(cents: number): string {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-US')}` : `$${(cents / 100).toFixed(2)}`;
}

/** The line above the product row: "ana is winning!", "You're winning!", "ana won!". */
export function auctionStatusLine(a: LiveAuction): string | null {
  if (a.status === 'open') {
    if (a.youAreLeading) return "You're winning!";
    return a.leaderName ? `${a.leaderName} is winning!` : null;
  }
  if (a.status === 'sold') return a.youWon ? 'You won!' : `${a.winnerName ?? 'Someone'} won!`;
  if (a.status === 'unsold') return 'No bids';
  return null;
}

/** Keeps the newest snapshot of an auction (socket events and polls can arrive out of order). */
export function newerAuction(prev: LiveAuction | null, next: LiveAuction | null): LiveAuction | null {
  if (!next) return null;
  if (!prev || prev.id !== next.id) return next;
  const rank = (a: LiveAuction) => (a.status === 'open' ? 0 : 1);
  if (rank(next) < rank(prev)) return prev;
  if (rank(next) === rank(prev) && next.bidCount < prev.bidCount) return prev;
  // `payable` / `paid` only come from GET; keep them across socket updates.
  return { ...next, payable: next.payable ?? prev.payable, paid: next.paid ?? prev.paid };
}

/**
 * Socket events carry no viewer-specific fields; derive them from the
 * viewer's id. `payable` (inside the pay window, unpaid) only comes from GET,
 * so a fresh win is assumed payable until the next poll says otherwise.
 */
export function withViewer(a: LiveAuction, viewerId: string | null | undefined): LiveAuction {
  const me = !!viewerId && a.leaderUserId === viewerId;
  const youWon = a.status === 'sold' && me;
  return {
    ...a,
    youAreLeading: a.status === 'open' && me,
    youWon,
    payable: youWon ? (a.payable ?? !a.paid) : false,
    isHost: !!viewerId && a.sellerId === viewerId,
  };
}
