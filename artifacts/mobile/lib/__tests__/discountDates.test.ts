import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  endOfLocalDayIso,
  isoToDayKey,
  parseDayKey,
  resolveDiscountDates,
  startOfLocalDayIso,
  toDayKey,
} from '../discountDates';

// Node re-reads process.env.TZ at runtime, so these run in a fixed US zone
// (UTC-8 in December) regardless of the machine running them.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/Los_Angeles'; });
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('day keys', () => {
  it('parses strictly as a LOCAL day', () => {
    const d = parseDayKey('2026-11-30')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(30);
    expect(d.getHours()).toBe(0);
  });

  it('rejects free text and impossible dates', () => {
    expect(parseDayKey('abc')).toBeNull();
    expect(parseDayKey('next friday')).toBeNull();
    expect(parseDayKey('2026-02-30')).toBeNull();
    expect(parseDayKey('2026-13-01')).toBeNull();
    expect(parseDayKey('')).toBeNull();
  });

  it('round-trips through local time', () => {
    expect(toDayKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    // Stored end-of-day for Nov 30 PST is Dec 1 07:59Z — still Nov 30 locally.
    expect(isoToDayKey('2026-12-01T07:59:59.999Z')).toBe('2026-11-30');
    expect(isoToDayKey(null)).toBe('');
    expect(isoToDayKey('garbage')).toBe('');
  });
});

describe('local day bounds', () => {
  it('start is local midnight, end is 23:59:59.999 local (not UTC midnight)', () => {
    expect(startOfLocalDayIso('2026-11-30')).toBe('2026-11-30T08:00:00.000Z');
    expect(endOfLocalDayIso('2026-11-30')).toBe('2026-12-01T07:59:59.999Z');
    expect(endOfLocalDayIso('nope')).toBeNull();
  });
});

describe('resolveDiscountDates', () => {
  const now = new Date('2026-11-01T12:00:00.000Z');

  it('no dates: starts immediately, never expires', () => {
    expect(resolveDiscountDates({ startKey: '', endKey: '', hasEnd: false }, now))
      .toEqual({ ok: true, startsAt: null, expiresAt: null });
  });

  it('ignores the end date when the end toggle is off', () => {
    expect(resolveDiscountDates({ startKey: '', endKey: '2026-10-01', hasEnd: false }, now))
      .toEqual({ ok: true, startsAt: null, expiresAt: null });
  });

  it('converts a valid window to local start/end of day', () => {
    expect(resolveDiscountDates({ startKey: '2026-12-01', endKey: '2026-12-10', hasEnd: true }, now)).toEqual({
      ok: true,
      startsAt: '2026-12-01T08:00:00.000Z',
      expiresAt: '2026-12-11T07:59:59.999Z',
    });
  });

  it('allows a single-day code (same start and end day)', () => {
    const r = resolveDiscountDates({ startKey: '2026-12-01', endKey: '2026-12-01', hasEnd: true }, now);
    expect(r.ok).toBe(true);
  });

  it('rejects end before start', () => {
    const r = resolveDiscountDates({ startKey: '2026-12-10', endKey: '2026-12-01', hasEnd: true }, now);
    expect(r).toMatchObject({ ok: false, title: 'End date is before start' });
  });

  it('rejects a missing end date when the toggle is on', () => {
    expect(resolveDiscountDates({ startKey: '', endKey: '', hasEnd: true }, now)).toMatchObject({ ok: false });
  });

  it('rejects an end date already past when starting immediately', () => {
    const r = resolveDiscountDates({ startKey: '', endKey: '2026-10-15', hasEnd: true }, now);
    expect(r).toMatchObject({ ok: false, title: 'End date has passed' });
  });

  it('accepts today as the end date (inclusive through local end of day)', () => {
    // 2026-11-01T12:00Z is 04:00 PST on Nov 1 in Los Angeles (DST ended
    // that morning), so the local end of day is 23:59:59.999 PST = 07:59Z.
    const r = resolveDiscountDates({ startKey: '', endKey: '2026-11-01', hasEnd: true }, now);
    expect(r).toEqual({ ok: true, startsAt: null, expiresAt: '2026-11-02T07:59:59.999Z' });
  });

  it('rejects malformed keys instead of throwing', () => {
    expect(resolveDiscountDates({ startKey: 'abc', endKey: '', hasEnd: false }, now)).toMatchObject({ ok: false });
    expect(resolveDiscountDates({ startKey: '', endKey: 'abc', hasEnd: true }, now)).toMatchObject({ ok: false });
  });
});
