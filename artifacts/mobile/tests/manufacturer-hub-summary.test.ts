import { describe, expect, it } from 'vitest';
import { buildMyManufacturers } from '../lib/manufacturerHubSummary';
import type {
  Manufacturer, ManufacturerConversation, ManufacturerRelationship, ProductionOrder, Quote, QuoteRequest, Sample,
} from '../services/manufacturerTypes';

const rel = (id: string, overrides: Partial<ManufacturerRelationship> = {}): ManufacturerRelationship => ({
  id: `rel-${id}`, sellerId: 's', manufacturerId: id, status: 'connected', activeProductIds: [], unreadCount: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  manufacturer: {
    id, businessName: `Factory ${id}`, country: 'Portugal', city: 'Porto', specialty: 'Knitwear', yearsInBusiness: 3,
    moq: 100, timeZone: null, isPublicDirectory: true, isVerified: true, payoutReady: true, photo: null,
  },
  ...overrides,
});
const request = (id: string, manufacturerId: string, status: QuoteRequest['status'], extra: Partial<QuoteRequest> = {}) =>
  ({ id, manufacturerId, status, isDraft: false, updatedAt: '2026-02-01T00:00:00Z', ...extra }) as QuoteRequest;
const sample = (id: string, manufacturerId: string, status: Sample['status'], extra: Partial<Sample> = {}) =>
  ({ id, manufacturerId, status, orderType: 'sample', updatedAt: '2026-02-02T00:00:00Z', ...extra }) as Sample;

describe('buildMyManufacturers', () => {
  it('folds relationships, quotes and samples into one row with a short status line', () => {
    const rows = buildMyManufacturers({
      relationships: [rel('a')],
      quoteRequests: [request('q1', 'a', 'sent'), request('q2', 'a', 'draft'), request('q3', 'a', 'declined')],
      samples: [sample('s1', 'a', 'in_development'), sample('s2', 'a', 'shipped'), sample('s3', 'a', 'approved')],
    });
    expect(rows).toEqual([expect.objectContaining({
      manufacturerId: 'a', name: 'Factory a', statusLine: 'Quote pending · 2 samples', needsAttention: false,
    })]);
  });

  it('counts a quoted request once, as received, and flags it for the seller', () => {
    const quote = { id: 'qt', quoteRequestId: 'q1', manufacturerId: 'a', status: 'quote_received', receivedAt: '2026-03-01T00:00:00Z' } as Quote;
    const [row] = buildMyManufacturers({ relationships: [rel('a')], quoteRequests: [request('q1', 'a', 'sent')], quotes: [quote] });
    expect(row.statusLine).toBe('Quote received');
    expect(row.needsAttention).toBe(true);
  });

  it('includes manufacturers known only from a thread, a sample or an order, named from any source', () => {
    const conv = { id: 't', manufacturerId: 'b', manufacturerName: 'Thread Only', unreadCount: 2, createdAt: '2026-01-05T00:00:00Z' } as ManufacturerConversation;
    const order = { id: 'o', manufacturerId: 'c', status: 'active', manufacturerName: 'Order Only', updatedAt: '2026-01-06T00:00:00Z' } as ProductionOrder;
    const profile = { id: 'd', name: 'Profile Name', city: 'Austin', country: 'USA' } as Manufacturer;
    const rows = buildMyManufacturers({
      conversations: [conv],
      orders: [order],
      // The bulk order also comes back from the samples endpoint — not a sample.
      samples: [sample('o', 'c', 'in_development', { orderType: 'bulk' }), sample('s', 'd', 'requested')],
      profiles: [profile],
    });
    expect(rows.map((row) => [row.name, row.statusLine])).toEqual([
      ['Thread Only', '2 unread'],
      ['Profile Name', '1 sample'],
      ['Order Only', '1 active order'],
    ]);
  });

  it('falls back to the location when nothing is open, skips archived and nameless rows', () => {
    const rows = buildMyManufacturers({
      relationships: [rel('a'), rel('z', { status: 'archived' })],
      quoteRequests: [request('q', 'unknown', 'sent')],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].statusLine).toBe('Porto, Portugal');
  });

  it('caps the status line at three facts', () => {
    const [row] = buildMyManufacturers({
      relationships: [rel('a', { awaitingPayment: 1, activeOrders: 2, unreadCount: 4 })],
      quoteRequests: [request('q', 'a', 'viewed')],
      samples: [sample('s', 'a', 'review_needed')],
    });
    expect(row.statusLine).toBe('Quote pending · Payment due · Sample to review');
  });
});
