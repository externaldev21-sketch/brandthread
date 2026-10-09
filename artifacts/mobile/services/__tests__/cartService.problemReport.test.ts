/**
 * Buyer "Report a problem" used to be stored on the device only and never
 * sent. It now files a support ticket (POST /api/support/problem-reports)
 * and keeps the local list as a cache; preview/demo/signed-out sessions keep
 * the old local-only behavior and never call the protected endpoint.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  state: { token: true, demo: false, sellerPreview: false, buyerPreview: false, fail: false },
  calls: [] as { path: string; body: any }[],
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { h.storage.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { h.storage.delete(k); }),
    multiRemove: vi.fn(async (ks: string[]) => { ks.forEach(k => h.storage.delete(k)); }),
    getAllKeys: vi.fn(async () => [...h.storage.keys()]),
  },
}));
vi.mock('@/lib/serviceConfig', () => ({
  hasServiceToken: vi.fn(async () => h.state.token),
  serviceRequest: vi.fn(async (path: string, options: RequestInit = {}) => {
    h.calls.push({ path, body: JSON.parse(String(options.body ?? '{}')) });
    if (h.state.fail) throw new Error('network down');
    return { ticket: { id: 'ticket-1', status: 'open' }, duplicate: false };
  }),
}));
vi.mock('@/lib/devPreview', () => ({
  isPreviewDemoMode: () => h.state.demo,
  isSellerDevPreview: () => h.state.sellerPreview,
  isBuyerDevPreview: () => h.state.buyerPreview,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@/lib/marketingPixels', () => ({ trackAndRelayConversionEvent: vi.fn(() => false) }));

import { createProblemReport, initCartService } from '../cartService';

const UID = 'buyer-problems';
const ORDER = '3f1c1a2e-1111-4000-8000-000000000001';
const problemsKey = `bt:buyer:${UID}:problems:v1`;
const stored = () => JSON.parse(h.storage.get(problemsKey) ?? '[]');

const params = (over: Partial<Parameters<typeof createProblemReport>[0]> = {}) => ({
  orderId: ORDER,
  orderNumber: 'BT-1001',
  type: 'damaged_product' as const,
  description: 'Arrived torn',
  evidenceUris: ['file:///photo.jpg', 'https://cdn.example/p.jpg'],
  contactedSeller: true,
  ...over,
});

beforeEach(() => {
  h.storage.clear();
  h.calls.length = 0;
  Object.assign(h.state, { token: true, demo: false, sellerPreview: false, buyerPreview: false, fail: false });
  initCartService(null);
  initCartService(UID);
});

describe('createProblemReport', () => {
  it('sends the report to the server and keeps it in the local cache', async () => {
    const report = await createProblemReport(params());
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].path).toBe('/api/support/problem-reports');
    expect(h.calls[0].body).toEqual({
      clientReportId: report.id,
      orderId: ORDER,
      orderNumber: 'BT-1001',
      type: 'damaged_product',
      description: 'Arrived torn',
      evidenceUrls: ['https://cdn.example/p.jpg'],
      localEvidenceCount: 1,
      contactedSeller: true,
    });
    expect(report.serverTicketId).toBe('ticket-1');
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ id: report.id, serverTicketId: 'ticket-1', status: 'open' });
  });

  it('surfaces a failed send, and the retry reuses the same report id (server dedupes)', async () => {
    h.state.fail = true;
    await expect(createProblemReport(params())).rejects.toThrow('network down');
    expect(stored()).toHaveLength(1);
    const firstId = stored()[0].id;

    h.state.fail = false;
    const report = await createProblemReport(params());
    expect(report.id).toBe(firstId);
    expect(h.calls.map(c => c.body.clientReportId)).toEqual([firstId, firstId]);
    expect(stored()).toHaveLength(1);
    expect(stored()[0].serverTicketId).toBe('ticket-1');
  });

  it('omits a non-uuid order id (sent as a general report)', async () => {
    await createProblemReport(params({ orderId: 'local_order_1' }));
    expect(h.calls[0].body.orderId).toBeUndefined();
  });

  it.each([
    ['signed out', { token: false }],
    ['demo mode', { demo: true }],
    ['seller dev preview', { sellerPreview: true }],
    ['buyer dev preview', { buyerPreview: true }],
  ])('stays local-only when %s', async (_label, state) => {
    Object.assign(h.state, state);
    const report = await createProblemReport(params());
    expect(h.calls).toEqual([]);
    expect(report.serverTicketId).toBeUndefined();
    expect(stored()).toHaveLength(1);
  });
});
