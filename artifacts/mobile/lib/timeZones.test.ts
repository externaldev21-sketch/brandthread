import { describe, expect, it } from 'vitest';
import { COMMON_TIME_ZONES } from '@/lib/dropSchedule';
import {
  buildTimeZoneOptions, filterTimeZones, formatOffset, listTimeZones,
  timeZoneLabel, timeZoneOffsetMinutes, timeZoneParts,
} from '@/lib/timeZones';

// Mid-January: no DST in the northern hemisphere, DST in Sydney.
const JAN = new Date('2026-01-15T12:00:00Z');
const JUL = new Date('2026-07-15T12:00:00Z');

describe('listTimeZones', () => {
  it('uses Intl.supportedValuesOf when the engine has it, adding UTC', () => {
    expect(listTimeZones({ supportedValuesOf: () => ['Europe/Paris', 'Asia/Tokyo'] }))
      .toEqual(['Europe/Paris', 'Asia/Tokyo', 'UTC']);
  });

  it('falls back to the curated list when the engine can’t list zones', () => {
    expect(listTimeZones({})).toEqual(expect.arrayContaining(COMMON_TIME_ZONES));
    expect(listTimeZones({ supportedValuesOf: () => { throw new Error('nope'); } })).toContain('America/New_York');
  });
});

describe('offsets and labels', () => {
  it('works out DST-aware offsets', () => {
    expect(timeZoneOffsetMinutes('America/New_York', JAN)).toBe(-300);
    expect(timeZoneOffsetMinutes('America/New_York', JUL)).toBe(-240);
    expect(timeZoneOffsetMinutes('Asia/Kolkata', JAN)).toBe(330);
    expect(timeZoneOffsetMinutes('UTC', JAN)).toBe(0);
    expect(timeZoneOffsetMinutes('Not/AZone', JAN)).toBeNull();
  });

  it('formats offsets as GMT±h[:mm]', () => {
    expect(formatOffset(0)).toBe('GMT');
    expect(formatOffset(-240)).toBe('GMT-4');
    expect(formatOffset(330)).toBe('GMT+5:30');
    expect(formatOffset(-570)).toBe('GMT-9:30');
  });

  it('splits ids into city and region', () => {
    expect(timeZoneParts('America/Argentina/Buenos_Aires')).toEqual({ city: 'Buenos Aires', region: 'America / Argentina' });
    expect(timeZoneParts('UTC')).toEqual({ city: 'UTC', region: '' });
  });

  it('labels a saved zone with its city and current offset', () => {
    expect(timeZoneLabel('America/New_York', JUL)).toBe('New York (GMT-4)');
    expect(timeZoneLabel('Not/AZone', JUL)).toBe('AZone');
    expect(timeZoneLabel('')).toBe('');
  });
});

describe('buildTimeZoneOptions / filterTimeZones', () => {
  const options = buildTimeZoneOptions(['Asia/Tokyo', 'America/New_York', 'Europe/London', 'America/Los_Angeles', 'Asia/Kolkata'], JAN);

  it('sorts west to east', () => {
    expect(options.map(o => o.id)).toEqual(['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo']);
  });

  it('keeps a saved zone the list is missing', () => {
    expect(buildTimeZoneOptions(['Asia/Tokyo'], JAN, 'Europe/Paris').map(o => o.id)).toEqual(['Europe/Paris', 'Asia/Tokyo']);
  });

  it('matches city names with spaces, regions, ids and offsets', () => {
    expect(filterTimeZones(options, 'new york').map(o => o.id)).toEqual(['America/New_York']);
    expect(filterTimeZones(options, 'America/New_').map(o => o.id)).toEqual(['America/New_York']);
    expect(filterTimeZones(options, 'asia').map(o => o.id)).toEqual(['Asia/Kolkata', 'Asia/Tokyo']);
    expect(filterTimeZones(options, 'gmt+5:30').map(o => o.id)).toEqual(['Asia/Kolkata']);
    expect(filterTimeZones(options, '  ')).toBe(options);
    expect(filterTimeZones(options, 'atlantis')).toEqual([]);
  });

  it('puts city-prefix matches first', () => {
    // Every zone matches "t" (via "gmt" at least); Tokyo is the only city
    // starting with it, so it jumps ahead of the westward ones.
    expect(filterTimeZones(options, 't').map(o => o.city).slice(0, 1)).toEqual(['Tokyo']);
  });
});
