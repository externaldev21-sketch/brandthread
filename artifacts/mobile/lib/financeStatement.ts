/**
 * Authenticated download of the seller's finance statement CSV (QA-0090).
 *
 * GET /api/finance/statement.csv sits behind requireAuth + payouts:read, so
 * it can't be opened as a bare URL (Linking.openURL sends no Bearer token and
 * the browser just gets a 401). This fetches it with the same Authorization
 * + store-context headers the API client sends, and throws on failure so the
 * screen can tell the seller.
 */

export const STATEMENT_CSV_PATH = '/api/finance/statement.csv';

export class StatementDownloadError extends Error {
  constructor(public readonly status: number | null, message: string) {
    super(message);
    this.name = 'StatementDownloadError';
  }
}

/** 'brandthread-statement-YYYY-MM-DD.csv' using the LOCAL date. */
export function statementFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `brandthread-statement-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}

/** Short user-facing label for a failed download. */
export function statementErrorLabel(err: unknown): string {
  const status = err instanceof StatementDownloadError ? err.status : null;
  if (status === 401) return 'Sign in again to download your statement';
  if (status === 403) return "Your role can't download statements";
  return "Couldn't download statement";
}

export async function fetchStatementCsv(opts: {
  url: string;
  token: string | null;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  if (!opts.token) throw new StatementDownloadError(401, 'Not signed in');
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.url, {
      method: 'GET',
      headers: { Accept: 'text/csv', Authorization: `Bearer ${opts.token}`, ...(opts.headers ?? {}) },
    });
  } catch (e) {
    throw new StatementDownloadError(null, e instanceof Error ? e.message : 'Network error');
  }
  if (!res.ok) throw new StatementDownloadError(res.status, `Statement download failed (${res.status})`);
  return res.text();
}
