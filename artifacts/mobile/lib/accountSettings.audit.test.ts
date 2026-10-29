import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: request }));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isSellerDevPreview: () => false }));

import { __resetAccountStorageForTests, setAccountStorageScope } from '@/lib/accountStorage';
import { __resetAccountSettingsForTests, fetchAccountSettings, patchAccountSettings } from '@/lib/accountSettings';

describe('account settings memo vs a PATCH that lands during a GET', () => {
  beforeEach(() => {
    request.mockReset();
    __resetAccountStorageForTests();
    __resetAccountSettingsForTests();
    setAccountStorageScope('user_a');
  });

  it('does not let a GET that started before the PATCH overwrite the patched memo', async () => {
    let resolveGet!: (v: unknown) => void;
    request.mockImplementationOnce(() => new Promise((r) => { resolveGet = r; }));
    const staleRead = fetchAccountSettings();

    request.mockResolvedValueOnce({ settings: { privateAccount: true }, updatedAt: '2026-10-02T00:00:00Z' });
    await patchAccountSettings({ privateAccount: true });

    resolveGet({ settings: { privateAccount: false }, updatedAt: '2026-10-01T00:00:00Z' });
    await staleRead;

    // The next read within the freshness window must show the saved value.
    const next = await fetchAccountSettings();
    expect(next.settings.privateAccount).toBe(true);
  });

  it('does not hand a later caller the in-flight pre-PATCH GET', async () => {
    let resolveGet!: (v: unknown) => void;
    request.mockImplementationOnce(() => new Promise((r) => { resolveGet = r; }));
    const staleRead = fetchAccountSettings();

    request.mockResolvedValueOnce({ settings: { privateAccount: true }, updatedAt: '2026-10-02T00:00:00Z' });
    await patchAccountSettings({ privateAccount: true });

    const afterPatch = fetchAccountSettings();
    resolveGet({ settings: { privateAccount: false }, updatedAt: '2026-10-01T00:00:00Z' });
    await staleRead;
    expect((await afterPatch).settings.privateAccount).toBe(true);
  });
});
