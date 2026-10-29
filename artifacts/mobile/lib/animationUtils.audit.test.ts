import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { snapToDevicePixel } from './animationUtils';

const originalOS = Platform.OS;
afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
  vi.unstubAllGlobals();
});

describe('snapToDevicePixel', () => {
  it('returns the value unchanged off web, even though React Native defines a global window', () => {
    (Platform as { OS: string }).OS = 'ios';
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    expect(snapToDevicePixel(15.3)).toBe(15.3);
  });

  it('snaps to the nearest device pixel on web', () => {
    (Platform as { OS: string }).OS = 'web';
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    expect(snapToDevicePixel(15.3)).toBe(15.5);
  });
});
