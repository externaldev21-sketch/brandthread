import { describe, expect, it } from 'vitest';
import { scheduleRouteWarmup } from '@/lib/navigation/routeWarmup';

describe('likely-route warming', () => {
  it('does not block the initial frame and schedules only one tab per idle slot', () => {
    const work: Array<() => void> = [], warmed: string[] = [];
    scheduleRouteWarmup(route => warmed.push(route), 'buyer', task => { work.push(task); return () => {}; });
    expect(warmed).toEqual([]);
    expect(work).toHaveLength(1);
    work.shift()!();
    expect(warmed).toEqual(['/(buyer)/discover']);
    work.shift()!();
    expect(warmed).toEqual(['/(buyer)/discover', '/(buyer)/inbox']);
  });
  it('cancels queued code evaluation on an account/role switch', () => {
    const work: Array<() => void> = [], warmed: string[] = [];
    const cancel = scheduleRouteWarmup(route => warmed.push(route), 'seller', task => { work.push(task); return () => {}; });
    cancel(); work[0]();
    expect(warmed).toEqual([]);
  });
  it('never warms authenticated screens for a signed-out role', () => {
    let scheduled = false;
    scheduleRouteWarmup(() => {}, null, () => { scheduled = true; return () => {}; });
    expect(scheduled).toBe(false);
  });
});
