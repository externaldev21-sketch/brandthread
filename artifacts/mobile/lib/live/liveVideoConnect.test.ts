import { describe, expect, it } from 'vitest';
import {
  LIVE_VIDEO_CONNECT_TIMEOUT_MS,
  canRetryLiveVideo,
  liveVideoPlaceholderText,
} from './liveVideoConnect';

describe('liveVideoConnect', () => {
  it('has a bounded connect timeout', () => {
    expect(LIVE_VIDEO_CONNECT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LIVE_VIDEO_CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it('shows an error (not Connecting…) after a failure', () => {
    expect(liveVideoPlaceholderText('failed')).not.toMatch(/Connecting/);
    expect(liveVideoPlaceholderText('failed')).toMatch(/Couldn’t connect/);
    expect(liveVideoPlaceholderText('connecting')).toBe('Connecting…');
    expect(liveVideoPlaceholderText('unsupported')).toMatch(/Brandthread app/);
  });

  it('offers retry only for failures', () => {
    expect(canRetryLiveVideo('failed')).toBe(true);
    expect(canRetryLiveVideo('connecting')).toBe(false);
    expect(canRetryLiveVideo('unsupported')).toBe(false);
    expect(canRetryLiveVideo('connected')).toBe(false);
  });
});
