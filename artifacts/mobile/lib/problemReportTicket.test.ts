import { describe, expect, it } from 'vitest';
import { buildProblemReportTicket } from './problemReportTicket';

const diagnostics = { appVersion: '1.0.0', buildNumber: '42', platform: 'ios', osVersion: '18.1' };

describe('buildProblemReportTicket', () => {
  it('files an app problem as a bug with device details attached', () => {
    const t = buildProblemReportTicket({
      type: 'other', description: '  The feed froze  ', contactedSeller: false,
      email: 'jordan@example.com', name: 'Jordan', diagnostics,
    });
    expect(t).toEqual({
      subject: 'Other',
      body: 'The feed froze',
      category: 'bug',
      email: 'jordan@example.com',
      name: 'Jordan',
      diagnostics,
    });
  });

  it('includes the order on an order problem', () => {
    const t = buildProblemReportTicket({
      type: 'damaged_product', description: 'Box was crushed', contactedSeller: true,
      orderId: 'ord_1', orderNumber: 'BT-1001',
      email: 'jordan@example.com', name: 'Jordan', diagnostics,
    });
    expect(t.subject).toBe('Damaged product · Order BT-1001');
    expect(t.body).toBe('Box was crushed\n\nOrder: BT-1001\nContacted seller: Yes');
    expect(t.category).toBe('general');
    expect(t.diagnostics).toEqual({ ...diagnostics, orderId: 'ord_1' });
  });
});
