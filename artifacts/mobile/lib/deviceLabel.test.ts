import { describe, expect, it } from 'vitest';
import { deviceLabelFromUserAgent } from './deviceLabel';

describe('deviceLabelFromUserAgent', () => {
  it('names iPhone Safari', () => {
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
  });
  it('names Chrome on iOS as Chrome', () => {
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Chrome');
  });
  it('names Mac Chrome and Windows Edge', () => {
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')).toBe('Mac · Chrome');
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0')).toBe('Windows PC · Edge');
  });
  it('names Android phones', () => {
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36')).toBe('Android phone · Chrome');
  });
  it('returns null when nothing is recognisable', () => {
    expect(deviceLabelFromUserAgent('')).toBeNull();
    expect(deviceLabelFromUserAgent(undefined)).toBeNull();
    expect(deviceLabelFromUserAgent('curl/8.0')).toBeNull();
  });
});
