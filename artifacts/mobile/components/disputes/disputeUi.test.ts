import { describe, expect, it } from 'vitest';
import { demoSteps, dueChipLabel, formatBytes, statusLabel } from './disputeUi';

const now = Date.parse('2026-10-10T12:00:00Z');
const inDays = (d: number) => new Date(now + d * 86_400_000).toISOString();

describe('dispute ui helpers', () => {
  it('labels the due chip', () => {
    expect(dueChipLabel(inDays(5), now)).toBe('Due in 5 days');
    expect(dueChipLabel(inDays(1), now)).toBe('Due in 1 day');
    expect(dueChipLabel(inDays(-2), now)).toBe('Past due');
    expect(dueChipLabel(null, now)).toBeNull();
  });

  it('labels statuses and sizes', () => {
    expect(statusLabel('needs_response')).toBe('Needs response');
    expect(statusLabel('under_review')).toBe('Under review');
    expect(formatBytes(2048)).toBe('2 KB');
  });

  it('builds the five steps for each status', () => {
    const states = (s: string) => demoSteps(s, inDays(-3), inDays(5)).map((x) => x.state);
    expect(states('needs_response')).toEqual(['done', 'current', 'upcoming', 'upcoming', 'upcoming']);
    expect(states('under_review')).toEqual(['done', 'done', 'done', 'current', 'upcoming']);
    expect(states('won')).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(demoSteps('lost', inDays(-3), null)[4].label).toBe('Lost');
  });
});
