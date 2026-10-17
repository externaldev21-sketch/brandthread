import { describe, expect, it, vi } from 'vitest';

const written: { name?: string; content?: unknown; shared?: { uri: string; opts: any } } = {};
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-file-system', () => ({
  Paths: { cache: '/cache' },
  File: class {
    uri: string;
    exists = false;
    constructor(_dir: string, name: string) { this.uri = `file:///cache/${name}`; written.name = name; }
    delete() {}
    create() {}
    write(c: unknown) { written.content = c; }
  },
}));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => true,
  shareAsync: async (uri: string, opts: any) => { written.shared = { uri, opts }; },
}));

import { buildCsv, csvFilename, escapeCsvCell, exportCsvFile } from './csvExport';
import { ordersForExport, ordersToCsv, runBulk, summarizeBulk } from './orderBulk';
import { mapTrackingEvents, resolveTrackingUrl, trackingStatusText } from './sellerOrderTracking';
import { filterRoles, permissionSummary } from './rolesFilter';
import { SELLER_PUSH_GROUPS, categoryValue } from './sellerPushPrefs';
import { activityResourceType, memberLastSeenLabel, relativeTime } from './teamActivity';

describe('CSV export (item 30)', () => {
  it('escapes cells that need quoting', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeCsvCell(null)).toBe('');
    expect(buildCsv(['A', 'B'], [[1, 'x,y']])).toBe('A,B\r\n1,"x,y"\r\n');
  });
  it('names the file by date', () => {
    expect(csvFilename('orders', new Date(2026, 9, 7))).toBe('orders-2026-10-07.csv');
  });
  it('writes a real .csv file and opens the share sheet with it', async () => {
    const ok = await exportCsvFile('orders', 'A\r\n1\r\n', 'Export orders');
    expect(ok).toBe(true);
    expect(written.name).toMatch(/^orders-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(written.content).toBe('﻿A\r\n1\r\n');
    expect(written.shared?.uri).toMatch(/\.csv$/);
    expect(written.shared?.opts).toMatchObject({ mimeType: 'text/csv', dialogTitle: 'Export orders' });
  });
});

const order = (id: string, extra: Record<string, unknown> = {}) => ({
  id, orderNumber: `#${id}`, createdAt: '2026-01-01T00:00:00Z', status: 'pending', paymentStatus: 'paid',
  customer: { name: 'Ann, B', email: 'a@b.c' }, payment: { totalCents: 1250 }, lineItems: [{}], ...extra,
});

describe('orders export + bulk actions (items 29, 57)', () => {
  it('exports only the selected orders when there is a selection', () => {
    const all = [order('1'), order('2'), order('3')];
    expect(ordersForExport(all, []).map(o => o.id)).toEqual(['1', '2', '3']);
    expect(ordersForExport(all, ['3', '1']).map(o => o.id)).toEqual(['1', '3']);
  });
  it('builds an order CSV with escaped customer names and tracking', () => {
    const csv = ordersToCsv([order('1', { shipments: [{ carrier: 'UPS', trackingNumber: '1Z' }] })], c => `$${(c / 100).toFixed(2)}`);
    const [header, row] = csv.trim().split('\r\n');
    expect(header).toBe('Order #,Customer,Email,Date,Status,Payment,Fulfillment,Items,Total,Carrier,Tracking');
    expect(row).toContain('"Ann, B"');
    expect(row).toContain('$12.50,UPS,1Z');
  });
  it('runs every order and reports per-order failures', async () => {
    const result = await runBulk(['a', 'b', 'c'], async id => { if (id === 'b') throw new Error('Already shipped'); }, {
      label: id => `#${id}`,
    });
    expect(result.succeeded).toEqual(['a', 'c']);
    expect(result.failed).toEqual([{ id: 'b', label: '#b', message: 'Already shipped' }]);
    expect(summarizeBulk(result, 'mark orders packed')).toEqual({ title: '2 of 3 updated', message: '• #b: Already shipped' });
    expect(summarizeBulk({ succeeded: ['a'], failed: [] }, 'x')).toBeNull();
    expect(summarizeBulk({ succeeded: [], failed: [{ id: 'a', label: '#a', message: 'no' }] }, 'mark orders packed')?.title)
      .toBe("Couldn't mark orders packed");
  });
});

