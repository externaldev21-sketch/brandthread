/**
 * Audit regression: AnalyticsBarChart draws its y-axis labels at evenly
 * spaced heights, but niceLevels rounded each fractional step — so a chart
 * whose biggest bar was 2 was labeled "0, 1, 1, 2, 2" with "1" sitting on the
 * 0.5 gridline, and a max of 1 read "0, 0, 1, 1, 1". Every label must equal
 * the value at the height it's drawn.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AnalyticsBarChart, niceLevels } = await import('./AnalyticsKit');

describe('niceLevels', () => {
  it('never repeats a level for small whole-number maxima', () => {
    for (const max of [1, 2, 3, 5, 7, 9, 10, 40]) {
      const levels = niceLevels(max);
      expect(new Set(levels).size, `max ${max}: ${levels.join(',')}`).toBe(levels.length);
    }
  });

  it('keeps every level evenly spaced from 0 to the top', () => {
    for (const max of [1, 2, 3, 5, 7, 9, 10, 37, 3977, 0.3]) {
      const levels = niceLevels(max);
      const step = levels[1] - levels[0];
      levels.forEach((v, i) => expect(v, `max ${max}`).toBeCloseTo(step * i, 9));
      expect(levels[levels.length - 1]).toBeGreaterThanOrEqual(max);
    }
  });

  it('keeps four steps where they divide evenly', () => {
    expect(niceLevels(80)).toEqual([0, 20, 40, 60, 80]);
    expect(niceLevels(3977)).toEqual([0, 1000, 2000, 3000, 4000]);
  });
});

describe('AnalyticsBarChart y-axis', () => {
  it('labels a max of 2 as 0, 1, 2 — not 0, 1, 1, 2, 2', () => {
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<AnalyticsBarChart points={[{ label: 'a', value: 1 }, { label: 'b', value: 2 }]} />);
    });
    const axis = renderer.root
      .findAll((n) => (n.type as unknown) === 'SvgText' && n.props.textAnchor === 'end')
      .map((n) => String(n.props.children));
    expect(axis).toEqual(['0', '1', '2']);
    renderer.unmount();
  });
});
