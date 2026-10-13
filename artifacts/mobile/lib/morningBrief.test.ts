import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { storage.set(k, v); }),
  },
}));

import {
  buildPreviewMorningBrief,
  dismissMorningBriefFor,
  dismissedKey,
  localDateString,
  offKey,
  primaryActionLabel,
  primaryActionRoute,
  readMorningBriefPrefs,
  shouldShowMorningBrief,
  summarySentence,
  turnOffMorningBrief,
  type MorningBrief,
} from './morningBrief';
import { pickTopCard, TOP_CARD_PRIORITY } from './dashboardTopCard';

const nineAm = new Date(2026, 9, 13, 9, 0);
const brief: MorningBrief = {
  date: localDateString(nineAm),
  hasPaidOrder: true,
  yesterday: { netCents: 41218, orderCount: 6 },
  toShip: 3,
  suggestion: null,
};
const show = (b: MorningBrief | null, over: Partial<{ now: Date; dismissedDate: string | null; off: boolean }> = {}) =>
  shouldShowMorningBrief(b, { now: nineAm, dismissedDate: null, off: false, ...over });

describe('shouldShowMorningBrief', () => {
  it('shows a brief with something to say after 05:00', () => {
    expect(show(brief)).toBe(true);
    expect(show(brief, { now: new Date(2026, 9, 13, 5, 0) })).toBe(true);
  });

  it('waits until 05:00 local', () => {
    expect(show(brief, { now: new Date(2026, 9, 13, 4, 59) })).toBe(false);
  });

  it('needs at least one lifetime paid order', () => {
    expect(show({ ...brief, hasPaidOrder: false })).toBe(false);
  });

  it('stays hidden with nothing to say', () => {
    expect(show({ ...brief, yesterday: { netCents: 0, orderCount: 0 }, toShip: 0 })).toBe(false);
    expect(show({ ...brief, yesterday: { netCents: 0, orderCount: 0 }, toShip: 1 })).toBe(true);
    expect(show({
      ...brief,
      yesterday: { netCents: 0, orderCount: 0 },
      toShip: 0,
      suggestion: { kind: 'low_stock', title: 'Tee has 2 left', detail: '', target: { type: 'product', id: 'p' } },
    })).toBe(true);
  });

  it('hides for the dismissed date only; the next day brings it back', () => {
    expect(show(brief, { dismissedDate: brief.date })).toBe(false);
    const tomorrow = new Date(2026, 9, 14, 9, 0);
    expect(show({ ...brief, date: localDateString(tomorrow) }, { now: tomorrow, dismissedDate: brief.date })).toBe(true);
  });

  it('hides a stale brief fetched on another day', () => {
    expect(show(brief, { now: new Date(2026, 9, 14, 9, 0) })).toBe(false);
  });

  it('hides for good once turned off', () => {
    expect(show(brief, { off: true })).toBe(false);
    expect(show(null)).toBe(false);
  });
});

describe('dismiss / turn-off storage', () => {
  beforeEach(() => storage.clear());

  it('uses per-user keys', async () => {
    await dismissMorningBriefFor('u1', '2026-10-13');
    await turnOffMorningBrief('u2');
    expect(storage.get('bt:morning-brief:dismissed:u1')).toBe('2026-10-13');
    expect(storage.get('bt:morning-brief:off:u2')).toBe('1');
    expect(dismissedKey('u1')).toBe('bt:morning-brief:dismissed:u1');
    expect(offKey('u2')).toBe('bt:morning-brief:off:u2');
    expect(await readMorningBriefPrefs('u1')).toEqual({ dismissedDate: '2026-10-13', off: false });
    expect(await readMorningBriefPrefs('u2')).toEqual({ dismissedDate: null, off: true });
  });
});

describe('copy and action', () => {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;

  it('summarises yesterday and the shipping queue', () => {
    expect(summarySentence(brief, money)).toBe('$412.18 from 6 orders yesterday. 3 to ship.');
    expect(summarySentence({ ...brief, yesterday: { netCents: 900, orderCount: 1 }, toShip: 0 }, money)).toBe('$9.00 from 1 order yesterday.');
    expect(summarySentence({ ...brief, yesterday: { netCents: 0, orderCount: 0 } }, money)).toBe('No sales yesterday. 3 to ship.');
  });

  it('routes the one action to the suggestion target', () => {
    const restock = { ...brief, suggestion: { kind: 'restock' as const, title: 'Restock Coat', detail: '', target: { type: 'product' as const, id: 'p 1' } } };
    expect(primaryActionLabel(restock)).toBe('Restock');
    expect(primaryActionRoute(restock)).toBe('/product-variants?productId=p%201');
    const ship = { ...brief, suggestion: { kind: 'ship' as const, title: 'Ship BT-1', detail: '', target: { type: 'order' as const, id: 'o1' } } };
    expect(primaryActionLabel(ship)).toBe('Ship order');
    expect(primaryActionRoute(ship)).toBe('/order-detail?id=o1');
    expect(primaryActionLabel(brief)).toBe('Ship orders');
    expect(primaryActionLabel({ ...brief, toShip: 0 })).toBe('View orders');
    expect(primaryActionRoute(brief)).toBe('/(tabs)/orders');
  });
});

describe('buildPreviewMorningBrief', () => {
  const at = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();
  const orders = [
    { status: 'fulfilled', createdAt: at(12, 10), paidAt: at(12, 10), totalCents: 5000, items: [{ productId: 'coat', quantity: 2 }] },
    { status: 'pending', createdAt: at(12, 20), paidAt: at(12, 20), totalCents: 3000, items: [{ productId: 'tee', quantity: 1 }] },
    { status: 'cancelled', createdAt: at(12, 21), paidAt: null, totalCents: 9000, items: [{ productId: 'coat', quantity: 5 }] },
    { status: 'processing', createdAt: at(13, 8), paidAt: at(13, 8), totalCents: 1000, items: [{ productId: 'coat', quantity: 1 }] },
  ];

  it('derives yesterday, to-ship and a restock suggestion from the demo data', () => {
    const result = buildPreviewMorningBrief(nineAm, orders, [
      { id: 'coat', name: 'Wool Overcoat', stocks: [0, 0] },
      { id: 'tee', name: 'Tee', stocks: [4] },
    ]);
    expect(result.yesterday).toEqual({ netCents: 8000, orderCount: 2 });
    expect(result.toShip).toBe(2);
    expect(result.hasPaidOrder).toBe(true);
    expect(result.suggestion).toEqual({
      kind: 'restock',
      title: 'Restock Wool Overcoat',
      detail: 'Sold out. It sold 3 in the last 30 days.',
      target: { type: 'product', id: 'coat' },
    });
    expect(show(result)).toBe(true);
  });

  it('a fresh store has nothing to show', () => {
    expect(show(buildPreviewMorningBrief(nineAm, [], []))).toBe(false);
  });
});

describe('pickTopCard', () => {
  const brief = { key: 'morning-brief', priority: TOP_CARD_PRIORITY.morningBrief, visible: true };
  const milestone = { key: 'milestone', priority: TOP_CARD_PRIORITY.milestone, visible: true };

  it('shows only the highest-priority visible card', () => {
    expect(pickTopCard([brief, milestone])?.key).toBe('milestone');
    expect(pickTopCard([brief, { ...milestone, visible: false }])?.key).toBe('morning-brief');
    expect(pickTopCard([{ ...brief, visible: false }])).toBeNull();
  });

  it('yields entirely while the zero-orders setup card is showing', () => {
    expect(pickTopCard([brief, milestone], { blocked: true })).toBeNull();
  });
});
