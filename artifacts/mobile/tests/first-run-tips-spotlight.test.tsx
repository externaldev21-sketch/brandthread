import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' }, Pressable: 'Pressable', View: 'View',
  StyleSheet: { create: (s: object) => s, absoluteFill: {} },
}));

import { holeFor, SPOTLIGHT_DIM, SPOTLIGHT_HOLE_PADDING } from '../components/first-run-tips/SpotlightOverlay';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('spotlight presentation', () => {
  it('pads the hole ~10 and clamps it to the screen', () => {
    expect(SPOTLIGHT_HOLE_PADDING).toBe(10);
    expect(holeFor({ x: 50, y: 100, width: 80, height: 40 }, 400, 800)).toEqual({ x: 40, y: 90, width: 100, height: 60 });
    expect(holeFor({ x: 2, y: 780, width: 50, height: 30 }, 400, 800)).toEqual({ x: 0, y: 770, width: 62, height: 30 });
  });

  it('uses a 60% black dim', () => {
    expect(SPOTLIGHT_DIM).toBe('rgba(0,0,0,0.6)');
  });

  it('never puts a full-screen Pressable over the target', () => {
    const spot = src('components/first-run-tips/SpotlightTip.tsx');
    expect(spot).not.toMatch(/<Pressable style=\{StyleSheet\.absoluteFill\}/);
    const overlay = src('components/first-run-tips/SpotlightOverlay.tsx');
    expect(overlay).toMatch(/pointerEvents="box-none"/);
    expect(overlay).toMatch(/testID="spotlight-hole"[\s\S]*?|pointerEvents="none"/);
  });
});
