/**
 * A dependency-free seam between the API client and crash reporting, so
 * `lib/api.ts` (and every test that imports it) does not load the Sentry SDK.
 * `lib/monitoring.ts` registers the real reporter when Sentry starts; until
 * then, and whenever Sentry is off, reporting does nothing.
 */
type ServerErrorReporter = (status: number, method: string, path: string) => void;

let reporter: ServerErrorReporter | null = null;

export function registerServerErrorReporter(next: ServerErrorReporter | null): void {
  reporter = next;
}

/**
 * Performance timings from lib/perf.ts: milliseconds and fixed labels only.
 * `keepAsContext` also attaches the latest values to later reports.
 */
export type PerformanceTimings = Record<string, number | string | boolean | null>;
type PerformanceReporter = (name: string, timings: PerformanceTimings, keepAsContext: boolean) => void;

let performanceReporter: PerformanceReporter | null = null;

export function registerPerformanceReporter(next: PerformanceReporter | null): void {
  performanceReporter = next;
}

export function reportPerformance(name: string, timings: PerformanceTimings, keepAsContext = false): void {
  try {
    performanceReporter?.(name, timings, keepAsContext);
  } catch {
    // Never let reporting throw into the code being measured.
  }
}

export function reportServerError(status: number, method: string, path: string): void {
  try {
    reporter?.(status, method, path);
  } catch {
    // Never let reporting throw into request code.
  }
}
