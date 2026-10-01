/**
 * layers-panel-model.test.ts — pure-function unit coverage for
 * lib/layersPanelModel.ts, which drives the Layers panel's drag-reorder
 * math, swipe-to-reveal math, and blend-mode letter.
 */
import { describe, it, expect } from 'vitest';
import {
  blendLetter,
  computeDragTargetIndex,
  clampSwipeTranslateX,
  shouldSwipeOpen,
} from '../lib/layersPanelModel';

describe('blendLetter', () => {
  it('returns the uppercase first letter of the blend mode', () => {
    expect(blendLetter('normal')).toBe('N');
    expect(blendLetter('multiply')).toBe('M');
    expect(blendLetter('screen')).toBe('S');
    expect(blendLetter('overlay')).toBe('O');
    expect(blendLetter('darken')).toBe('D');
    expect(blendLetter('lighten')).toBe('L');
  });

  it('defaults to "N" (normal) when no blend mode is set', () => {
    expect(blendLetter(undefined)).toBe('N');
  });
});

describe('computeDragTargetIndex', () => {
  const ROW_HEIGHT = 64;
  const LIST_LEN = 5;

  it('stays at the start index with no movement', () => {
    expect(computeDragTargetIndex(2, 0, ROW_HEIGHT, LIST_LEN)).toBe(2);
  });

  it('moves down one row per full row-height of downward drag', () => {
    expect(computeDragTargetIndex(0, ROW_HEIGHT, ROW_HEIGHT, LIST_LEN)).toBe(1);
    expect(computeDragTargetIndex(0, ROW_HEIGHT * 2, ROW_HEIGHT, LIST_LEN)).toBe(2);
  });

  it('moves up one row per full row-height of upward drag', () => {
    expect(computeDragTargetIndex(3, -ROW_HEIGHT, ROW_HEIGHT, LIST_LEN)).toBe(2);
  });

  it('rounds partial drags to the nearest row', () => {
    expect(computeDragTargetIndex(0, ROW_HEIGHT * 0.4, ROW_HEIGHT, LIST_LEN)).toBe(0); // rounds down to 0 rows
    expect(computeDragTargetIndex(0, ROW_HEIGHT * 0.6, ROW_HEIGHT, LIST_LEN)).toBe(1); // rounds up to 1 row
  });

  it('clamps to the top of the list', () => {
    expect(computeDragTargetIndex(0, -ROW_HEIGHT * 10, ROW_HEIGHT, LIST_LEN)).toBe(0);
  });

  it('clamps to the bottom of the list', () => {
    expect(computeDragTargetIndex(0, ROW_HEIGHT * 10, ROW_HEIGHT, LIST_LEN)).toBe(LIST_LEN - 1);
  });
});

describe('clampSwipeTranslateX', () => {
  const ACTIONS_WIDTH = 168;

  it('never goes positive (row cannot swipe right past closed)', () => {
    expect(clampSwipeTranslateX(0, 50, ACTIONS_WIDTH)).toBe(0);
  });

  it('never exceeds -actionsWidth (row cannot overshoot fully open)', () => {
    expect(clampSwipeTranslateX(0, -500, ACTIONS_WIDTH)).toBe(-ACTIONS_WIDTH);
  });

  it('tracks the drag linearly within bounds', () => {
    expect(clampSwipeTranslateX(0, -80, ACTIONS_WIDTH)).toBe(-80);
  });

  it('continues from an already-open base position', () => {
    // Row was fully open (-168); dragging right by 40 should ease it toward closed.
    expect(clampSwipeTranslateX(-ACTIONS_WIDTH, 40, ACTIONS_WIDTH)).toBe(-ACTIONS_WIDTH + 40);
  });
});

describe('shouldSwipeOpen', () => {
  const THRESHOLD = 44;

  it('stays closed for a short drag from closed', () => {
    expect(shouldSwipeOpen(0, -20, THRESHOLD)).toBe(false);
  });

  it('opens once the drag passes the threshold from closed', () => {
    expect(shouldSwipeOpen(0, -60, THRESHOLD)).toBe(true);
  });

  it('stays open for a short drag back from fully open', () => {
    // base=-168 (open), small rightward drag of +30 keeps total well past -threshold.
    expect(shouldSwipeOpen(-168, 30, THRESHOLD)).toBe(true);
  });

  it('closes when dragged far enough right from open', () => {
    // base=-168 (open), dragging +150 right brings it to -18, above -44 threshold,
    // and the raw per-gesture dx (+150) is also not a leftward swipe.
    expect(shouldSwipeOpen(-168, 150, THRESHOLD)).toBe(false);
  });
});
