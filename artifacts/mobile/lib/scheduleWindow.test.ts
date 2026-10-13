import { describe, expect, it } from 'vitest';
import {
  addDays, defaultStartFields, fieldsFromStored, formatFields, formatScheduleInstant,
  instantFromFields, isLegacyDateOnly, scheduleFormFromStored, schedulePayload, scheduleSummary,
  wallClockInZone, zoneAbbreviation,
} from './scheduleWindow';

describe('scheduleWindow', () => {
  it('converts a wall clock in the seller zone to the right UTC instant (DST aware)', () => {
    expect(instantFromFields('2026-10-20', '09:00', 'America/New_York')!.toISOString()).toBe('2026-10-20T13:00:00.000Z');
    expect(instantFromFields('2026-12-20', '09:00', 'America/New_York')!.toISOString()).toBe('2026-12-20T14:00:00.000Z');
    expect(instantFromFields('2026-10-20', '09:30', 'Asia/Kolkata')!.toISOString()).toBe('2026-10-20T04:00:00.000Z');
  });

  it('rejects malformed or impossible fields', () => {
    expect(instantFromFields('2026-02-30', '09:00', 'UTC')).toBeNull();
    expect(instantFromFields('2026-10-20', '25:00', 'UTC')).toBeNull();
    expect(instantFromFields('20/10/2026', '09:00', 'UTC')).toBeNull();
  });

  it('round-trips a stored instant back to the same wall clock in its zone', () => {
    const iso = instantFromFields('2026-11-01', '01:30', 'America/Los_Angeles')!.toISOString();
    expect(fieldsFromStored(iso, 'America/Los_Angeles', 'Europe/London')).toEqual({ date: '2026-11-01', time: '01:30' });
    expect(wallClockInZone(new Date('2026-10-20T00:00:00Z'), 'Asia/Tokyo')).toEqual({ date: '2026-10-20', time: '09:00' });
  });

  it('shows legacy date-only values (no zone, UTC midnight) as 12:00 AM on the typed date', () => {
    expect(isLegacyDateOnly('2026-10-20T00:00:00.000Z', null)).toBe(true);
    expect(isLegacyDateOnly('2026-10-20T00:00:00.000Z', 'America/New_York')).toBe(false);
    expect(isLegacyDateOnly('2026-10-20T04:00:00.000Z', null)).toBe(false);
    expect(fieldsFromStored('2026-10-20T00:00:00.000Z', null, 'America/Los_Angeles')).toEqual({ date: '2026-10-20', time: '00:00' });
    expect(formatScheduleInstant('2026-10-20T00:00:00.000Z', null, 'America/Los_Angeles')).toBe('Oct 20, 2026');
  });

  it('formats new values with the time and zone they were set in', () => {
    expect(formatScheduleInstant('2026-10-20T13:00:00.000Z', 'America/New_York')).toBe('Oct 20, 2026, 9:00 AM EDT');
    expect(zoneAbbreviation('UTC')).toBe('UTC');
    expect(formatFields('2026-10-13', '14:30')).toBe('Tue, Oct 13 · 2:30 PM');
  });

  it('defaults the start to now rounded down to the half hour, and the end a week later', () => {
    const start = defaultStartFields('UTC', new Date('2026-10-13T14:47:12Z'));
    expect(start).toEqual({ date: '2026-10-13', time: '14:30' });
    expect(addDays(start, 7)).toEqual({ date: '2026-10-20', time: '14:30' });
    expect(addDays({ date: '2026-12-28', time: '00:00' }, 7)).toEqual({ date: '2027-01-04', time: '00:00' });
  });
});

describe('schedule form', () => {
  const now = new Date('2026-10-13T14:47:00Z');

  it('a new form starts immediately and sends nothing until touched', () => {
    const f = scheduleFormFromStored(null, null, null, now);
    expect(f).toMatchObject({ startWasEmpty: true, hasEnd: false, touched: false });
    expect(schedulePayload(f)).toEqual({ values: {} });
    expect(scheduleSummary(f)).toBe('Active immediately, no end date');
  });

  it('adding only an end keeps the start empty and sends the zone', () => {
    const f = { ...scheduleFormFromStored(null, null, null, now), zone: 'America/New_York', hasEnd: true, endDate: '2026-10-20', endTime: '09:00', touched: true };
    expect(schedulePayload(f)).toEqual({ values: { startsAt: null, endsAt: '2026-10-20T13:00:00.000Z', scheduleTimeZone: 'America/New_York' } });
  });

  it('a picked start is sent as the instant in the chosen zone', () => {
    const f = { ...scheduleFormFromStored(null, null, null, now), zone: 'Asia/Kolkata', startDate: '2026-10-20', startTime: '09:30', startTouched: true, touched: true };
    expect(schedulePayload(f)).toMatchObject({ values: { startsAt: '2026-10-20T04:00:00.000Z', endsAt: null } });
  });

  it('rejects an end at or before the start', () => {
    const f = { ...scheduleFormFromStored('2026-10-20T13:00:00.000Z', null, 'America/New_York', now), hasEnd: true, endDate: '2026-10-20', endTime: '09:00', touched: true };
    expect(schedulePayload(f)).toEqual({ error: 'The end must be after the start.' });
  });

  it('loads stored values in their zone, legacy ones at 12:00 AM', () => {
    expect(scheduleFormFromStored('2026-10-20T13:00:00.000Z', '2026-10-27T03:59:00.000Z', 'America/New_York', now))
      .toMatchObject({ startDate: '2026-10-20', startTime: '09:00', hasEnd: true, endDate: '2026-10-26', endTime: '23:59', zone: 'America/New_York' });
    expect(scheduleFormFromStored('2026-10-20T00:00:00.000Z', '2026-10-31T00:00:00.000Z', null, now))
      .toMatchObject({ startDate: '2026-10-20', startTime: '00:00', endDate: '2026-10-31', endTime: '00:00', startWasEmpty: false });
  });
});
