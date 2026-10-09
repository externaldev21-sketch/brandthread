import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  InteractionManager: { runAfterInteractions: (fn: () => void) => { fn(); return { cancel: () => {} }; } },
}));

import { registerPerformanceReporter } from '../lib/monitoringHooks';
import { FEED_FRAME_SAMPLER_PROPS, getPerfRecord, markAppJsStart, recordShellInteractive } from '../lib/perf';

describe('cold start marker', () => {
  it('records the shell reading once and reports only numbers and a label', () => {
    const reports: Array<{ name: string; timings: Record<string, unknown>; keep: boolean }> = [];
    registerPerformanceReporter((name, timings, keep) => reports.push({ name, timings, keep }));
    try {
      markAppJsStart();
      recordShellInteractive();
      recordShellInteractive();
      const record = getPerfRecord();
      expect(record.coldStart?.screen).toBe('shell');
      expect(record.coldStart?.jsToInteractiveMs).toBeGreaterThanOrEqual(0);
      expect(reports).toHaveLength(1);
      expect(reports[0].name).toBe('cold_start');
      expect(reports[0].keep).toBe(true);
      expect(Object.keys(reports[0].timings).sort()).toEqual(['js_to_interactive_ms', 'process_to_interactive_ms', 'screen']);
      for (const [key, value] of Object.entries(reports[0].timings)) {
        if (key === 'screen') expect(value).toBe('shell');
        else expect(value === null || typeof value === 'number').toBe(true);
      }
    } finally {
      registerPerformanceReporter(null);
    }
  });

  it('adds no scroll props to the feed outside perf builds', () => {
    // vitest defines __DEV__ false and EXPO_PUBLIC_PERF_MARKS is unset: a store build.
    expect(Object.keys(FEED_FRAME_SAMPLER_PROPS)).toEqual([]);
  });
});
