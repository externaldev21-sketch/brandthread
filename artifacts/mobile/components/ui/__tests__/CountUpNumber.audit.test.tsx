/**
 * CountUpNumber must always land on the latest `value`, and a value that
 * changes mid-animation must continue from what is on screen — not restart
 * from the previous animation's start, and never get stuck part-way.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { text: '#fff', background: '#000', border: '#333' } }) }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ foreground: '#fff', mutedForeground: '#999' }) }));
vi.mock('@/lib/haptics', () => ({ haptics: { light: () => {} }, hapticFollow: () => {} }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

import { CountUpNumber } from '../MotionPrimitives';

let frames: Array<{ id: number; cb: (t: number) => void }> = [];
let nextId = 1;
let clock = 0;

function step(ms: number) {
  clock += ms;
  const run = frames;
  frames = [];
  act(() => { run.forEach((f) => f.cb(clock)); });
}

function shown(r: ReactTestRenderer): string {
  return String(r.root.findByType('Text' as never).props.children);
}

beforeEach(() => {
  frames = []; nextId = 1; clock = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { const id = nextId++; frames.push({ id, cb }); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames = frames.filter((f) => f.id !== id); });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('CountUpNumber', () => {
  it('settles on the new value when it changes back mid-animation', () => {
    let r!: ReactTestRenderer;
    act(() => { r = create(<CountUpNumber value={0} durationMs={400} />); });
    act(() => { r.update(<CountUpNumber value={100} durationMs={400} />); });
    step(0);   // animation start
    step(200); // part-way
    const mid = Number(shown(r));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    // Value goes back to where the previous animation started.
    act(() => { r.update(<CountUpNumber value={0} durationMs={400} />); });
    for (let i = 0; i < 10; i++) step(100);
    expect(shown(r)).toBe('0');
    act(() => r.unmount());
  });

  it('continues from the on-screen number when interrupted (no jump back)', () => {
    let r!: ReactTestRenderer;
    act(() => { r = create(<CountUpNumber value={0} durationMs={400} />); });
    act(() => { r.update(<CountUpNumber value={100} durationMs={400} />); });
    step(0);
    step(200);
    const mid = Number(shown(r));
    act(() => { r.update(<CountUpNumber value={200} durationMs={400} />); });
    step(0); // first frame of the new animation
    expect(Number(shown(r))).toBeGreaterThanOrEqual(mid);
    for (let i = 0; i < 10; i++) step(100);
    expect(shown(r)).toBe('200');
    act(() => r.unmount());
  });
});
