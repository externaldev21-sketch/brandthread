/**
 * QA-0163: saveStorefront's server sync used to send the store name as both
 * `description` and `branding.tagline` (overwriting the real ones) and
 * swallowed sync failures. It must send only fields the local model owns
 * and surface a failed sync to the seller.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storage, saveMock, alertMock, previewState } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  saveMock: vi.fn(),
  alertMock: vi.fn(),
  previewState: { seller: false },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
  },
}));

vi.mock('react-native', () => ({
  Alert: { alert: alertMock },
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
}));

vi.mock('@/lib/api', () => ({
  api: {
    store: {
      get: vi.fn(async () => ({})),
      save: saveMock,
    },
    shopifyImports: {},
  },
}));

vi.mock('@/lib/devPreview', () => ({
  isSellerDevPreview: () => previewState.seller,
}));

import {
  buildStorefrontSyncPayload,
  getStoreSyncStatus,
  getStorefront,
  updateSettings,
  updateSEO,
} from '@/services/storeService';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  storage.clear();
  saveMock.mockReset();
  alertMock.mockReset();
  previewState.seller = false;
});

describe('buildStorefrontSyncPayload', () => {
  it('maps title/theme/logo/sections/seo and never sends description, tagline or keywords', async () => {
    const store = await getStorefront();
    store.settings.storeName = 'Atelier Noire';
    store.branding.logoUri = 'https://cdn.example/logo.png';
    store.seo.homepageTitle = 'Atelier Noire — knitwear';
    store.seo.homepageDescription = 'Hand-dyed knitwear.';

    const payload = buildStorefrontSyncPayload(store);

    expect(payload.title).toBe('Atelier Noire');
    expect(payload).not.toHaveProperty('description');
    expect(payload.branding).toEqual({ logoUrl: 'https://cdn.example/logo.png' });
    expect(payload.seo).toEqual({ metaTitle: 'Atelier Noire — knitwear', metaDescription: 'Hand-dyed knitwear.' });
    expect(payload.theme).toMatchObject({
      primaryColor: store.branding.colors.primary,
      fontFamily: store.branding.typography.headingFont,
    });
    expect(payload.sections).toEqual(store.sections.map(s => ({
      type: s.type, title: s.label, enabled: s.enabled, settings: s.settings,
    })));
  });
});

describe('saveStorefront server sync', () => {
  it('PUTs the mapped payload and returns the saved store without waiting on it', async () => {
    saveMock.mockResolvedValue({});
    const store = await updateSettings({ storeName: 'Noire' });
    expect(store.settings.storeName).toBe('Noire');
    await flush();
    expect(saveMock).toHaveBeenCalledTimes(1);
    const body = saveMock.mock.calls[0][0];
    expect(body.title).toBe('Noire');
    expect(body).not.toHaveProperty('description');
    expect(body.branding).not.toHaveProperty('tagline');
    expect(getStoreSyncStatus().state).toBe('synced');
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('surfaces a failed sync once per failure streak and keeps the local save', async () => {
    saveMock.mockRejectedValue(new Error('API 500: boom'));
    const store = await updateSettings({ storeName: 'Offline' });
    await flush();
    expect(store.settings.storeName).toBe('Offline');
    expect(JSON.parse(storage.get('bt:store:v1')!).settings.storeName).toBe('Offline');
    expect(getStoreSyncStatus()).toEqual({ state: 'failed', error: 'API 500: boom' });
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0][0]).toBe("Store changes didn't sync");

    // Still failing (e.g. autosave): no alert spam.
    await updateSEO({ homepageTitle: 'x' });
    await flush();
    expect(alertMock).toHaveBeenCalledTimes(1);

    // Recovers, then fails again: tell the seller again.
    saveMock.mockResolvedValueOnce({});
    await updateSEO({ homepageTitle: 'y' });
    await flush();
    expect(getStoreSyncStatus().state).toBe('synced');
    await updateSEO({ homepageTitle: 'z' });
    await flush();
    expect(alertMock).toHaveBeenCalledTimes(2);
  });

  it('does not call the protected API in the signed-out dev preview', async () => {
    previewState.seller = true;
    await updateSettings({ storeName: 'Preview' });
    await flush();
    expect(saveMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });
});
