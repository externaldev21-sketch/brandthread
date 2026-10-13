import { describe, expect, it } from 'vitest';
import {
  auctionRemainingMs, auctionStatusLine, formatAuctionClock, formatBid, minIncrementCents, newerAuction, nextBidAbove,
  prevBid, withViewer, type LiveAuction,
} from '@/lib/live/liveAuction';

const base: LiveAuction = {
  id: 'a1', streamId: 's1', sellerId: 'host', productId: 'p1', variantId: 'v1', productName: 'Archive Coat', imageUri: null,
  startingBidCents: 500, currentBidCents: 1_200, nextMinBidCents: 1_300, incrementCents: 100, bidCount: 3,
  leaderUserId: 'ana', leaderName: 'ana', suddenDeath: false,
  endsAt: '2026-10-13T12:00:10.000Z', serverNow: '2026-10-13T12:00:00.000Z', status: 'open', winnerName: null,
};

describe('bid ladder (mirrors the server)', () => {
  it('increments by band', () => {
    expect(minIncrementCents(1_999)).toBe(100);
    expect(minIncrementCents(2_000)).toBe(200);
    expect(minIncrementCents(100_000)).toBe(2_500);
  });
  it('steps the custom bid up and down without going under the minimum', () => {
    expect(nextBidAbove(1_900)).toBe(2_000);
    expect(nextBidAbove(2_000)).toBe(2_200);
    expect(prevBid(2_200, 1_300)).toBe(2_000);
    expect(prevBid(1_300, 1_300)).toBe(1_300);
    expect(prevBid(1_400, 1_300)).toBe(1_300);
  });
});

describe('clock', () => {
  it('counts from the server clock, not the device clock', () => {
    const received = 1_000_000;
    expect(auctionRemainingMs(base, received, received)).toBe(10_000);
    expect(auctionRemainingMs(base, received, received + 4_000)).toBe(6_000);
    expect(auctionRemainingMs(base, received, received + 60_000)).toBe(0);
  });
  it('reads like Whatnot (00:06) and bids read as whole dollars', () => {
    expect(formatAuctionClock(6_000)).toBe('00:06');
    expect(formatAuctionClock(5_100)).toBe('00:06');
    expect(formatAuctionClock(61_000)).toBe('01:01');
    expect(formatBid(4_400)).toBe('$44');
    expect(formatBid(4_450)).toBe('$44.50');
  });
});

describe('viewer state', () => {
  it('derives winning / won / host from the viewer id', () => {
    expect(withViewer(base, 'ana').youAreLeading).toBe(true);
    expect(withViewer(base, 'ben').youAreLeading).toBe(false);
    expect(withViewer(base, 'host').isHost).toBe(true);
    const sold = { ...base, status: 'sold' as const, winnerName: 'ana' };
    expect(withViewer(sold, 'ana')).toMatchObject({ youWon: true, payable: true });
    expect(withViewer({ ...sold, paid: true }, 'ana')).toMatchObject({ youWon: true, payable: false });
    expect(withViewer(sold, 'ben')).toMatchObject({ youWon: false, payable: false });
  });
  it('status line: "<name> is winning!", "You\'re winning!", "<name> won!"', () => {
    expect(auctionStatusLine(withViewer(base, 'ben'))).toBe('ana is winning!');
    expect(auctionStatusLine(withViewer(base, 'ana'))).toBe("You're winning!");
    expect(auctionStatusLine(withViewer({ ...base, status: 'sold', winnerName: 'ana' }, 'ben'))).toBe('ana won!');
    expect(auctionStatusLine(withViewer({ ...base, status: 'sold', winnerName: 'ana' }, 'ana'))).toBe('You won!');
    expect(auctionStatusLine({ ...base, status: 'unsold', leaderName: null })).toBe('No bids');
  });
  it('ignores stale snapshots (an older bid count, or open after ended)', () => {
    const newer = { ...base, bidCount: 4, currentBidCents: 1_300 };
    expect(newerAuction(newer, base)).toBe(newer);
    const ended = { ...base, status: 'sold' as const };
    expect(newerAuction(ended, base)).toBe(ended);
    expect(newerAuction(base, newer)?.bidCount).toBe(4);
    expect(newerAuction(base, { ...base, id: 'a2' })?.id).toBe('a2');
    expect(newerAuction(base, null)).toBeNull();
  });
});
