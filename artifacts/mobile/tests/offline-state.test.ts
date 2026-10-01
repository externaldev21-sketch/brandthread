import { describe, expect, it } from 'vitest';
import { nextOffline, probeUrl, shouldProbe } from '@/lib/offlineState';

describe('offline state', () => {
  it('starts online and stays online on a healthy probe', () => {
    expect(nextOffline(false, { type: 'probe', reached: true })).toBe(false);
  });
  it('browser offline event flips offline; online event recovers', () => {
    expect(nextOffline(false, { type: 'browser-offline' })).toBe(true);
    expect(nextOffline(true, { type: 'browser-online' })).toBe(false);
  });
  it('a failed probe means offline, a reached probe recovers', () => {
    expect(nextOffline(false, { type: 'probe', reached: false })).toBe(true);
    expect(nextOffline(true, { type: 'probe', reached: true })).toBe(false);
  });
  it('a suspected network failure alone never shows the banner', () => {
    expect(nextOffline(false, { type: 'suspect-offline' })).toBe(false);
    expect(nextOffline(true, { type: 'suspect-offline' })).toBe(true);
  });
  it('probes on suspicion and browser-offline only', () => {
    expect(shouldProbe({ type: 'suspect-offline' })).toBe(true);
    expect(shouldProbe({ type: 'browser-offline' })).toBe(true);
    expect(shouldProbe({ type: 'browser-online' })).toBe(false);
    expect(shouldProbe({ type: 'probe', reached: false })).toBe(false);
  });
  it('builds the probe url and refuses a missing base', () => {
    expect(probeUrl('https://api.example.com/')).toBe('https://api.example.com/api/healthz');
    expect(probeUrl(undefined)).toBeNull();
    expect(probeUrl('https://undefined')).toBeNull();
  });
});
