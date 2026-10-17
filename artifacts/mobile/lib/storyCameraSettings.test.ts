import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STORY_CAMERA_SETTINGS,
  parseStoryCameraSettings,
  toggleStoryCameraSetting,
} from './storyCameraSettings';

describe('storyCameraSettings', () => {
  it('falls back to defaults for missing or corrupt storage', () => {
    expect(parseStoryCameraSettings(null)).toEqual(DEFAULT_STORY_CAMERA_SETTINGS);
    expect(parseStoryCameraSettings('{bad')).toEqual(DEFAULT_STORY_CAMERA_SETTINGS);
    expect(parseStoryCameraSettings('{"gridLines":"yes"}')).toEqual(DEFAULT_STORY_CAMERA_SETTINGS);
  });

  it('reads stored values', () => {
    expect(parseStoryCameraSettings('{"gridLines":true,"mirrorFront":false}')).toEqual({ gridLines: true, mirrorFront: false });
  });

  it('toggles one setting without touching the other', () => {
    const next = toggleStoryCameraSetting({ gridLines: false, mirrorFront: true }, 'gridLines');
    expect(next).toEqual({ gridLines: true, mirrorFront: true });
  });
});
