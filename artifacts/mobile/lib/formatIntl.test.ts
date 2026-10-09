import { describe, expect, it } from 'vitest';
import {
  fmtCents,
  fmtDate,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyMajor,
  formatRelative,
  getDeviceLocale,
  getDeviceTimeZone,
} from './format';

describe('formatMoney (minor units)', () => {
  it('matches the existing en-US output', () => {
    for (const cents of [0, 5, 1250, 123456, -995]) {
      expect(formatMoney(cents, 'USD', 'en-US')).toBe(fmtCents(cents));
    }
  });

  it('uses each currency\'s own minor unit and the locale\'s conventions', () => {
    expect(formatMoney(1250, 'JPY', 'en-US')).toBe('¥1,250');
    expect(formatMoney(1250, 'eur', 'de-DE').replace(/\s/g, ' ')).toBe('12,50 €');
    expect(formatMoney(1250, 'GBP', 'en-GB')).toBe('£12.50');
  });

  it('falls back instead of throwing on an unknown currency code', () => {
    expect(formatMoney(1250, 'NOT_A_CODE', 'en-US')).toBe('NOT_A_CODE 12.50');
  });

  it('formats major units too', () => {
    expect(formatMoneyMajor(12.5, 'USD', 'en-US')).toBe('$12.50');
  });
});

describe('formatDate / formatDateTime', () => {
  const iso = '2026-08-18T15:42:00Z';

  it('matches the existing en-US short date in the same time zone', () => {
    expect(formatDate(iso, undefined, 'en-US')).toBe(fmtDate(iso));
    expect(formatDate(iso, { month: 'short', day: 'numeric', timeZone: 'UTC' }, 'en-US')).toBe('Aug 18');
  });

  it('follows the requested locale and time zone', () => {
    expect(formatDate(iso, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }, 'de-DE')).toBe('18.08.2026');
    expect(formatDate('2026-08-18T23:30:00Z', { day: 'numeric', timeZone: 'Asia/Tokyo' }, 'en-US')).toBe('19');
  });

  it('includes the time for formatDateTime', () => {
    expect(formatDateTime(iso, 'en-US')).toMatch(/Aug 18, 2026.*\d{1,2}:42/);
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatDate('not a date')).toBe('');
    expect(formatRelative('nope')).toBe('');
  });
});

describe('formatRelative', () => {
  const now = Date.parse('2026-08-18T12:00:00Z');
  it('is compact on en-US', () => {
    expect(formatRelative(now - 5 * 60_000, now, 'en-US')).toBe('5m ago');
    expect(formatRelative(now - 3 * 3_600_000, now, 'en-US')).toBe('3h ago');
    expect(formatRelative(now - 2 * 86_400_000, now, 'en-US')).toBe('2d ago');
    expect(formatRelative(now - 10_000, now, 'en-US')).toBe('now');
  });

  it('switches to a date after a week', () => {
    expect(formatRelative(now - 10 * 86_400_000, now, 'en-US')).toMatch(/Aug 8, 2026/);
  });
});

describe('device locale', () => {
  it('always resolves something usable', () => {
    expect(getDeviceLocale()).toMatch(/^[a-z]{2,3}/i);
    const tz = getDeviceTimeZone();
    expect(tz === undefined || typeof tz === 'string').toBe(true);
  });
});
