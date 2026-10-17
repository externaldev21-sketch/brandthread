/**
 * Buyer account dead ends (items 108-112, 119, 122): pure helpers plus
 * source contracts for the screens' error / delivery paths.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequestMock } = vi.hoisted(() => ({ serviceRequestMock: vi.fn() }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: serviceRequestMock }));
vi.mock('@/services/cartTypes', () => ({ RETURN_REASON_OPTIONS: [{ key: 'wrong_size', label: 'Wrong size' }] }));
vi.mock('@/lib/money', () => ({ formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}` }));

import { buildOrderTracking, carrierTrackingUrl, trackingStatusText } from '@/lib/orderTracking';
import { giftCardBalanceCheckSummary } from '@/lib/giftCards';
import { activityDateLabel, activitySnippet, searchCountLabel } from '@/lib/yourActivity';
import { getBuyerReturns } from '@/services/buyerReturnsService';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('item 108: buyer returns service', () => {
  beforeEach(() => serviceRequestMock.mockReset());

  it('loads GET /api/returns/buyer and adapts rows newest first', async () => {
    serviceRequestMock.mockResolvedValue([
      { id: 'r1', orderId: 'o1', orderNumber: 'BT-1', status: 'pending', reason: 'wrong_size', createdAt: '2026-10-01T00:00:00.000Z', sellerName: 'Nova' },
      { id: 'r2', orderId: 'o2', orderNumber: 'BT-2', status: 'refunded', reason: 'other', refundAmountCents: 1200, createdAt: '2026-10-05T00:00:00.000Z' },
    ]);
    const rows = await getBuyerReturns();
    expect(serviceRequestMock).toHaveBeenCalledWith('/api/returns/buyer');
    expect(rows.map(r => r.id)).toEqual(['r2', 'r1']);
    expect(rows[0]).toMatchObject({ status: 'refunded', refundAmountCents: 1200 });
    expect(rows[1]).toMatchObject({ sellerName: 'Nova', orderNumber: 'BT-1' });
  });

  it('throws on a failed or malformed response instead of returning []', async () => {
    serviceRequestMock.mockRejectedValueOnce(new Error('offline'));
    await expect(getBuyerReturns()).rejects.toThrow('offline');
    serviceRequestMock.mockResolvedValueOnce({ error: 'nope' });
    await expect(getBuyerReturns()).rejects.toThrow();
  });

  it('My Orders renders the Returns tab from that service and opens return-detail', () => {
    const src = read('app/(buyer)/orders.tsx');
    expect(src).toContain("import { getBuyerReturns } from '@/services/buyerReturnsService'");
    expect(src).not.toContain('orders.filter(o => o.hasReturnRequest)');
    expect(src).toContain("'/return-detail?returnId='");
    expect(src).toContain("Couldn't load your returns.");
  });
});

describe('item 109: order tracking view', () => {
  it('uses the server carrier link and scan history for the primary shipment', () => {
    const view = buildOrderTracking({
      id: 'o1', orderNumber: 'BT-9', status: 'shipped', carrier: 'UPS', trackingNumber: '1Z999', trackingStatus: 'in_transit',
      delivery: {
        trackingUrl: 'https://www.ups.com/track?tracknum=1Z999', estimatedDelivery: '2026-10-20T00:00:00.000Z',
        events: [{ status: 'in_transit', description: 'Departed facility', location: 'Austin, TX', at: '2026-10-16T10:00:00.000Z' }],
        shipments: [],
      },
    });
    expect(view.shipments).toEqual([expect.objectContaining({
      trackingNumber: '1Z999', carrier: 'UPS', statusLabel: 'In transit', url: 'https://www.ups.com/track?tracknum=1Z999',
    })]);
    expect(view.events).toHaveLength(1);
    expect(view.estimatedDelivery).toBe('2026-10-20T00:00:00.000Z');
  });

  it('lists every split shipment, building a carrier URL for the secondary ones', () => {
    const view = buildOrderTracking({
      id: 'o1', carrier: 'UPS', trackingNumber: 'A1', trackingStatus: 'delivered',
      delivery: {
        trackingUrl: 'javascript:alert(1)',
        shipments: [
          { trackingNumber: 'A1', carrier: 'UPS', trackingStatus: 'delivered', deliveredAt: '2026-10-10T00:00:00.000Z' },
          { trackingNumber: 'B2', carrier: 'USPS', trackingStatus: null, deliveredAt: null },
        ],
      },
    });
    expect(view.shipments.map(s => s.trackingNumber)).toEqual(['A1', 'B2']);
    // Non-http server URLs are never used.
    expect(view.shipments[0].url).toBe('https://www.ups.com/track?tracknum=A1');
    expect(view.shipments[1].url).toBe('https://tools.usps.com/go/TrackConfirmAction?tLabels=B2');
    expect(view.shipments[1].statusLabel).toBe('Awaiting carrier scan');
  });

  it('has no shipments before tracking exists', () => {
    expect(buildOrderTracking({ id: 'o1', status: 'processing' }).shipments).toEqual([]);
  });

  it('falls back to a tracking search for unknown carriers', () => {
    expect(carrierTrackingUrl('Acme Freight', 'X 1')).toBe('https://www.google.com/search?q=X%201+tracking');
    expect(trackingStatusText('out_for_delivery')).toBe('Out for delivery');
  });

  it('Track Shipment opens the tracking screen, not order details', () => {
    const src = read('app/(buyer)/orders.tsx');
    expect(src).toContain("'/buyer-order-tracking?id='");
    expect(src).toContain('onTrack(order.id)');
    expect(read('app/_layout.tsx')).toContain('name="buyer-order-tracking"');
  });
});

describe('item 110: Your Activity', () => {
  it('formats rows', () => {
    expect(activitySnippet('  \nfirst line\nsecond')).toBe('first line');
    expect(activitySnippet('x'.repeat(80), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(activityDateLabel('nope')).toBe('');
    expect(activityDateLabel('2026-03-04T12:00:00.000Z', new Date('2026-10-17T00:00:00.000Z'))).toBe('Mar 4');
    expect(searchCountLabel(30, 30)).toBe('30+');
    expect(searchCountLabel(4, 30)).toBe('4');
  });

  it('loads likes, comments and searches from the server and never promises time spent', () => {
    const src = read('app/buyer-your-activity.tsx');
    expect(src).toContain('api.buyer.activity()');
    expect(src).toContain('api.public.recent(30)');
    expect(src).toContain("'/buyer-search-history'");
    expect(src).not.toMatch(/time-in-app|['"]Time spent/);
    expect(read('app/buyer-settings-detail.tsx')).not.toContain("label: 'Time spent'");
  });
});

describe('item 111: invite code failure', () => {
  it('shows a retry instead of a "------" placeholder and disables share', () => {
    const src = read('app/buyer-invite.tsx');
    expect(src).not.toContain("'------'");
    expect(src).toContain("Couldn't load your invite code");
    expect(src).toContain('disabled={!invite}');
    expect(src).toContain('showToast(INVITE_UNAVAILABLE)');
    expect(src).toContain("Couldn't load your invite stats");
  });
});

describe('item 112: payment methods failure', () => {
  it('renders an error with retry, not "No saved payment methods"', () => {
    const src = read('app/buyer-payment-methods.tsx');
    expect(src).toContain('setLoadError(true)');
    expect(src).toContain("Couldn't load your payment methods.");
    expect(src.indexOf('loadError ?')).toBeLessThan(src.indexOf('title="No saved payment methods"'));
  });
});

describe('item 119: gift card balance check', () => {
  it('summarises a lookup result', () => {
    expect(giftCardBalanceCheckSummary({ balanceCents: 1800, initialCents: 2500, status: 'active', expiresAt: null }, 'Nova'))
      .toBe('$18.00 of $25.00 left at Nova · No expiry');
    expect(giftCardBalanceCheckSummary({ balanceCents: 0, initialCents: 2500, status: 'depleted', expiresAt: null }, ''))
      .toBe('Fully used · $0.00 left at this store');
  });

  it('is wired to POST /api/gift-cards/lookup on the buyer wallet', () => {
    expect(read('lib/api.ts')).toContain("post<{ card: GiftCard; storeName: string }>('/api/gift-cards/lookup', { code })");
    const src = read('app/buyer-gift-cards.tsx');
    expect(src).toContain('api.giftCards.lookup(trimmed)');
    expect(src).toContain('label="Check balance"');
  });
});

describe('item 122: download your data delivers a file', () => {
  it('uses the web-download / share-sheet helper and reports no-share-sheet as an error', () => {
    const src = read('app/buyer-download-data.tsx');
    expect(src).toContain('saveExportFile(');
    expect(src).toContain('setError(EXPORT_NO_SHARE_SHEET)');
    expect(src).not.toContain("Alert.alert('Export ready'");
    // Success screen only after delivery.
    expect(src.indexOf('if (!delivered)')).toBeLessThan(src.indexOf('setRequested(true)'));
  });
});
