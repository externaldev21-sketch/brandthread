import { afterEach, describe, expect, it } from 'vitest';
import { createPerfRecord, droppedFramesFor, processStartMs, pushBounded, summarizeFrames } from '../lib/perfCore';
import { isSkiaAvailable, loadSkia } from '../lib/skiaAvailability.web';

const perf = globalThis.performance as unknown as { rnStartupTiming?: unknown };

describe('perfCore — frame drop math', () => {
  it('counts frames missed inside one long gap', () => {
    expect(droppedFramesFor(16.7, 16.7)).toBe(0);
    expect(droppedFramesFor(33.4, 16.7)).toBe(1);
    expect(droppedFramesFor(100, 16.7)).toBe(5);
    expect(droppedFramesFor(0, 16.7)).toBe(0);
    expect(droppedFramesFor(50, 0)).toBe(0);
  });

  it('summarises a scroll against the display refresh rate it observed', () => {
    const smooth60 = Array.from({ length: 61 }, (_, i) => i * 16.67);
    expect(summarizeFrames('feed', smooth60)).toMatchObject({ frames: 61, droppedFrames: 0, durationMs: 1000 });

    const hitch = [0, 16.7, 33.4, 50.1, 150.1, 166.8];
    const sample = summarizeFrames('feed', hitch);
    expect(sample.droppedFrames).toBe(5);
    expect(sample.worstFrameMs).toBe(100);

    // 120 Hz: an 16.7ms gap is one missed frame there.
    const promotion = [0, 8.33, 16.66, 33.33, 41.66];
    expect(summarizeFrames('feed', promotion).droppedFrames).toBe(1);
  });

  it('handles too few frames', () => {
    expect(summarizeFrames('feed', [])).toMatchObject({ frames: 0, droppedFrames: 0, worstFrameMs: 0, durationMs: 0 });
    expect(summarizeFrames('feed', [5])).toMatchObject({ frames: 1, droppedFrames: 0, durationMs: 0 });
  });
});

describe('perfCore — process start', () => {
  afterEach(() => {
    delete perf.rnStartupTiming;
  });

  it('is navigation start (0) on web', () => {
    expect(processStartMs(true)).toBe(0);
  });

  it("uses React Native's startup timing on native when it is plausible", () => {
    perf.rnStartupTiming = { startTime: 100 };
    expect(processStartMs(false, 1_500)).toBe(100);
  });

  it('never guesses: missing, zero or implausible values are null', () => {
    expect(processStartMs(false, 1_500)).toBeNull();
    perf.rnStartupTiming = { startTime: 0 };
    expect(processStartMs(false, 1_500)).toBeNull();
    perf.rnStartupTiming = { startTime: 2_000 };
    expect(processStartMs(false, 1_500)).toBeNull();
    perf.rnStartupTiming = { startTime: 1 };
    expect(processStartMs(false, 500_000)).toBeNull();
  });
});

describe('perfCore — record', () => {
  it('keeps a bounded history', () => {
    const record = createPerfRecord();
    for (let i = 0; i < 80; i++) pushBounded(record.screens, { screen: `s${i}`, ms: i, cold: false });
    expect(record.screens).toHaveLength(50);
    expect(record.screens[0].screen).toBe('s30');
  });
});

describe('skiaAvailability.web', () => {
  it('always reports Skia unavailable on web (CanvasKit is never loaded)', () => {
    expect(loadSkia()).toBeNull();
    expect(isSkiaAvailable()).toBe(false);
  });
});
