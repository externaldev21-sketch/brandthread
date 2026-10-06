import { afterEach, describe, expect, it, vi } from 'vitest';
import { customFetch, setRequestGuard } from '../../../lib/api-client-react/src/custom-fetch';

describe('generated API client seller-preview guard', () => {
  afterEach(() => {
    setRequestGuard(null);
    vi.unstubAllGlobals();
  });

  it('rejects before reaching fetch when the preview guard is active', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    setRequestGuard(() => true);

    const previewRoutes = [
      '/api/seller/dashboard',
      '/api/seller/products',
      '/api/seller/orders',
      '/api/seller/settings',
      '/api/manufacturers/public',
    ];
    for (const route of previewRoutes) {
      await expect(customFetch(route)).rejects.toThrow(
        'This action is unavailable in the signed-out seller preview.',
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});