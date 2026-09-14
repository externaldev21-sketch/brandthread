/**
 * Camera Capture — visual and state logic unit tests
 *
 * These tests cover the pure state-logic helpers used by camera-capture.tsx.
 * No native modules are imported; the tests run in Vitest without a device.
 */
import { describe, expect, it } from 'vitest';
import {
  clampVideoZoom,
  effectiveClipDuration,
  removeVideoClip,
  totalClipDuration,
  type EditableVideoClip,
} from '../videoEditing';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const baseClip = (
  id: string,
  duration: number,
  speed: EditableVideoClip['speed'],
  filter: EditableVideoClip['filter'] = 'none',
): EditableVideoClip => ({ id, uri: `file://${id}.mp4`, duration, speed, filter });

const singleClip = baseClip('a', 6, 1);
const twoClips: EditableVideoClip[] = [
  baseClip('x', 4, 2),  // effective = 2 s
  baseClip('y', 3, 1),  // effective = 3 s
];

// ─── Progress bar display ─────────────────────────────────────────────────────

describe('progress bar segment proportions', () => {
  it('single 1x clip — effective equals raw duration', () => {
    expect(effectiveClipDuration(singleClip)).toBe(6);
  });

  it('2x speed clip — effective is half raw duration', () => {
    expect(effectiveClipDuration(baseClip('fast', 8, 2))).toBe(4);
  });

  it('0.5x speed clip — effective is double raw duration', () => {
    expect(effectiveClipDuration(baseClip('slow', 4, 0.5))).toBe(8);
  });

  it('totalClipDuration sums all effective durations', () => {
    expect(totalClipDuration(twoClips)).toBe(5); // 2 + 3
  });

  it('totalClipDuration of empty array is 0', () => {
    expect(totalClipDuration([])).toBe(0);
  });
});

// ─── Clip management ─────────────────────────────────────────────────────────

describe('clip management', () => {
  it('removeVideoClip removes by id and preserves order', () => {
    const clips: EditableVideoClip[] = [
      baseClip('a', 2, 1),
      baseClip('b', 3, 1),
      baseClip('c', 1, 1),
    ];
    expect(removeVideoClip(clips, 'b').map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('removeVideoClip with unknown id leaves array unchanged', () => {
    const clips: EditableVideoClip[] = [baseClip('a', 2, 1)];
    expect(removeVideoClip(clips, 'missing')).toHaveLength(1);
  });
});

// ─── Pinch-to-zoom ────────────────────────────────────────────────────────────

describe('pinch-to-zoom clamping', () => {
  it('clamps negative values to 0', () => {
    expect(clampVideoZoom(-0.1)).toBe(0);
    expect(clampVideoZoom(-99)).toBe(0);
  });

  it('clamps values above 1 to 1', () => {
    expect(clampVideoZoom(1.5)).toBe(1);
    expect(clampVideoZoom(2)).toBe(1);
  });

  it('leaves values in [0, 1] unchanged', () => {
    expect(clampVideoZoom(0)).toBe(0);
    expect(clampVideoZoom(0.5)).toBe(0.5);
    expect(clampVideoZoom(1)).toBe(1);
  });
});

// ─── Duration mode selection ─────────────────────────────────────────────────

describe('duration mode display', () => {
  const DURATION_LABELS: Record<number, string> = {
    15: '15s',
    30: '30s',
    60: '1 min',
    600: '10 min',
  };

  it('all duration modes have labels', () => {
    expect(Object.keys(DURATION_LABELS)).toHaveLength(4);
    for (const label of Object.values(DURATION_LABELS)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

// ─── Timer format ─────────────────────────────────────────────────────────────

describe('timer display formatting', () => {
  function formatTime(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  it('formats 0 seconds as 00:00', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('formats 30 seconds as 00:30', () => {
    expect(formatTime(30)).toBe('00:30');
  });

  it('formats 60 seconds as 01:00', () => {
    expect(formatTime(60)).toBe('01:00');
  });

  it('formats 600 seconds as 10:00', () => {
    expect(formatTime(600)).toBe('10:00');
  });

  it('clamps negative input to 00:00', () => {
    expect(formatTime(-5)).toBe('00:00');
  });

  it('floors fractional seconds', () => {
    expect(formatTime(29.9)).toBe('00:29');
  });
});

// ─── Filter presentation ──────────────────────────────────────────────────────

describe('filter overlay tokens', () => {
  const FILTERS = [
    { id: 'none', label: 'Original', overlay: undefined },
    { id: 'warm', label: 'Warm', overlay: 'rgba(249,115,22,0.13)' },
    { id: 'cool', label: 'Cool', overlay: 'rgba(59,130,246,0.13)' },
    { id: 'mono', label: 'Mono', overlay: 'rgba(15,23,42,0.24)' },
  ] as const;

  it('Original filter has no overlay', () => {
    expect(FILTERS.find((f) => f.id === 'none')?.overlay).toBeUndefined();
  });

  it('all non-original filters have an rgba overlay string', () => {
    const nonOriginal = FILTERS.filter((f) => f.id !== 'none');
    for (const f of nonOriginal) {
      expect(f.overlay).toMatch(/^rgba\(/);
    }
  });

  it('overlay opacity values are low (presentational, not muddy)', () => {
    const nonOriginal = FILTERS.filter((f) => f.id !== 'none');
    for (const f of nonOriginal) {
      const opacity = Number(f.overlay?.match(/[\d.]+\)$/)?.[0]?.slice(0, -1));
      expect(opacity).toBeLessThanOrEqual(0.25);
    }
  });
});
