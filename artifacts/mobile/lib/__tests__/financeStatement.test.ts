import { describe, expect, it, vi } from 'vitest';
import {
  fetchStatementCsv,
  statementErrorLabel,
  statementFilename,
  StatementDownloadError,
} from '../financeStatement';

const okResponse = (body: string) => ({ ok: true, status: 200, text: async () => body }) as unknown as Response;

describe('fetchStatementCsv', () => {
  it('sends the Bearer token and store-context headers', async () => {
    const fetchImpl = vi.fn(async () => okResponse('date,amount\n'));
    const csv = await fetchStatementCsv({
      url: 'https://api.example/api/v1/finance/statement.csv',
      token: 'tok_123',
      headers: { 'X-Store-Context': 'joined' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(csv).toBe('date,amount\n');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/api/v1/finance/statement.csv');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_123');
    expect((init.headers as Record<string, string>)['X-Store-Context']).toBe('joined');
  });

  it('never fires an unauthenticated request', async () => {
    const fetchImpl = vi.fn();
    await expect(fetchStatementCsv({ url: 'x', token: null, fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws (instead of swallowing) on HTTP and network errors', async () => {
    const forbidden = vi.fn(async () => ({ ok: false, status: 403, text: async () => '' }) as unknown as Response);
    await expect(fetchStatementCsv({ url: 'x', token: 't', fetchImpl: forbidden as unknown as typeof fetch }))
      .rejects.toBeInstanceOf(StatementDownloadError);
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(fetchStatementCsv({ url: 'x', token: 't', fetchImpl: offline as unknown as typeof fetch }))
      .rejects.toMatchObject({ status: null });
  });
});

describe('statement helpers', () => {
  it('names the file by local date', () => {
    expect(statementFilename(new Date(2026, 9, 6, 23, 30))).toBe('brandthread-statement-2026-10-06.csv');
  });

  it('maps errors to short labels', () => {
    expect(statementErrorLabel(new StatementDownloadError(401, ''))).toMatch(/Sign in/);
    expect(statementErrorLabel(new StatementDownloadError(403, ''))).toMatch(/role/);
    expect(statementErrorLabel(new Error('boom'))).toBe("Couldn't download statement");
  });
});
