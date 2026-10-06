import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('@/lib/devPreview', () => ({ isSellerDevPreview: () => true }));
vi.mock('@/lib/api', () => ({
  storeContextHeaders: () => ({}),
  versionApiPath: (path: string) => path,
}));
vi.mock('@/lib/guestApiPolicy', () => ({ isSignedInOnlyPath: () => true }));
vi.mock('@/lib/networkNotice', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, body: string) {
      super(body);
      this.status = status;
    }
  },
  dismissNetworkNotice: vi.fn(),
  reportNetworkError: vi.fn(),
}));
import { serviceRequest } from '../lib/serviceConfig';

describe('central seller-preview API rejection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('rejects direct paid/service requests before fetch', async () => {
    vi.stubGlobal('fetch', fetchMock);
    await expect(serviceRequest('/api/manufacturers/samples/preview/pay', { method: 'POST' }))
      .rejects.toThrow('dev_preview_offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});