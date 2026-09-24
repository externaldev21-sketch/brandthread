/**
 * Real period-over-period change for a seller metric card. Pure and
 * dependency-free so it can be unit tested directly.
 */
export type MetricChange = {
  direction: 'up' | 'down' | 'flat';
  /** Percent change vs. the previous period, rounded to 1 decimal. Absent when it can't be expressed as a percentage (previous period was 0 but current isn't — that's a "New" case, not a fabricated percentage). */
  percent: number | null;
};

export function computeMetricChange(current: number, previous: number): MetricChange {
  if (current === previous) return { direction: 'flat', percent: 0 };
  if (previous === 0) return { direction: 'up', percent: null };
  const percent = ((current - previous) / previous) * 100;
  return {
    direction: percent > 0 ? 'up' : 'down',
    percent: Math.round(percent * 10) / 10,
  };
}
