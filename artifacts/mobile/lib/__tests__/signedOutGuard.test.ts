import { beforeEach, describe, expect, it, vi } from 'vitest';

const preview = vi.hoisted(() => ({ role: null as 'seller' | 'buyer' | null, demo: false }));

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ getToken: async () => null, userId: null }) }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    getAllKeys: vi.fn(async () => [] as string[]),
    multiRemove: vi.fn(async () => undefined),
  },
}));
vi.mock('@/lib/networkNotice', () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, public body: string) { super(body); }
  },
  dismissNetworkNotice: vi.fn(),
  reportNetworkError: vi.fn(),
}));
vi.mock('@/lib/devPreview', () => ({
  isSellerDevPreview: () => preview.role === 'seller',
  isBuyerDevPreview: () => preview.role === 'buyer',
  isPreviewDemoMode: () => preview.role !== null && preview.demo,
}));
// Demo orders come from the existing preview fixtures; stub them so this test
// only checks the wiring (lib/previewOrders.ts has its own gating).
vi.mock('@/lib/previewOrders', () => ({
  getPreviewSellerOrders: () => (preview.demo ? [{ id: 'preview-order-1', totalCents: 4200 }] : []),
}));
vi.mock('../previewOrders', () => ({
  getPreviewSellerOrders: () => (preview.demo ? [{ id: 'preview-order-1', totalCents: 4200 }] : []),
}));
vi.mock('../devPreview', () => ({
  isSellerDevPreview: () => preview.role === 'seller',
  isBuyerDevPreview: () => preview.role === 'buyer',
  isPreviewDemoMode: () => preview.role !== null && preview.demo,
}));

import { createApi } from '../api';
import { reportNetworkError } from '@/lib/networkNotice';

const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  if (url.startsWith('file://')) {
    return { ok: true, blob: async () => new Blob(['x'], { type: 'image/jpeg' }) } as Response;
  }
  return { ok: true, json: async () => ({ fromNetwork: true }), text: async () => '' } as unknown as Response;
});

function networkCalls(): string[] {
  return fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => !u.startsWith('file://'));
}

describe('signed-out API guard (lib/api.ts)', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    vi.mocked(reportNetworkError).mockClear();
    vi.stubGlobal('fetch', fetchMock);
    // The preview is a browser-only mode; give the guard a DOM to detect.
    vi.stubGlobal('document', {});
    preview.role = null;
    preview.demo = false;
  });

  it('never sends a protected request without a session, and fails like the server would', async () => {
    const api = createApi(async () => null);
    await expect(api.seller.getProfile()).rejects.toMatchObject({ status: 401 });
    await expect(api.discountCodes.list()).rejects.toMatchObject({ status: 401 });
    expect(networkCalls()).toEqual([]);
    expect(reportNetworkError).not.toHaveBeenCalled();
  });

  it('blocks paid AI and upload paths when signed out (QA-0102, QA-0127)', async () => {
    const api = createApi(async () => null);
    await expect(api.products.uploadImage({ uri: 'file:///a.jpg', mimeType: 'image/jpeg' })).rejects.toMatchObject({ status: 401 });
    expect(networkCalls()).toEqual([]);
  });

  it('still lets public browse endpoints through when signed out', async () => {
    const api = createApi(async () => null);
    await api.config.featureFlags();
    expect(networkCalls()).toHaveLength(1);
    expect(networkCalls()[0]).toContain('/api/v1/config/features');
  });

  it('sends protected requests normally once there is a session', async () => {
    const api = createApi(async () => 'token');
    await expect(api.seller.getProfile()).resolves.toEqual({ fromNetwork: true });
    expect(networkCalls()[0]).toContain('/api/v1/seller/profile');
  });

  it('a signed-in user on the dev web host is never mistaken for the preview', async () => {
    preview.role = 'seller';
    const api = createApi(async () => 'token');
    await expect(api.orders.list()).resolves.toEqual({ fromNetwork: true });
  });

  it('answers protected GETs in the fresh seller preview with a new account\'s empty state', async () => {
    preview.role = 'seller';
    const api = createApi(async () => null);
    await expect(api.discountCodes.list()).resolves.toEqual([]);
    await expect(api.orders.list()).resolves.toEqual([]);
    await expect(api.team.members()).resolves.toMatchObject([{ role: 'owner', isOwner: true }]);
    await expect(api.auth.deletionCheck()).resolves.toMatchObject({ canDelete: true, accountType: 'seller', blockers: [] });
    const profile = await api.seller.getProfile();
    expect(profile).toMatchObject({ displayName: 'Atelier Noire', bio: null, website: null, location: null, contactEmail: null });
    expect(networkCalls()).toEqual([]);
  });

  it('serves the seeded demo orders only with demo=1', async () => {
    preview.role = 'seller';
    preview.demo = true;
    const api = createApi(async () => null);
    await expect(api.orders.list()).resolves.toEqual([{ id: 'preview-order-1', totalCents: 4200 }]);
    expect(networkCalls()).toEqual([]);
  });

  it('native / non-browser sign-out never loads the preview layer', async () => {
    vi.stubGlobal('document', undefined);
    preview.role = 'seller';
    const api = createApi(async () => null);
    await expect(api.orders.list()).rejects.toMatchObject({ status: 401 });
    expect(networkCalls()).toEqual([]);
  });

  it('rejects preview mutations locally instead of sending them', async () => {
    preview.role = 'buyer';
    const api = createApi(async () => null);
    await expect(api.safety.muteWord('spoiler')).rejects.toMatchObject({ status: 401 });
    expect(networkCalls()).toEqual([]);
  });
});
