import { describe, it, expect } from 'vitest';
import { describeUserAgent } from './deviceLabel';

describe('describeUserAgent', () => {
  it('names an iPhone running Safari', () => {
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'))
      .toEqual({ device: 'iPhone', browser: 'Safari', isMobile: true });
  });
  it('names Chrome on a Mac', () => {
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'))
      .toEqual({ device: 'Mac', browser: 'Chrome', isMobile: false });
  });
  it('names Edge on Windows and an Android phone', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36 Edg/126.0').device).toBe('Windows PC');
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36 Edg/126.0').browser).toBe('Edge');
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile Safari/537.36'))
      .toEqual({ device: 'Android phone', browser: 'Chrome', isMobile: true });
  });
  it('falls back for an empty or unknown agent', () => {
    expect(describeUserAgent('')).toEqual({ device: 'Web browser', browser: null, isMobile: false });
    expect(describeUserAgent(undefined).device).toBe('Web browser');
  });
});
