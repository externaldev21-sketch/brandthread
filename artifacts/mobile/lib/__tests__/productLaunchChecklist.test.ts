import { describe, expect, it } from 'vitest';
import {
  buildDemoLaunchChecklist, hourLabel, launchCheckRoute, launchCheckTitle, mostActiveSentence,
  nextSlotWallClock, slotLabel, withLiveChecks, type LaunchCheckId,
} from '../productLaunchChecklist';

describe('labels', () => {
  it('formats slots the way the editor suggestion reads', () => {
    expect(slotLabel({ weekday: 4, hour: 19 })).toBe('Thu 7 PM');
    expect(slotLabel({ weekday: 0, hour: 0 })).toBe('Sun 12 AM');
    expect(hourLabel(12)).toBe('12 PM');
    expect(mostActiveSentence({ weekday: 4, hour: 23 }, 28))
      .toBe('In the last 28 days, your followers were most active on Thursday, between 11 PM and 12 AM.');
  });

  it('titles every check and pluralises followers', () => {
    const ids: LaunchCheckId[] = ['photos', 'price', 'stock', 'variants', 'description', 'shipping', 'payouts', 'launch_time', 'followers'];
    for (const id of ids) expect(launchCheckTitle(id).length).toBeGreaterThan(0);
    expect(launchCheckTitle('followers', 1)).toBe('Notify your 1 follower');
    expect(launchCheckTitle('followers', 1240)).toBe('Notify your 1,240 followers');
  });

  it('routes each fixable check to the screen that fixes it', () => {
    expect(launchCheckRoute('photos', 'p1')).toBe('/add-product?editId=p1');
    expect(launchCheckRoute('stock', 'p1')).toBe('/product-variants?productId=p1');
    expect(launchCheckRoute('shipping', 'p1')).toBe('/shipping');
    expect(launchCheckRoute('payouts', 'p1')).toBe('/payouts');
    expect(launchCheckRoute('launch_time', 'p1')).toBeNull();
    expect(launchCheckRoute('followers', 'p1')).toBeNull();
  });
});

describe('withLiveChecks', () => {
  it('re-evaluates launch time and followers from the form', () => {
    const base = buildDemoLaunchChecklist();
    const now = new Date('2026-10-13T12:00:00Z');
    const past = withLiveChecks(base, { launchAt: new Date('2026-10-13T11:00:00Z'), notifyFollowers: false }, now);
    expect(past.items.find((i) => i.id === 'launch_time')?.done).toBe(false);
    expect(past.items.find((i) => i.id === 'followers')?.done).toBe(false);
    expect(past.readyCount).toBe(base.readyCount - 2);
    const ok = withLiveChecks(base, { launchAt: new Date('2026-10-14T11:00:00Z'), notifyFollowers: true }, now);
    expect(ok.readyCount).toBe(base.readyCount);
  });
});

describe('nextSlotWallClock', () => {
  // Tue 2026-10-13 12:00 UTC = Tue 5 AM in Los Angeles.
  const now = new Date('2026-10-13T12:00:00Z');

  it('picks the next matching weekday in the zone', () => {
    expect(nextSlotWallClock({ weekday: 4, hour: 19 }, 'America/Los_Angeles', now)).toEqual({ date: '2026-10-15', time: '19:00' });
  });

  it('uses today when the hour is still ahead, next week when it has passed', () => {
    expect(nextSlotWallClock({ weekday: 2, hour: 9 }, 'America/Los_Angeles', now)).toEqual({ date: '2026-10-13', time: '09:00' });
    expect(nextSlotWallClock({ weekday: 2, hour: 4 }, 'America/Los_Angeles', now)).toEqual({ date: '2026-10-20', time: '04:00' });
  });

  it("reads the date in the zone, not the device's", () => {
    // 12:00 UTC Tue is already 9 PM Tue in Tokyo; Wed 8 AM Tokyo is tomorrow there.
    expect(nextSlotWallClock({ weekday: 3, hour: 8 }, 'Asia/Tokyo', now)).toEqual({ date: '2026-10-14', time: '08:00' });
  });
});
