import { describe, expect, it } from 'vitest';
import { formatTimeRemaining, formatTimeUntil } from './countdown';

describe('formatTimeUntil', () => {
  it('returns empty string for no date', () => {
    expect(formatTimeUntil(null)).toBe('');
    expect(formatTimeUntil(undefined)).toBe('');
  });
  it('returns "Live now" once the time has passed', () => {
    expect(formatTimeUntil(new Date(Date.now() - 1000).toISOString())).toBe('Live now');
  });
  it('formats under 24h in hours', () => {
    expect(formatTimeUntil(new Date(Date.now() + 5 * 3_600_000).toISOString())).toBe('In 5h');
  });
  it('formats 24h+ in days', () => {
    expect(formatTimeUntil(new Date(Date.now() + 50 * 3_600_000).toISOString())).toBe('In 2d');
  });
});

describe('formatTimeRemaining', () => {
  it('returns null for no date', () => {
    expect(formatTimeRemaining(null)).toBeNull();
    expect(formatTimeRemaining(undefined)).toBeNull();
  });
  it('returns null once the time has already passed (no stale/negative badge)', () => {
    expect(formatTimeRemaining(new Date(Date.now() - 1000).toISOString())).toBeNull();
  });
  it('formats under 1h in minutes', () => {
    expect(formatTimeRemaining(new Date(Date.now() + 30 * 60_000).toISOString())).toBe('Ends in 30m');
  });
  it('formats under 24h in hours', () => {
    expect(formatTimeRemaining(new Date(Date.now() + 9 * 3_600_000).toISOString())).toBe('Ends in 9h');
  });
  it('formats 24h+ in days', () => {
    expect(formatTimeRemaining(new Date(Date.now() + 50 * 3_600_000).toISOString())).toBe('Ends in 2d');
  });
});
