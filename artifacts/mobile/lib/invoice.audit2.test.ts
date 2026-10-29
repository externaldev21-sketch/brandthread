/**
 * The invoice date was the UTC calendar day (toISOString().slice(0, 10)), so
 * an order placed at 9:30 pm in New York printed as the next day.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-print', () => ({ printToFileAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(), shareAsync: vi.fn() }));

import { buildInvoiceHtml, type InvoiceInput } from './invoice';

const base: InvoiceInput = {
  orderNumber: 'BT-1', issuedAt: '2026-09-02T01:30:00Z', sellerName: 'Acme',
  billTo: [], shipTo: [], items: [],
  subtotalCents: 0, discountCents: 0, shippingCents: 0, taxCents: 0, totalCents: 0, paidCents: 0, refundedCents: 0, currency: 'USD',
};

let prevTz: string | undefined;
beforeEach(() => { prevTz = process.env.TZ; process.env.TZ = 'America/New_York'; });
afterEach(() => { if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz; });

describe('buildInvoiceHtml issued date', () => {
  it('prints the local calendar day of an evening order, not the UTC day', () => {
    const html = buildInvoiceHtml(base);
    expect(html).toContain('2026-09-01');
    expect(html).not.toContain('2026-09-02');
  });
});
