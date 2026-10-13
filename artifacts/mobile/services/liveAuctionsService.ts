/**
 * Live auctions API (routes/live-auctions.ts). Behind the `live_auctions`
 * flag — callers only use this when useFeatureFlag('live_auctions') is on.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import type { LiveAuction } from '@/lib/live/liveAuction';

const base = (streamId: string) => `/api/live/${encodeURIComponent(streamId)}/auctions`;

export const fetchActiveAuction = (streamId: string) =>
  serviceRequest<{ enabled: boolean; auction: LiveAuction | null }>(`${base(streamId)}/active`, {}, false);

export const startLiveAuction = (streamId: string, input: {
  productId: string; startingBidCents: number; durationSeconds: number; suddenDeath: boolean;
}) =>
  serviceRequest<{ auction: LiveAuction }>(base(streamId), { method: 'POST', body: JSON.stringify(input) }, false)
    .then(r => r.auction);

export const placeLiveBid = (streamId: string, auctionId: string, amountCents: number) =>
  serviceRequest<{ auction: LiveAuction }>(
    `${base(streamId)}/${encodeURIComponent(auctionId)}/bid`,
    { method: 'POST', body: JSON.stringify({ amountCents }) },
    false,
  ).then(r => r.auction);

export const cancelLiveAuction = (streamId: string, auctionId: string) =>
  serviceRequest<{ auction: LiveAuction }>(
    `${base(streamId)}/${encodeURIComponent(auctionId)}/cancel`, { method: 'POST', body: '{}' }, false,
  ).then(r => r.auction);
