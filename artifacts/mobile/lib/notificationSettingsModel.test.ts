import { describe, expect, it } from 'vitest';
import { optionsFor, pageById, pagesFor, pausedUntilLabel, PAUSE_OPTIONS, SETTINGS_PAGES } from './notificationSettingsModel';

describe('Instagram-style notification settings model', () => {
  it('has the Instagram category rows in order', () => {
    expect(pagesFor('buyer').map((p) => p.title)).toEqual([
      'Posts and comments', 'Following and followers', 'Messages', 'Calls', 'Live', 'Orders and shopping',
    ]);
  });

  it('shows each role only its own types', () => {
    const buyerOrders = pageById('buyer', 'orders')!.sections.map((s) => s.key);
    const sellerOrders = pageById('seller', 'orders')!.sections.map((s) => s.key);
    expect(buyerOrders).toEqual(['order_updates', 'shipped', 'delivered', 'returns_refunds', 'promotions']);
    expect(sellerOrders).toEqual(['new_orders', 'returns_refunds', 'payouts', 'reviews', 'promotions']);
    expect(pageById('buyer', 'messages')!.sections.map((s) => s.key)).not.toContain('manufacturer_messages');
    expect(pageById('seller', 'messages')!.sections.map((s) => s.key)).toContain('manufacturer_messages');
    expect(pageById('buyer', 'nope')).toBeUndefined();
    const returns = (role: 'buyer' | 'seller') => pageById(role, 'orders')!.sections.find((x) => x.key === 'returns_refunds')!.example;
    expect(returns('buyer')).toMatch(/^Your refund/);
    expect(returns('seller')).toMatch(/^A customer asked to return/);
  });

  it('covers every event Dev listed', () => {
    const keys = new Set(SETTINGS_PAGES.flatMap((p) => p.sections.map((s) => s.key)));
    for (const k of ['new_orders', 'messages', 'new_followers', 'comments', 'likes', 'live', 'shipped', 'delivered', 'payouts', 'reviews', 'manufacturer_messages', 'missed_calls']) {
      expect(keys.has(k), k).toBe(true);
    }
  });

  it('offers From profiles I follow only for likes, comments and mentions', () => {
    const page = pageById('buyer', 'posts')!;
    const labels = (key: string) => optionsFor(page.sections.find((s) => s.key === key)!).map((o) => o.label);
    expect(labels('likes')).toEqual(['Off', 'From profiles I follow', 'From everyone']);
    expect(labels('reposts')).toEqual(['Off', 'On']);
  });

  it('offers the Instagram pause durations', () => {
    expect(PAUSE_OPTIONS.map((o) => o.label)).toEqual(['15 minutes', '1 hour', '2 hours', '4 hours', '8 hours']);
  });

  it('labels a running pause and ignores an ended one', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    expect(pausedUntilLabel(null, now)).toBeNull();
    expect(pausedUntilLabel('2026-10-09T11:00:00Z', now)).toBeNull();
    expect(pausedUntilLabel('2026-10-09T13:00:00Z', now)).toMatch(/^Paused until /);
  });
});
