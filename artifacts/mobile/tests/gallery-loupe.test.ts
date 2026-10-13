import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/haptics', () => ({ hapticLight: () => {} }));
vi.mock('react-native', () => ({ Image: 'Image', StyleSheet: { create: (s: unknown) => s }, View: 'View' }));

const { loupeFrame, LOUPE_SIZE, LOUPE_ZOOM } = await import('../components/products/GalleryLoupe');

describe('loupeFrame (polish 82)', () => {
  const W = 393, H = 524;
  const r = LOUPE_SIZE / 2;

  it('sits above the finger and centres the touched spot', () => {
    const f = loupeFrame({ x: 200, y: 300 }, W, H);
    expect(f.left).toBe(200 - r);
    expect(f.top).toBeLessThan(300 - r);
    // The touched pixel lands in the middle of the circle.
    expect(f.imageLeft + 200 * LOUPE_ZOOM).toBe(r);
    expect(f.imageTop + 300 * LOUPE_ZOOM).toBe(r);
  });

  it('stays inside the photo at the edges', () => {
    const f = loupeFrame({ x: 2, y: 10 }, W, H);
    expect(f.left).toBe(0);
    expect(f.top).toBe(0);
    const g = loupeFrame({ x: W - 1, y: H - 1 }, W, H);
    expect(g.left).toBe(W - LOUPE_SIZE);
    expect(g.top).toBeLessThanOrEqual(H - LOUPE_SIZE);
    expect(g.imageLeft + (W - 1) * LOUPE_ZOOM).toBe(r);
  });
});
