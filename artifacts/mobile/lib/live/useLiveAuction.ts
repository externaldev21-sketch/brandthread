/**
 * The auction shown in a live (Whatnot-style bottom card).
 *
 *  - buyer-live.tsx feeds socket events in (`handleEvent`) and polls only as
 *    a backfill; app/live.tsx has no socket, so it polls while the page is
 *    visible (`poll: true`).
 *  - `demo` (web preview `&demo=1` only) runs a local auction with a few
 *    scripted bidders so the card, the custom-bid sheet and the win state are
 *    reviewable without a backend. Never used for a real account.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '@/lib/safety';
import { fetchActiveAuction, placeLiveBid } from '@/services/liveAuctionsService';
import { newerAuction, nextBidAbove, withViewer, type LiveAuction } from './liveAuction';

const POLL_MS = 1500;

export interface LiveAuctionState {
  auction: LiveAuction | null;
  /** Device time the current snapshot arrived (pairs with auction.serverNow). */
  receivedAt: number;
  bid: (amountCents: number) => Promise<string | null>;
  handleEvent: (event: { type: string; auction?: LiveAuction }) => void;
  refresh: () => void;
}

export function useLiveAuction(streamId: string | null | undefined, opts: {
  enabled: boolean; viewerId?: string | null; poll?: boolean; demo?: { productName: string; imageUri?: string | null; priceCents: number } | null;
}): LiveAuctionState {
  const { enabled, viewerId, poll = false } = opts;
  // Callers build `demo` inline; key it by content so a re-render doesn't restart the demo.
  const demoKey = opts.demo ? `${opts.demo.productName}|${opts.demo.priceCents}|${opts.demo.imageUri ?? ''}` : null;
  const demoInputRef = useRef(opts.demo ?? null);
  demoInputRef.current = opts.demo ?? null;
  const demo = demoKey ? demoInputRef.current : null;
  const [auction, setAuction] = useState<LiveAuction | null>(null);
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const viewerRef = useRef(viewerId);
  viewerRef.current = viewerId;

  const accept = useCallback((next: LiveAuction | null) => {
    setAuction(prev => {
      const merged = newerAuction(prev, next ? withViewer(next, viewerRef.current) : null);
      if (merged !== prev) setReceivedAt(Date.now());
      return merged;
    });
  }, []);

  const refresh = useCallback(() => {
    if (!enabled || !streamId || demo) return;
    fetchActiveAuction(streamId)
      .then(r => accept(r.enabled ? r.auction : null))
      .catch(() => {});
  }, [accept, demoKey, enabled, streamId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAuction(null);
    if (!enabled || !streamId || demo) return undefined;
    refresh();
    if (!poll) return undefined;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [demoKey, enabled, poll, refresh, streamId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEvent = useCallback((event: { type: string; auction?: LiveAuction }) => {
    if (!enabled || !event.auction) return;
    if (event.type === 'auction_started' || event.type === 'auction_bid' || event.type === 'auction_ended') accept(event.auction);
  }, [accept, enabled]);

  // ─── Demo (preview only) ───────────────────────────────────────────────────
  const demoRef = useRef<LiveAuction | null>(null);
  useEffect(() => {
    const demo = demoInputRef.current;
    if (!enabled || !demoKey || !demo) return undefined;
    const startedAt = Date.now();
    const a: LiveAuction = {
      id: 'preview-auction', streamId: String(streamId ?? 'preview'), sellerId: 'preview-host', productId: 'preview-product',
      variantId: null, productName: demo.productName, imageUri: demo.imageUri ?? null,
      startingBidCents: 2_000, currentBidCents: 4_200, nextMinBidCents: nextBidAbove(4_200), incrementCents: 200, bidCount: 7,
      leaderUserId: 'preview-bidder', leaderName: 'noor.k', suddenDeath: false,
      endsAt: new Date(startedAt + 24_000).toISOString(), serverNow: new Date(startedAt).toISOString(),
      status: 'open', winnerName: null,
    };
    demoRef.current = a;
    setReceivedAt(startedAt);
    setAuction(withViewer(a, viewerRef.current ?? 'preview-you'));
    const settle = setInterval(() => {
      const cur = demoRef.current;
      if (!cur || cur.status !== 'open' || Date.parse(cur.endsAt) > Date.now()) return;
      const done: LiveAuction = { ...cur, status: 'sold', winnerName: cur.leaderName, serverNow: new Date().toISOString() };
      demoRef.current = done;
      setReceivedAt(Date.now());
      setAuction(withViewer(done, viewerRef.current ?? 'preview-you'));
    }, 250);
    return () => clearInterval(settle);
  }, [demoKey, enabled, streamId]);

  const bid = useCallback(async (amountCents: number): Promise<string | null> => {
    if (!auction || !streamId) return null;
    if (demo) {
      const cur = demoRef.current;
      if (!cur || cur.status !== 'open') return 'This auction has ended.';
      if (amountCents < cur.nextMinBidCents) return 'Someone bid first. Bid again.';
      const now = Date.now();
      const endsAt = Math.max(Date.parse(cur.endsAt), now + 10_000);
      const next: LiveAuction = {
        ...cur, currentBidCents: amountCents, nextMinBidCents: nextBidAbove(amountCents), bidCount: cur.bidCount + 1,
        leaderUserId: viewerRef.current ?? 'preview-you', leaderName: 'you', endsAt: new Date(endsAt).toISOString(), serverNow: new Date(now).toISOString(),
      };
      demoRef.current = next;
      setReceivedAt(now);
      setAuction(withViewer(next, viewerRef.current ?? 'preview-you'));
      return null;
    }
    try {
      accept(await placeLiveBid(streamId, auction.id, amountCents));
      return null;
    } catch (e) {
      refresh();
      return apiErrorMessage(e, 'Your bid didn’t go through. Try again.');
    }
  }, [accept, auction, demoKey, refresh, streamId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { auction, receivedAt, bid, handleEvent, refresh };
}
