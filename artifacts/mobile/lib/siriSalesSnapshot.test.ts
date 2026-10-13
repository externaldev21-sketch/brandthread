import { describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, Settings: settings }));

import { clearSiriSalesSnapshot, localDayKey, saveSiriSalesSnapshot, siriSalesSnapshot } from './siriSalesSnapshot';

describe('Siri sales snapshot', () => {
  it('stamps the local day and formats the amount', () => {
    const snap = siriSalesSnapshot({ totalCents: 124000, orderCount: 8 }, new Date(2026, 9, 13, 23, 59));
    expect(snap).toEqual({ 'bt.salesToday.day': '2026-10-13', 'bt.salesToday.amount': '$1,240.00', 'bt.salesToday.orders': 8 });
  });

  it('pads single-digit months and days', () => {
    expect(localDayKey(new Date(2027, 0, 5))).toBe('2027-01-05');
  });

  it('only saves real numbers', () => {
    settings.set.mockClear();
    saveSiriSalesSnapshot(null);
    saveSiriSalesSnapshot({ totalCents: '12', orderCount: 1 });
    expect(settings.set).not.toHaveBeenCalled();
    saveSiriSalesSnapshot({ totalCents: 500, orderCount: 1 });
    expect(settings.set).toHaveBeenCalledTimes(1);
  });

  it('clears the snapshot on account change', () => {
    settings.set.mockClear();
    clearSiriSalesSnapshot();
    expect(settings.set).toHaveBeenCalledWith({ 'bt.salesToday.day': '', 'bt.salesToday.amount': '', 'bt.salesToday.orders': 0 });
  });
});
