import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatReplayDuration } from '../lib/liveReplayFormat';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('live_tips flag (client)', () => {
  it('defaults OFF so a failed flag call never shows the gift button', () => {
    expect(read('contexts/FeatureFlagContext.tsx')).toMatch(/live_tips: false/);
  });
  it('the live viewer only wires the gift button and sheet when the flag is ON', () => {
    const src = read('app/live.tsx');
    expect(src).toMatch(/useFeatureFlag\('live_tips'\)/);
    expect(src).toMatch(/onGift=\{liveTipsEnabled \? \(\) => gift\(item\) : undefined\}/);
    expect(src).toMatch(/liveTipsEnabled && giftFor/);
  });
});

describe('formatReplayDuration', () => {
  it('formats and never invents a duration', () => {
    expect(formatReplayDuration(45)).toBe('0:45');
    expect(formatReplayDuration(1800)).toBe('30:00');
    expect(formatReplayDuration(3723)).toBe('1:02:03');
    expect(formatReplayDuration(null)).toBeNull();
    expect(formatReplayDuration(0)).toBeNull();
  });
});
