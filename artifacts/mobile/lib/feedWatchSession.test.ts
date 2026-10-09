import { describe, expect, it } from 'vitest';
import { createWatchSession } from './feedWatchSession';

function play(session: ReturnType<typeof createWatchSession>, from: number, to: number, duration: number, step = 0.25) {
  for (let t = from; t <= to + 1e-9; t += step) session.onTime(Number(t.toFixed(3)), duration, true);
}

describe('createWatchSession', () => {
  it('reports a skip when the viewer swipes away almost immediately', () => {
    const session = createWatchSession();
    play(session, 0, 0.75, 20);
    expect(session.finish()).toEqual([{ type: 'skip' }]);
  });

  it('reports the completion fraction for a partial watch', () => {
    const session = createWatchSession();
    play(session, 0, 10, 20);
    expect(session.finish()).toEqual([{ type: 'watch_time', value: '0.50' }]);
  });

  it('reports full completion and a rewatch once the clip loops', () => {
    const session = createWatchSession();
    play(session, 0, 9.75, 10);
    session.onTime(0.25, 10, true);
    play(session, 0.5, 3, 10);
    expect(session.finish()).toEqual([{ type: 'watch_time', value: '1.00' }, { type: 'rewatch' }]);
  });

  it('does not count a seek forward as watching', () => {
    const session = createWatchSession();
    play(session, 0, 0.5, 60);
    session.onTime(30, 60, true); // scrubbed
    session.onTime(30.25, 60, true);
    const signals = session.finish();
    expect(signals[0]).toEqual({ type: 'watch_time', value: '0.50' });
  });

  it('ignores paused time', () => {
    const session = createWatchSession();
    session.onTime(0, 20, true);
    for (let i = 0; i < 20; i++) session.onTime(0.25, 20, false);
    expect(session.finish()).toEqual([{ type: 'skip' }]);
  });

  it('reports nothing when the clip never loaded', () => {
    expect(createWatchSession().finish()).toEqual([]);
  });

  it('a short clip watched to the end is not a skip', () => {
    const session = createWatchSession();
    play(session, 0, 1.25, 1.25);
    expect(session.finish()).toEqual([{ type: 'watch_time', value: '1.00' }]);
  });
});
