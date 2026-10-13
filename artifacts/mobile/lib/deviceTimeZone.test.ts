import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceTimeZone, quietHoursBody } from './deviceTimeZone';

describe('deviceTimeZone', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the resolved IANA zone', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'America/Los_Angeles' } as any);
    expect(deviceTimeZone()).toBe('America/Los_Angeles');
    expect(quietHoursBody('23:00', '08:00')).toEqual({ start: '23:00', end: '08:00', timezone: 'America/Los_Angeles' });
  });

  it('omits the zone when the runtime cannot tell', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: undefined } as any);
    expect(deviceTimeZone()).toBeUndefined();
    expect(quietHoursBody('23:00', '08:00')).toEqual({ start: '23:00', end: '08:00' });
  });

  it('turns quiet hours off when either bound is missing', () => {
    expect(quietHoursBody(null, null)).toBeNull();
    expect(quietHoursBody('23:00', null)).toBeNull();
  });
});
