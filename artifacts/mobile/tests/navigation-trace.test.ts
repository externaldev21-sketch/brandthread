import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/buildFlags', () => ({ PERF_MARKS: false }));
import { createNavigationTrace, focusedNavigationKey } from '@/lib/navigation/navigationTrace';

describe('navigation trace', () => {
  let time = 0;
  beforeEach(() => { time = 0; });
  it('tracks the active leaf key for consecutive pushes of the same route pattern', () => {
    const state = { routes: [{ key: 'root', state: { index: 1, routes: [{ key: 'hidden' }, { key: 'detail-2' }] } }] };
    expect(focusedNavigationKey(state)).toBe('root/detail-2/');
    expect(focusedNavigationKey(undefined)).toBe('');
  });
  it('measures from input and dispatch, not from automation completion', () => {
    const trace = createNavigationTrace(() => time);
    trace.input(); time = 10; trace.dispatch();
    time = 25; trace.frame();
    const finish = trace.commit('(buyer)/discover');
    time = 42; finish(); time = 900;
    expect(trace.entries[0]).toMatchObject({ inputToFrameMs: 42, dispatchToFrameMs: 32, commitToFrameMs: 17 });
  });
  it('never attributes an old touch to programmatic navigation', () => {
    const trace = createNavigationTrace(() => time);
    trace.input(); time = 3000; trace.commit('(tabs)/orders')();
    expect(trace.entries[0].inputToFrameMs).toBeNull();
  });
  it('bounds records and rejects superseded route commits', () => {
    const trace = createNavigationTrace(() => time, 2);
    trace.dispatch(); const stale = trace.commit('old');
    trace.input(); stale(); expect(trace.entries).toHaveLength(0);
    for (const route of ['one', 'two', 'three']) trace.commit(route)();
    expect(trace.entries.map(e => e.route)).toEqual(['two', 'three']);
    trace.clear(); expect(trace.entries).toHaveLength(0);
  });
  it('records missed JS intervals without calling them native dropped frames', () => {
    const trace = createNavigationTrace(() => time);
    trace.input(); time = 100; trace.frame(); trace.commit('screen')();
    expect(trace.entries[0]).toMatchObject({ missedJsFrameIntervals: 5, worstJsFrameMs: 100 });
  });
});
