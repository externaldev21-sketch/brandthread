import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  let ratio = 3;
  return {
    PixelRatio: {
      get: () => ratio,
      roundToNearestPixel: (n: number) => Math.round(n * ratio) / ratio,
      __setRatio: (r: number) => { ratio = r; },
    },
  };
});

describe('crispPx', () => {
  it('lands every length on a whole device pixel', async () => {
    const { crispPx } = await import('./crispPixel');
    const { PixelRatio } = (await import('react-native')) as unknown as { PixelRatio: { get(): number; __setRatio(r: number): void } };
    for (const ratio of [2, 3]) {
      PixelRatio.__setRatio(ratio);
      for (const n of [1.5, 2.5, 0.5, 3.5]) {
        const devicePixels = crispPx(n) * ratio;
        expect(Math.abs(devicePixels - Math.round(devicePixels))).toBeLessThan(1e-9);
        expect(Math.abs(crispPx(n) - n)).toBeLessThanOrEqual(0.5 / ratio + 1e-9);
      }
    }
  });
});
