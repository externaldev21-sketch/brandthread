import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../components/closet/UnboxingMoment.tsx', import.meta.url), 'utf8');

describe('unboxing moment rules', () => {
  it('runs under 1.2 s', () => {
    const ms = Number(src.match(/UNBOXING_DURATION_MS = (\d+)/)?.[1]);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1200);
  });
  it('respects Reduce Motion, can be skipped, and fires at most one haptic', () => {
    expect(src).toContain('useReduceMotion');
    expect(src).toContain('onPress={skip}');
    expect(src.match(/haptic[A-Z]\w*\(/g)?.length).toBe(1);
  });
  it('plays no sound and sends no push', () => {
    expect(src).not.toMatch(/expo-av|expo-audio|Notifications/);
  });
  it('stamps the moment as seen as soon as it is shown', () => {
    expect(src).toContain('markUnboxingSeen()');
  });
});
