import { afterEach, describe, expect, it } from 'vitest';
import { buildDropCalendarItems, mapPublicDropRow, mergeDiscoverDrops } from '../lib/dropCalendar';
import type { DiscoverDrop } from '../lib/discoverFeed';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => { process.env.TZ = ORIGINAL_TZ; });

const drop = (id: string, releaseAt: string | null, live = false): DiscoverDrop =>
  ({ id, name: `Drop ${id}`, brandName: 'Brand', releaseAt, live });

const shape = (items: ReturnType<typeof buildDropCalendarItems>) =>
  items.map((i) => (i.kind === 'header' ? `# ${i.title}` : i.drop.id));

describe('mapPublicDropRow', () => {
  it('maps the public drops payload (hero image, seller brand) and the section live flag', () => {
    const row = {
      id: 'd1', name: 'Fall capsule', releaseAt: '2026-10-14T16:00:00.000Z',
      heroImageUrl: 'https://img/hero.jpg', seller: { brandName: 'Ember', displayName: 'ember_shop' },
    };
    expect(mapPublicDropRow(row, true)).toEqual({
      id: 'd1', name: 'Fall capsule', brandName: 'Ember', imageUri: 'https://img/hero.jpg',
      releaseAt: '2026-10-14T16:00:00.000Z', live: true,
    });
    expect(mapPublicDropRow({ id: 'd2', seller: { displayName: 'Shop' } }, false))
      .toMatchObject({ name: 'Drop', brandName: 'Shop', imageUri: undefined, releaseAt: null, live: false });
  });
});

describe('mergeDiscoverDrops', () => {
  it('dedupes by id and keeps the live copy', () => {
    const out = mergeDiscoverDrops(
      [drop('a', '2026-10-13T10:00:00Z', true)],
      [drop('a', '2026-10-13T10:00:00Z'), drop('b', '2026-10-14T10:00:00Z'), drop('b', '2026-10-14T10:00:00Z')],
    );
    expect(out.map((d) => [d.id, d.live])).toEqual([['a', true], ['b', false]]);
  });
});

describe('buildDropCalendarItems', () => {
  it('puts live drops first, then Today, Tomorrow and dated days, release order within a day', () => {
    process.env.TZ = 'America/New_York';
    const now = new Date('2026-10-13T16:00:00Z'); // Tue Oct 13, 12:00 New York
    const items = buildDropCalendarItems([
      drop('later', '2026-10-16T18:00:00Z'),
      drop('tmrw-pm', '2026-10-14T22:00:00Z'),
      drop('today', '2026-10-13T23:00:00Z'),
      drop('live-2', '2026-10-13T15:00:00Z', true),
      drop('tmrw-am', '2026-10-14T13:00:00Z'),
      drop('live-1', '2026-10-13T09:00:00Z', true),
      drop('undated', null),
    ], now);
    expect(shape(items)).toEqual([
      '# Live now', 'live-1', 'live-2',
      '# Today', 'today',
      '# Tomorrow', 'tmrw-am', 'tmrw-pm',
      '# Fri, Oct 16', 'later',
    ]);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  it('dedupes a drop returned by both sections', () => {
    const now = new Date('2026-10-13T16:00:00Z');
    const items = buildDropCalendarItems([
      drop('x', '2026-10-13T15:00:00Z', true),
      drop('x', '2026-10-13T15:00:00Z'),
    ], now);
    expect(shape(items)).toEqual(['# Live now', 'x']);
  });

  it('buckets by the viewer’s local day across midnight', () => {
    // 03:30 UTC on Oct 14 is still Oct 13 evening in Los Angeles, but
    // already Oct 14 midday in Tokyo.
    const items = [
      drop('late', '2026-10-14T03:30:00Z'),
      drop('early', '2026-10-13T20:00:00Z'),
      drop('eve', '2026-10-13T14:00:00Z'),
    ];

    process.env.TZ = 'America/Los_Angeles'; // now = Oct 13 12:00 PDT
    expect(shape(buildDropCalendarItems(items, new Date('2026-10-13T19:00:00Z'))))
      .toEqual(['# Today', 'eve', 'early', 'late']);

    process.env.TZ = 'Asia/Tokyo'; // now = Oct 13 21:00 JST
    expect(shape(buildDropCalendarItems(items, new Date('2026-10-13T12:00:00Z'))))
      .toEqual(['# Today', 'eve', '# Tomorrow', 'early', 'late']);
  });

  it('is empty when there are no drops', () => {
    expect(buildDropCalendarItems([])).toEqual([]);
  });
});
