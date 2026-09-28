import { describe, it, expect } from 'vitest';
import {
  clampProgress, playedBarCount, isBarPlayed, formatVoiceClock, remainingTimeLabel,
} from '../voicePlayback';

describe('clampProgress', () => {
  it('clamps to 0..1', () => {
    expect(clampProgress(-0.4)).toBe(0);
    expect(clampProgress(1.2)).toBe(1);
    expect(clampProgress(0.5)).toBe(0.5);
  });

  it('treats NaN/Infinity as no progress, not a crash', () => {
    expect(clampProgress(NaN)).toBe(0);
    expect(clampProgress(Infinity)).toBe(0);
    expect(clampProgress(-Infinity)).toBe(0);
  });
});

describe('playedBarCount', () => {
  it('rounds a playthrough fraction into a bar index', () => {
    // Given elapsed X of total duration Y (fraction = X/Y) across 24 bars.
    expect(playedBarCount(0, 24)).toBe(0);
    expect(playedBarCount(1, 24)).toBe(24);
    expect(playedBarCount(0.5, 24)).toBe(12);
    // 10/24 ≈ 0.4167 → rounds to 10 bars played.
    expect(playedBarCount(10 / 24, 24)).toBe(10);
  });

  it('handles an empty waveform without dividing by zero', () => {
    expect(playedBarCount(0.5, 0)).toBe(0);
  });

  it('clamps out-of-range progress before counting bars', () => {
    expect(playedBarCount(-1, 24)).toBe(0);
    expect(playedBarCount(2, 24)).toBe(24);
  });
});

describe('isBarPlayed', () => {
  it('marks bars left of the current position played, the rest not', () => {
    const total = 10;
    const progress = 0.5; // 5 bars played
    const played = Array.from({ length: total }, (_, i) => isBarPlayed(i, progress, total));
    expect(played).toEqual([true, true, true, true, true, false, false, false, false, false]);
  });

  it('is fully unplayed at progress 0 and fully played at progress 1', () => {
    const total = 6;
    expect(Array.from({ length: total }, (_, i) => isBarPlayed(i, 0, total)).every((b) => !b)).toBe(true);
    expect(Array.from({ length: total }, (_, i) => isBarPlayed(i, 1, total)).every((b) => b)).toBe(true);
  });
});

describe('formatVoiceClock', () => {
  it('formats seconds as m:ss with no leading zero on minutes', () => {
    expect(formatVoiceClock(0)).toBe('0:00');
    expect(formatVoiceClock(8)).toBe('0:08');
    expect(formatVoiceClock(65)).toBe('1:05');
    expect(formatVoiceClock(125)).toBe('2:05');
  });

  it('never renders a negative value', () => {
    expect(formatVoiceClock(-5)).toBe('0:00');
  });
});

describe('remainingTimeLabel', () => {
  it('counts down from the full duration to 0:00 as progress advances', () => {
    // Given elapsed time X and total duration Y, this is Y - X formatted.
    expect(remainingTimeLabel(8, 0)).toBe('0:08');
    expect(remainingTimeLabel(8, 0.5)).toBe('0:04');
    expect(remainingTimeLabel(8, 1)).toBe('0:00');
  });

  it('matches the seeded preview voice note duration at a mid-playback point', () => {
    // Real bundled clip duration seeded in lib/previewInbox.ts.
    const durationSec = 1.3;
    expect(remainingTimeLabel(durationSec, 0)).toBe('0:01');
    expect(remainingTimeLabel(durationSec, 1)).toBe('0:00');
  });

  it('falls back to 0:00 for a zero or invalid duration', () => {
    expect(remainingTimeLabel(0, 0.5)).toBe('0:00');
    expect(remainingTimeLabel(NaN, 0.5)).toBe('0:00');
    expect(remainingTimeLabel(-3, 0.5)).toBe('0:00');
  });
});
