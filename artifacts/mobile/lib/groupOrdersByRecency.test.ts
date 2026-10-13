import { describe, expect, it } from 'vitest';
import { groupOrdersByRecency } from './groupOrdersByRecency';

const o = (id: string, createdAt: string) => ({ id, createdAt });
const titles = (s: { title: string; data: { id: string }[] }[]) =>
  s.map(x => `${x.title}:${x.data.map(d => d.id).join(',')}`);

describe('groupOrdersByRecency', () => {
  // Wednesday 2026-10-14 10:00 in New York (14:00Z). Week starts Sunday 10-11.
  const now = new Date('2026-10-14T14:00:00Z');
  const tz = 'America/New_York';

  it('buckets into Today, This week and Earlier in order', () => {
    const items = [
      o('a', '2026-10-14T13:00:00Z'), // today 09:00 NY
      o('b', '2026-10-13T20:00:00Z'), // Tue
      o('c', '2026-10-11T04:30:00Z'), // Sun 00:30 NY, first minutes of the week
      o('d', '2026-10-11T03:30:00Z'), // Sat 23:30 NY, previous week
      o('e', '2026-09-01T12:00:00Z'),
    ];
    expect(titles(groupOrdersByRecency(items, now, tz))).toEqual([
      'Today:a', 'This week:b,c', 'Earlier:d,e',
    ]);
  });

  it('uses the seller time zone, not UTC, for the today boundary', () => {
    // 02:00Z on the 14th is still the 13th (22:00) in New York.
    const items = [o('late', '2026-10-14T02:00:00Z')];
    expect(titles(groupOrdersByRecency(items, now, tz))).toEqual(['This week:late']);
    // ...but already the 14th in Tokyo, where "now" is also the 14th.
    expect(titles(groupOrdersByRecency(items, now, 'Asia/Tokyo'))).toEqual(['Today:late']);
  });

  it('has no "This week" bucket on Sunday', () => {
    const sunday = new Date('2026-10-11T16:00:00Z'); // Sun noon NY
    const items = [o('sun', '2026-10-11T13:00:00Z'), o('sat', '2026-10-10T16:00:00Z')];
    expect(titles(groupOrdersByRecency(items, sunday, tz))).toEqual(['Today:sun', 'Earlier:sat']);
  });

  it('keeps Monday in This week when today is Saturday', () => {
    const saturday = new Date('2026-10-17T22:00:00Z');
    const items = [o('mon', '2026-10-12T15:00:00Z'), o('prevSat', '2026-10-10T15:00:00Z')];
    expect(titles(groupOrdersByRecency(items, saturday, tz))).toEqual(['This week:mon', 'Earlier:prevSat']);
  });

  it('handles a week that spans a DST change', () => {
    // US DST ends Sun 2026-11-01. Wednesday 11-04 noon NY = 17:00Z.
    const wed = new Date('2026-11-04T17:00:00Z');
    const items = [o('sunEarly', '2026-11-01T04:30:00Z'), o('satLate', '2026-11-01T03:30:00Z')];
    expect(titles(groupOrdersByRecency(items, wed, tz))).toEqual(['This week:sunEarly', 'Earlier:satLate']);
  });

  it('omits empty buckets and handles bad dates', () => {
    expect(groupOrdersByRecency([], now, tz)).toEqual([]);
    expect(titles(groupOrdersByRecency([o('x', 'nope')], now, tz))).toEqual(['Earlier:x']);
  });

  it('defaults to the device zone', () => {
    const local = new Date(2026, 9, 14, 12);
    const items = [
      o('t', new Date(2026, 9, 14, 0, 5).toISOString()),
      o('w', new Date(2026, 9, 11, 0, 5).toISOString()),
      o('e', new Date(2026, 9, 10, 23, 55).toISOString()),
    ];
    expect(titles(groupOrdersByRecency(items, local))).toEqual(['Today:t', 'This week:w', 'Earlier:e']);
  });
});
