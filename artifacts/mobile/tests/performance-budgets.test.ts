import { describe, expect, it } from 'vitest';
import { evaluatePerformanceBudgets, type BudgetEvidence } from '../lib/navigation/performanceBudgets';

const passing: BudgetEvidence = {
  production: true, platform: 'ios', engine: 'Hermes',
  feedbackMs: [12, 16], cachedLayoutMs: [40, 99],
  freshLayoutMs: [180, 299], navigationJsStallMs: [20, 50],
  nativeFrames: { refreshRateHz: 60, presented: 600, dropped: 0 },
};
describe('hard native performance release targets', () => {
  it('passes exact inclusive limits and strictly under layout limits', () => {
    expect(evaluatePerformanceBudgets(passing).releaseGate).toBe('PASS');
  });
  it('fails on the worst sample, not an average that hides a stall', () => {
    const result = evaluatePerformanceBudgets({ ...passing, cachedLayoutMs: [10, 10, 100] });
    expect(result.targets.cachedUnder100ms).toBe('FAIL');
    expect(result.releaseGate).toBe('FAIL');
    expect(evaluatePerformanceBudgets({ ...passing, freshLayoutMs: [300] }).targets.freshUnder300ms).toBe('FAIL');
    expect(evaluatePerformanceBudgets({ ...passing, feedbackMs: [16.1] }).targets.feedback16ms).toBe('FAIL');
    expect(evaluatePerformanceBudgets({ ...passing, navigationJsStallMs: [50.1] }).targets.noJsStallOver50ms).toBe('FAIL');
  });
  it.each([
    { production: false }, { platform: 'web' as const }, { engine: 'V8' },
  ])('never treats dev or browser observations as native passes: %j', override => {
    expect(Object.values(evaluatePerformanceBudgets({ ...passing, ...override }).targets)).toEqual(
      Array(6).fill('UNVERIFIED'));
  });
  it.each([undefined, [], [NaN], [Infinity], [-1]])('rejects missing or invalid evidence: %j', samples => {
    expect(evaluatePerformanceBudgets({ ...passing, feedbackMs: samples }).releaseGate).toBe('FAIL');
  });
  it('requires compositor frames at the tested refresh rate', () => {
    expect(evaluatePerformanceBudgets(passing).targets.steady120fps).toBe('UNVERIFIED');
    expect(evaluatePerformanceBudgets({
      ...passing, nativeFrames: { refreshRateHz: 120, presented: 1200, dropped: 0 },
    })).toMatchObject({ releaseGate: 'PASS', targets: { steady120fps: 'PASS', steady60fps: 'UNVERIFIED' } });
    expect(evaluatePerformanceBudgets({
      ...passing, nativeFrames: { refreshRateHz: 60, presented: 599, dropped: 1 },
    }).releaseGate).toBe('FAIL');
  });
  it('fails closed for malformed runtime platform or production metadata', () => {
    expect(evaluatePerformanceBudgets({ ...passing, platform: undefined } as unknown as BudgetEvidence).releaseGate).toBe('FAIL');
    expect(evaluatePerformanceBudgets({ ...passing, production: 'false' } as unknown as BudgetEvidence).releaseGate).toBe('FAIL');
  });
});
