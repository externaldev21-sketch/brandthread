import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockServiceRequest = vi.fn();
vi.mock('../lib/serviceConfig', () => ({ serviceRequest: (...args: any[]) => mockServiceRequest(...args) }));

import { createRfq, getRfqs, getRfq, cancelRfq, closeRfq, getRfqTargetManufacturers } from './manufacturerRfq';

const VALID_ID = 'b7d2c2d0-a3ae-4d65-90e4-d777f1f1bca1';
const VALID_ID_2 = 'c1a2b3c4-d5e6-4f78-9abc-def012345678';

beforeEach(() => { mockServiceRequest.mockReset(); });

describe('createRfq', () => {
  it('validates before calling the network', async () => {
    await expect(createRfq({ garmentType: '', quantity: 100, manufacturerIds: [VALID_ID] })).rejects.toThrow();
    await expect(createRfq({ garmentType: 'Tee', quantity: 0, manufacturerIds: [VALID_ID] })).rejects.toThrow();
    await expect(createRfq({ garmentType: 'Tee', quantity: 100, manufacturerIds: [] })).rejects.toThrow();
    await expect(createRfq({ garmentType: 'Tee', quantity: 100, manufacturerIds: Array(11).fill(VALID_ID) })).rejects.toThrow();
    await expect(createRfq({ garmentType: 'Tee', quantity: 100, manufacturerIds: ['not-a-uuid'] })).rejects.toThrow();
    expect(mockServiceRequest).not.toHaveBeenCalled();
  });

  it('posts a valid RFQ and maps the response', async () => {
    mockServiceRequest.mockResolvedValue({
      id: 'rfq-1', sellerId: 'seller-1', garmentType: 'Tee', category: 'Cut & Sew', description: '',
      quantity: 500, targetPriceCents: 400, deadline: null, fileIds: [], status: 'matched',
      manufacturersCount: 2, quotesReceivedCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const rfq = await createRfq({ garmentType: 'Tee', category: 'Cut & Sew', quantity: 500, targetPriceCents: 400, manufacturerIds: [VALID_ID, VALID_ID_2] });
    expect(mockServiceRequest).toHaveBeenCalledWith('/api/seller-hub/rfqs', expect.objectContaining({ method: 'POST' }));
    expect(rfq.manufacturersCount).toBe(2);
    expect(rfq.status).toBe('matched');
  });
});

describe('getRfqs / getRfq', () => {
  it('maps the RFQ list', async () => {
    mockServiceRequest.mockResolvedValue([{
      id: 'rfq-1', sellerId: 's', garmentType: 'Tee', category: '', description: '', quantity: 100,
      targetPriceCents: null, deadline: null, fileIds: [], status: 'open', manufacturersCount: 3, quotesReceivedCount: 1,
      createdAt: '', updatedAt: '',
    }]);
    const rfqs = await getRfqs();
    expect(rfqs).toHaveLength(1);
    expect(rfqs[0].quotesReceivedCount).toBe(1);
  });

  it('maps RFQ detail with per-manufacturer quotes', async () => {
    mockServiceRequest.mockResolvedValue({
      id: 'rfq-1', sellerId: 's', garmentType: 'Tee', category: '', description: '', quantity: 100,
      targetPriceCents: null, deadline: null, fileIds: [], status: 'matched', manufacturersCount: 1, quotesReceivedCount: 1,
      createdAt: '', updatedAt: '',
      quotes: [{
        id: 'q1', sellerId: 's', manufacturerId: VALID_ID, rfqId: 'rfq-1', productName: 'Tee', quantity: 100,
        status: 'quoted', quotedPriceCents: 800, quotedTurnaround: '20 days', quoteValidUntil: null, counteroffer: null,
        notes: null, manufacturerName: 'Acme Factory', manufacturerCountry: 'Portugal', manufacturerIsVerified: true,
        createdAt: '', updatedAt: '',
      }],
    });
    const detail = await getRfq('rfq-1');
    expect(detail?.quotes).toHaveLength(1);
    expect(detail?.quotes[0].manufacturerName).toBe('Acme Factory');
  });

  it('returns undefined when the RFQ does not resolve', async () => {
    mockServiceRequest.mockResolvedValue(undefined);
    expect(await getRfq('missing')).toBeUndefined();
  });
});

describe('cancelRfq / closeRfq', () => {
  it('PATCHes the expected status', async () => {
    mockServiceRequest.mockResolvedValue({ id: 'rfq-1', status: 'cancelled', fileIds: [], quantity: 1, createdAt: '', updatedAt: '' });
    await cancelRfq('rfq-1');
    expect(mockServiceRequest).toHaveBeenCalledWith('/api/seller-hub/rfqs/rfq-1', { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });

    mockServiceRequest.mockResolvedValue({ id: 'rfq-1', status: 'closed', fileIds: [], quantity: 1, createdAt: '', updatedAt: '' });
    await closeRfq('rfq-1');
    expect(mockServiceRequest).toHaveBeenCalledWith('/api/seller-hub/rfqs/rfq-1', { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) });
  });
});

describe('getRfqTargetManufacturers', () => {
  it('maps active manufacturers for the RFQ picker', async () => {
    mockServiceRequest.mockResolvedValue([{
      id: VALID_ID, businessName: 'Acme Factory', country: 'Portugal', specialty: 'Knitwear', moq: 50,
      priceRange: '$4-$8', bulkTurnaround: '20 days', photos: ['https://x/1.jpg'], verifiedAt: '2026-01-01T00:00:00.000Z',
    }]);
    const rows = await getRfqTargetManufacturers();
    expect(rows[0].isVerified).toBe(true);
    expect(rows[0].photo).toBe('https://x/1.jpg');
  });
});
