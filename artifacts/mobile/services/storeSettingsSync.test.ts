import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, saveMock, setSlugMock, setPasswordMock, cacheMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  saveMock: vi.fn(),
  setSlugMock: vi.fn(),
  setPasswordMock: vi.fn(),
  cacheMock: vi.fn(async () => ({})),
}));

vi.mock('@/lib/api', () => ({
  api: { store: { get: getMock, save: saveMock, setSlug: setSlugMock, setPassword: setPasswordMock } },
}));
vi.mock('./storeService', () => ({ cacheStorefrontLocally: cacheMock }));

import {
  saveStoreSettings, settingsFromServer, settingsToServer, slugFromStoreUrl, validateSlugInput,
} from './storeSettingsSync';
import { mapApiCustomDomain, verifiedDomainMessage } from './storeDomainStatus';
import type { StoreSettings } from './storeTypes';

const base: StoreSettings = {
  storeName: 'Local', storeUrl: 'local', contactEmail: '', supportEmail: '',
  currency: 'USD', language: 'en', timezone: 'America/New_York', measurementUnit: 'imperial',
  storeStatus: 'draft', passwordProtected: false, storePassword: '',
  checkoutRequireAccount: false, checkoutGuestAllowed: true, orderNotifications: true, analyticsEnabled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockResolvedValue({ slug: 'brand', title: 'Brand', storeSettings: { other: 1 }, hasStorePassword: false });
  saveMock.mockResolvedValue({});
});

describe('store settings mapping', () => {
  it('server values win and the password is never loaded', () => {
    const out = settingsFromServer(
      { title: 'Brand', slug: 'brand', hasStorePassword: true,
        storeSettings: { currency: 'EUR', contactEmail: 'me@b.com', checkoutGuestAllowed: false, storePassword: 'x' } },
      { ...base, storePassword: 'typed' },
    );
    expect(out).toMatchObject({ storeName: 'Brand', storeUrl: 'brand', currency: 'EUR', contactEmail: 'me@b.com',
      checkoutGuestAllowed: false, storePassword: '', hasStorePassword: true });
  });

  it('payload keeps unrelated server keys and never includes a password', () => {
    const out = settingsToServer({ ...base, currency: 'GBP', storePassword: 'secret' }, { other: 1, storePassword: 'old' });
    expect(out.other).toBe(1);
    expect(out.currency).toBe('GBP');
    expect(out).not.toHaveProperty('storePassword');
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('slug helpers', () => {
    expect(slugFromStoreUrl('https://Brand.brandthread.app/')).toBe('brand');
    expect(slugFromStoreUrl('brand.brandthread.app')).toBe('brand');
    expect(validateSlugInput('ok-slug')).toBeNull();
    expect(validateSlugInput('no')).toMatch(/3-40/);
    expect(validateSlugInput('bad_slug')).toMatch(/lowercase/);
  });
});

describe('saveStoreSettings', () => {
  it('persists settings to the server and sends the password separately', async () => {
    setPasswordMock.mockResolvedValue({ ok: true, hasStorePassword: true });
    const res = await saveStoreSettings(
      { ...base, storeUrl: 'brand', currency: 'EUR', passwordProtected: true, storePassword: 'pw1234' },
      { currentSlug: 'brand', hasStorePassword: false },
    );
    expect(setSlugMock).not.toHaveBeenCalled();
    const body = saveMock.mock.calls[0][0];
    expect(body.title).toBe('Local');
    expect(body.storeSettings).toMatchObject({ currency: 'EUR', other: 1, passwordProtected: true });
    expect(JSON.stringify(body)).not.toContain('pw1234');
    expect(setPasswordMock).toHaveBeenCalledWith('pw1234');
    expect(res).toEqual({ slug: 'brand', hasStorePassword: true });
  });

  it('changes the slug through the slug endpoint', async () => {
    setSlugMock.mockResolvedValue({ slug: 'newname' });
    const res = await saveStoreSettings({ ...base, storeUrl: 'NewName' }, { currentSlug: 'brand', hasStorePassword: false });
    expect(setSlugMock).toHaveBeenCalledWith('newname');
    expect(res.slug).toBe('newname');
  });

  it('clears the password when protection is turned off', async () => {
    setPasswordMock.mockResolvedValue({ ok: true, hasStorePassword: false });
    await saveStoreSettings({ ...base, storeUrl: 'brand' }, { currentSlug: 'brand', hasStorePassword: true });
    expect(setPasswordMock).toHaveBeenCalledWith(null);
  });

  it('throws (no fake success) when the server rejects the save', async () => {
    saveMock.mockRejectedValue(new Error('API 500: boom'));
    await expect(saveStoreSettings({ ...base, storeUrl: 'brand' }, { currentSlug: 'brand', hasStorePassword: false }))
      .rejects.toThrow();
    expect(cacheMock).not.toHaveBeenCalled();
  });

  it('requires a password before enabling protection, without writing anything', async () => {
    await expect(saveStoreSettings({ ...base, storeUrl: 'brand', passwordProtected: true },
      { currentSlug: 'brand', hasStorePassword: false })).rejects.toThrow(/password/);
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe('custom domain status', () => {
  it('never claims SSL/routing unless routing is enabled', () => {
    const d = { id: 'd1', domain: 'brand.com', verified: true, verifyToken: 't' };
    expect(mapApiCustomDomain(d, false)).toMatchObject({ verificationStatus: 'verified', sslStatus: 'not_issued' });
    expect(mapApiCustomDomain(d, true).sslStatus).toBe('active');
    expect(verifiedDomainMessage(false).body).toMatch(/isn't available yet/);
    expect(verifiedDomainMessage(false).body).not.toMatch(/SSL/);
  });
});
