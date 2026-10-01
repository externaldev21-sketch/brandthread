import { describe, expect, it } from 'vitest';
import { formatNextSend, phaseLabel, timeLeft } from './sellerEngagement';

const now = new Date(2026, 5, 1, 12, 0, 0);

describe('sellerEngagement formatters', () => {
  it('describes the next send relative to today', () => {
    expect(formatNextSend(new Date(2026, 5, 1, 18, 5).toISOString(), now)).toMatch(/^today at/);
    expect(formatNextSend(new Date(2026, 5, 2, 9, 0).toISOString(), now)).toMatch(/^tomorrow at/);
    expect(formatNextSend(new Date(2026, 5, 9, 9, 0).toISOString(), now)).toMatch(/^Jun 9 at/);
    expect(formatNextSend('nope', now)).toBe('');
  });
  it('formats time left', () => {
    expect(timeLeft(new Date(now.getTime() + 2 * 86_400_000 + 4 * 3_600_000).toISOString(), now)).toBe('2d 4h left');
    expect(timeLeft(new Date(now.getTime() + 3 * 3_600_000 + 10 * 60_000).toISOString(), now)).toBe('3h 10m left');
    expect(timeLeft(new Date(now.getTime() - 1).toISOString(), now)).toBe('Ended');
  });
  it('labels phases', () => {
    expect(phaseLabel('drawn')).toBe('Winners drawn');
  });
});
