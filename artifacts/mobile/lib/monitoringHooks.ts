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

export function reportServerError(status: number, method: string, path: string): void {
  try {
    reporter?.(status, method, path);
  } catch {
    // Never let reporting throw into request code.
  }
}
