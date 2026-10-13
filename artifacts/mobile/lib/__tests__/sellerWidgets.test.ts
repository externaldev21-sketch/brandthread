import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ api: { analytics: { widgetSummary: vi.fn() } } }));
vi.mock('@/lib/nativeSystem', () => ({ updateSellerTodayWidget: vi.fn(), clearSellerWidgets: vi.fn() }));

import { api } from '@/lib/api';
import { clearSellerWidgets, updateSellerTodayWidget } from '@/lib/nativeSystem';
import { isWidgetRefreshPush, refreshSellerWidgets, widgetSnapshotFromSummary } from '../sellerWidgets';

describe('widgetSnapshotFromSummary', () => {
  it('maps the endpoint onto the widget snapshot', () => {
    expect(widgetSnapshotFromSummary({
      enabled: true, salesTodayCents: 9800, ordersToday: 2, toShipCount: 3, currency: 'USD', asOf: '2026-10-13T15:30:00Z',
    })).toEqual({ salesCents: 9800, ordersCount: 2, toShipCount: 3, currency: 'USD' });
  });
  it('is null while the flag is off', () => {
    expect(widgetSnapshotFromSummary({ enabled: false })).toBeNull();
  });
  it('never writes a negative or fractional count', () => {
    expect(widgetSnapshotFromSummary({
      enabled: true, salesTodayCents: -5, ordersToday: 1.6, toShipCount: Number.NaN, currency: '', asOf: '',
    })).toEqual({ salesCents: 0, ordersCount: 2, toShipCount: 0, currency: 'USD' });
  });
});

describe('refreshSellerWidgets', () => {
  it('writes the snapshot, or clears the widgets when disabled, and keeps the last one on error', async () => {
    const summary = vi.mocked(api.analytics.widgetSummary);
    summary.mockResolvedValueOnce({ enabled: true, salesTodayCents: 100, ordersToday: 1, toShipCount: 1, currency: 'USD', asOf: '' });
    await refreshSellerWidgets();
    expect(updateSellerTodayWidget).toHaveBeenCalledWith({ salesCents: 100, ordersCount: 1, toShipCount: 1, currency: 'USD' });

    summary.mockResolvedValueOnce({ enabled: false });
    await refreshSellerWidgets();
    expect(clearSellerWidgets).toHaveBeenCalledTimes(1);

    summary.mockRejectedValueOnce(new Error('offline'));
    await refreshSellerWidgets();
    expect(updateSellerTodayWidget).toHaveBeenCalledTimes(1);
    expect(clearSellerWidgets).toHaveBeenCalledTimes(1);
  });
});

describe('isWidgetRefreshPush', () => {
  it('only for pushes that change the seller numbers', () => {
    expect(isWidgetRefreshPush({ type: 'new_order_received' })).toBe(true);
    expect(isWidgetRefreshPush({ type: 'order_cancelled_by_buyer' })).toBe(true);
    expect(isWidgetRefreshPush({ type: 'new_follower' })).toBe(false);
    expect(isWidgetRefreshPush(undefined)).toBe(false);
  });
});