describe('View Tracking (item 31)', () => {
  it('maps server scan history and resolves the carrier URL', () => {
    expect(mapTrackingEvents([
      { id: 'e1', status: 'in_transit', description: '', location: 'Seattle', occurredAt: '2026-01-02T00:00:00Z' },
      { bogus: true },
    ])).toEqual([{ id: 'e1', status: 'in_transit', description: 'In transit', location: 'Seattle', timestamp: '2026-01-02T00:00:00Z' }]);
    expect(mapTrackingEvents(undefined)).toEqual([]);
    expect(trackingStatusText(undefined)).toBe('Awaiting first carrier scan');
    expect(trackingStatusText('delivered')).toBe('Delivered');
    expect(resolveTrackingUrl('https://carrier.example/t/1', 'UPS', '1Z')).toBe('https://carrier.example/t/1');
    expect(resolveTrackingUrl('javascript:alert(1)', 'UPS', '1Z')).toBe('https://www.ups.com/track?tracknum=1Z');
    expect(resolveTrackingUrl(null, 'UPS', null)).toBeNull();
  });
});

describe('Roles search/filter (item 56)', () => {
  const roles = [
    { key: 'owner', name: 'Owner', group: 'Organization', description: 'Full access', permissions: ['*'], staffCount: 1 },
    { key: 'finance', name: 'Finance', group: 'Store', description: 'Payouts and statements', permissions: ['payouts'], staffCount: 0 },
    { key: 'orders', name: 'Orders', group: 'Store', description: 'Fulfillment', permissions: ['orders', 'inventory'], staffCount: 0, pendingCount: 1 },
  ];
  it('searches names, descriptions and permissions', () => {
    expect(filterRoles(roles, 'statement', 'all').map(r => r.key)).toEqual(['finance']);
    expect(filterRoles(roles, 'INVENTORY', 'all').map(r => r.key)).toEqual(['orders']);
  });
  it('filters by group and membership', () => {
    expect(filterRoles(roles, '', 'store').map(r => r.key)).toEqual(['finance', 'orders']);
    expect(filterRoles(roles, '', 'has_members').map(r => r.key)).toEqual(['owner', 'orders']);
    expect(filterRoles(roles, '', 'empty').map(r => r.key)).toEqual(['finance']);
  });
  it('summarises permissions for Learn more', () => {
    expect(permissionSummary(['orders', 'inventory'])).toBe('Orders, Inventory');
  });
});

describe('seller push prefs (item 55)', () => {
  it('only exposes categories the server stores and push.ts enforces', () => {
    const SERVER_SELLER_CATEGORIES = ['new_orders', 'production_milestones', 'payout_confirmations', 'customer_messages', 'disputes', 'subscription_trial', 'inventory_alerts', 'seller_announcements'];
    for (const g of SELLER_PUSH_GROUPS) for (const r of g.rows) expect(SERVER_SELLER_CATEGORIES).toContain(r.key);
    expect(categoryValue({}, 'new_orders')).toBe(true);
    expect(categoryValue({ new_orders: false }, 'new_orders')).toBe(false);
  });
});

describe('team activity (item 69)', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  it('labels member activity', () => {
    expect(memberLastSeenLabel({ status: 'active', online: true }, now)).toBe('Active now');
    expect(memberLastSeenLabel({ status: 'active', lastActiveAt: '2026-01-01T10:00:00Z' }, now)).toBe('Last active 2h ago');
    expect(memberLastSeenLabel({ status: 'active', lastActiveAt: null }, now)).toBe('Not signed in yet');
    expect(memberLastSeenLabel({ status: 'pending' }, now)).toBe('Invite not accepted yet');
    expect(relativeTime('2026-01-01T11:59:30Z', now)).toBe('Just now');
  });
  it('maps filters to the audit-log resourceType', () => {
    expect(activityResourceType('all')).toBeUndefined();
    expect(activityResourceType('session')).toBe('session');
  });
});
