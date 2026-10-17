import type { AnalyticsMetric } from '@/services/analyticsTypes';

export interface MetricTile {
  key: string;
  label: string;
  value: string;
  changePct?: number;
}

/**
 * StatTileRow items for the metrics the server actually reported. A metric
 * the platform doesn't record arrives as undefined and is dropped here, so
 * report screens never render a placeholder or invented tile.
 */
export function metricTiles(entries: Array<[key: string, metric: AnalyticsMetric | undefined]>): MetricTile[] {
  return entries
    .filter((entry): entry is [string, AnalyticsMetric] => !!entry[1])
    .map(([key, m]) => ({ key, label: m.label, value: m.formatted, changePct: m.changePct }));
}
