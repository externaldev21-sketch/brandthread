import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  },
}));

import { DEFAULT_BUYER_SETTINGS, getBuyerSettingsSnapshot, loadBuyerSettings, subscribeBuyerSettings, uploadQuality } from './buyerSettings';
import { fromServer, hydrateBuyerSettings, toServerPatch, updateBuyerSettings } from './buyerSettingsSync';

function fakeApi(overrides: Partial<{ fail: boolean; dmPrivacy: 'requests' | 'followers_only' }> = {}) {
  const server: Record<string, unknown> = { readReceipts: true, personalizedRecommendations: true, loginAlerts: true };
  let dmPrivacy = overrides.dmPrivacy ?? 'requests';
  const api = {
    meSettings: {
      get: vi.fn(async () => ({ settings: { ...server }, updatedAt: null })),
      update: vi.fn(async (patch: Record<string, unknown>) => {
        if (overrides.fail) throw new Error('offline');
        Object.assign(server, patch);
        return { settings: { ...server }, updatedAt: 'now' };
      }),
      resetRecommendations: vi.fn(async () => ({ ok: true })),
    },
    privacy: {
      get: vi.fn(async () => ({ dmPrivacy })),
      update: vi.fn(async (b: { dmPrivacy?: 'requests' | 'followers_only' }) => {
        if (overrides.fail) throw new Error('offline');
        dmPrivacy = b.dmPrivacy ?? dmPrivacy;
        return { dmPrivacy };
      }),
    },
  };
  return { api: api as any, server };
}

beforeEach(() => { store.clear(); });

describe('buyer settings server sync', () => {
  it('sends only server-owned keys', () => {
    expect(toServerPatch({ readReceipts: false, sizeTops: 'L', saveLoginInfo: false })).toEqual({ readReceipts: false });
  });

  it('maps DM privacy to the Message requests toggle', () => {
    expect(fromServer(null, 'followers_only')).toEqual({ messageRequests: false });
    expect(fromServer(null, 'requests')).toEqual({ messageRequests: true });
  });

  it('saves to the server before the local copy', async () => {
    const { api, server } = fakeApi();
    const next = await updateBuyerSettings(api, { readReceipts: false, messageRequests: false });
    expect(server.readReceipts).toBe(false);
    expect(api.privacy.update).toHaveBeenCalledWith({ dmPrivacy: 'followers_only' });
    expect(next.readReceipts).toBe(false);
    expect(next.messageRequests).toBe(false);
    expect((await loadBuyerSettings()).readReceipts).toBe(false);
  });

  it('throws and leaves local settings untouched when the server refuses', async () => {
    const { api } = fakeApi({ fail: true });
    await expect(updateBuyerSettings(api, { personalizedRecommendations: false })).rejects.toThrow('offline');
    expect((await loadBuyerSettings()).personalizedRecommendations).toBe(true);
  });

  it('hydrates server values over the local copy', async () => {
    const { api, server } = fakeApi({ dmPrivacy: 'followers_only' });
    server.loginAlerts = false;
    const next = await hydrateBuyerSettings(api);
    expect(next.loginAlerts).toBe(false);
    expect(next.messageRequests).toBe(false);
  });

  it('publishes changes to subscribers', async () => {
    const { api } = fakeApi();
    const seen: boolean[] = [];
    const off = subscribeBuyerSettings((s) => seen.push(s.highContrast));
    await updateBuyerSettings(api, { highContrast: true });
    off();
    expect(seen.at(-1)).toBe(true);
    expect(getBuyerSettingsSnapshot().highContrast).toBe(true);
  });
});

describe('upload quality', () => {
  it('keeps the caller quality at highest quality and caps it otherwise', () => {
    expect(uploadQuality(0.9, { highQualityUploads: true })).toBe(0.9);
    expect(uploadQuality(0.9, { highQualityUploads: false })).toBe(0.6);
    expect(uploadQuality(0.5, { highQualityUploads: false })).toBe(0.5);
  });

  it('defaults group adds to the server default', () => {
    expect(DEFAULT_BUYER_SETTINGS.groupAdds).toBe('friends');
  });
});
