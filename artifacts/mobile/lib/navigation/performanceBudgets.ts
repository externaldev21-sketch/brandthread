/**
 * Release acceptance targets. Route/URL commits and JS rAF callbacks are NOT
 * layout, visible feedback or compositor evidence. Never turn them into passes.
 */
export const PERFORMANCE_TARGETS = Object.freeze({
  feedbackMs: 16,
  cachedLayoutMs: 100,
  freshLayoutMs: 300,
  navigationJsStallMs: 50,
  refreshRates: [60, 120] as const,
});

export type BudgetStatus = 'PASS' | 'FAIL' | 'UNVERIFIED';
export interface BudgetEvidence {
  production: boolean;
  platform: 'ios' | 'android' | 'web';
  engine: string;
  feedbackMs?: readonly number[];
  cachedLayoutMs?: readonly number[];
  freshLayoutMs?: readonly number[];
  navigationJsStallMs?: readonly number[];
  // Actual native compositor samples during gestures, not JS rAF/average FPS.
  nativeFrames?: { refreshRateHz: 60 | 120; presented: number; dropped: number };
}

function maximum(values: readonly number[] | undefined): number | null {
  if (!values?.length || values.some(v => !Number.isFinite(v) || v < 0)) return null;
  return Math.max(...values);
}

export function evaluatePerformanceBudgets(evidence: BudgetEvidence) {
  const nativeRelease = evidence.production === true
    && (evidence.platform === 'ios' || evidence.platform === 'android') && evidence.engine === 'Hermes';
  const latency = (samples: readonly number[] | undefined, threshold: number, inclusive: boolean): BudgetStatus => {
    const worst = maximum(samples);
    if (!nativeRelease || worst === null) return 'UNVERIFIED';
    return (inclusive ? worst <= threshold : worst < threshold) ? 'PASS' : 'FAIL';
  };
  const frames = evidence.nativeFrames;
  const validFrames = frames && (frames.refreshRateHz === 60 || frames.refreshRateHz === 120)
    && Number.isInteger(frames.presented) && frames.presented > 0
    && Number.isInteger(frames.dropped) && frames.dropped >= 0;
  const frameBudget = (rate: 60 | 120): BudgetStatus =>
    !nativeRelease || !validFrames || frames.refreshRateHz !== rate
      ? 'UNVERIFIED' : frames.dropped === 0 ? 'PASS' : 'FAIL';
  const targets = {
    feedback16ms: latency(evidence.feedbackMs, PERFORMANCE_TARGETS.feedbackMs, true),
    cachedUnder100ms: latency(evidence.cachedLayoutMs, PERFORMANCE_TARGETS.cachedLayoutMs, false),
    freshUnder300ms: latency(evidence.freshLayoutMs, PERFORMANCE_TARGETS.freshLayoutMs, false),
    noJsStallOver50ms: latency(evidence.navigationJsStallMs, PERFORMANCE_TARGETS.navigationJsStallMs, true),
    steady60fps: frameBudget(60),
    steady120fps: frameBudget(120),
  };
  const requiredRate = frames?.refreshRateHz === 120 ? targets.steady120fps : targets.steady60fps;
  // Unknown evidence fails the release gate, never silently passes.
  return { targets, releaseGate: [
    targets.feedback16ms, targets.cachedUnder100ms, targets.freshUnder300ms,
    targets.noJsStallOver50ms, requiredRate,
  ].every(s => s === 'PASS') ? 'PASS' as const : 'FAIL' as const };
}
