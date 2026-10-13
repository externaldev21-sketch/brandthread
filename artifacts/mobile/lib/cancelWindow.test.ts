import { describe, expect, it } from 'vitest';
import { CANCEL_WINDOW_OPTIONS, cancelDeadlineText, cancelWindowLabel } from './cancelWindow';
import { BUYER_CANCELLATION_WINDOW_MS, canBuyerCancel } from '../services/orderPolicy';

const now = new Date(2026, 9, 13, 12, 0);

describe('cancelDeadlineText', () => {
  it('shows only the time for a deadline later today', () => {
    expect(cancelDeadlineText(new Date(2026, 9, 13, 15, 40).toISOString(), now, 'en-US')).toBe('You can cancel until 3:40 PM');
  });

  it('says tomorrow, or the date further out', () => {
    expect(cancelDeadlineText(new Date(2026, 9, 14, 9, 0).toISOString(), now, 'en-US')).toBe('You can cancel until tomorrow, 9:00 AM');
    expect(cancelDeadlineText(new Date(2026, 9, 24, 15, 40).toISOString(), now, 'en-US')).toBe('You can cancel until Oct 24, 3:40 PM');
    expect(cancelDeadlineText(new Date(2027, 0, 2, 15, 40).toISOString(), now, 'en-US')).toBe('You can cancel until Jan 2, 2027, 3:40 PM');
  });

  it('is null when missing, invalid or already passed', () => {
    expect(cancelDeadlineText(null, now)).toBeNull();
    expect(cancelDeadlineText('nope', now)).toBeNull();
    expect(cancelDeadlineText(new Date(2026, 9, 13, 11, 59).toISOString(), now)).toBeNull();
  });
});

describe('cancelWindowLabel', () => {
  it('labels every option and treats unset as Until shipped', () => {
    expect(CANCEL_WINDOW_OPTIONS.map(o => o.label)).toEqual(['1 hour', '12 hours', '24 hours', '3 days', 'Until shipped']);
    expect(cancelWindowLabel(72)).toBe('3 days');
    expect(cancelWindowLabel(null)).toBe('Until shipped');
    expect(cancelWindowLabel(undefined)).toBe('Until shipped');
  });
});

describe('canBuyerCancel with a server deadline', () => {
  const placed = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

  it('uses the deadline when the server sends one', () => {
    const oneHourWindow = new Date(new Date(placed).getTime() + 60 * 60 * 1000).toISOString();
    expect(canBuyerCancel('new', placed, now.getTime(), oneHourWindow)).toBe(false);
    const later = new Date(now.getTime() + 60_000).toISOString();
    expect(canBuyerCancel('processing', placed, now.getTime(), later)).toBe(true);
    expect(canBuyerCancel('shipped', placed, now.getTime(), later)).toBe(false);
  });

  it('falls back to the 21-day default without one', () => {
    expect(canBuyerCancel('new', placed, now.getTime(), null)).toBe(true);
    const old = new Date(now.getTime() - BUYER_CANCELLATION_WINDOW_MS - 1).toISOString();
    expect(canBuyerCancel('new', old, now.getTime())).toBe(false);
  });
});
