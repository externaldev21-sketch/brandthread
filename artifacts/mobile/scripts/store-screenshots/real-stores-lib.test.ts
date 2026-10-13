import { describe, expect, it } from 'vitest';
import { PREVIEW, ffmpegArgs, parseHandles, parseWebOrigin, shotsFor } from './real-stores-lib.mjs';

describe('real-store capture helpers', () => {
  it('parses up to three clean handles', () => {
    expect(parseHandles(' @GalleriaDesires, second ,second, bad handle!, third, fourth')).toEqual(['galleriadesires', 'second', 'third']);
    expect(parseHandles(undefined)).toEqual([]);
  });

  it('only accepts https origins (http for localhost)', () => {
    expect(parseWebOrigin('https://brandthread.app/some/path')).toBe('https://brandthread.app');
    expect(parseWebOrigin('http://brandthread.app')).toBeNull();
    expect(parseWebOrigin('http://127.0.0.1:5655')).toBe('http://127.0.0.1:5655');
    expect(parseWebOrigin('nope')).toBeNull();
  });

  it('captures the public storefront and its first product', () => {
    expect(shotsFor('desires')).toEqual([
      { id: 'desires-store', path: '/store/desires', title: '@desires storefront' },
      { id: 'desires-product', path: null, from: '/store/desires', title: '@desires product' },
    ]);
  });

  it('encodes App Store preview specs: 886x1920, 30 fps, H.264 + AAC, 15-30 s', () => {
    expect(PREVIEW).toMatchObject({ width: 886, height: 1920, fps: 30 });
    const short = ffmpegArgs('in.webm', 'out.mp4', 9);
    expect(short[short.indexOf('-t') + 1]).toBe('15');
    expect(short.join(' ')).toContain('tpad=stop_mode=clone');
    expect(short).toEqual(expect.arrayContaining(['libx264', 'yuv420p', 'aac']));
    const long = ffmpegArgs('in.webm', 'out.mp4', 48);
    expect(long[long.indexOf('-t') + 1]).toBe('30');
  });
});
