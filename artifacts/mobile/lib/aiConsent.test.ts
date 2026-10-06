import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiConsentRequiredError, isAiConsentRequired, requestAiConsent, setAiConsentPrompter, withAiConsent,
} from './aiConsent';

const refusal = () => Object.assign(new Error('{"code":"ai_consent_required"}'), {
  status: 403, body: JSON.stringify({ error: 'Allow AI data sharing', code: 'ai_consent_required' }),
});

let unregister: (() => void) | null = null;
afterEach(() => { unregister?.(); unregister = null; });

describe('AI consent on the client (QA-0043)', () => {
  it('recognises only the consent refusal', () => {
    expect(isAiConsentRequired(refusal())).toBe(true);
    expect(isAiConsentRequired(new AiConsentRequiredError())).toBe(true);
    expect(isAiConsentRequired(Object.assign(new Error('x'), { status: 403, body: '{"code":"forbidden"}' }))).toBe(false);
    expect(isAiConsentRequired(Object.assign(new Error('x'), { status: 401, body: '{"code":"ai_consent_required"}' }))).toBe(false);
  });

  it('asks, then retries the AI call once when the person allows', async () => {
    const ask = vi.fn(async () => true);
    unregister = setAiConsentPrompter(ask);
    const run = vi.fn().mockRejectedValueOnce(refusal()).mockResolvedValue('result');
    await expect(withAiConsent(run)).resolves.toBe('result');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('sends nothing more when the person says not now', async () => {
    unregister = setAiConsentPrompter(async () => false);
    const run = vi.fn().mockRejectedValue(refusal());
    await expect(withAiConsent(run)).rejects.toMatchObject({ status: 403 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('shows one sheet for simultaneous refusals', async () => {
    let resolve!: (v: boolean) => void;
    const ask = vi.fn(() => new Promise<boolean>((r) => { resolve = r; }));
    unregister = setAiConsentPrompter(ask);
    const a = requestAiConsent();
    const b = requestAiConsent();
    resolve(true);
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('declines when no sheet is mounted (never sends without a yes)', async () => {
    expect(await requestAiConsent()).toBe(false);
  });

  it('passes other errors straight through', async () => {
    const run = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(withAiConsent(run)).rejects.toThrow('offline');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
