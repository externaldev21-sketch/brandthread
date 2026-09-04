import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest } = vi.hoisted(() => ({ serviceRequest: vi.fn() }));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));

import { getSellerFollowState, setSellerFollowing } from './socialService';

describe('seller follow persistence', () => {
  beforeEach(() => serviceRequest.mockReset());

  it('loads canonical follow state and count from the social API', async () => {
    serviceRequest.mockResolvedValue({ isFollowing: true, followersCount: 12 });

    await expect(getSellerFollowState('seller/one')).resolves.toEqual({
      isFollowing: true,
      followersCount: 12,
    });
    expect(serviceRequest).toHaveBeenCalledWith('/api/social/status/seller%2Fone');
  });

  it('persists follow and unfollow mutations to the server', async () => {
    serviceRequest
      .mockResolvedValueOnce({ isFollowing: true, followersCount: 1 })
      .mockResolvedValueOnce({ isFollowing: false, followersCount: 0 });

    await setSellerFollowing('seller-1', true);
    await setSellerFollowing('seller-1', false);

    expect(serviceRequest).toHaveBeenNthCalledWith(1, '/api/social/follow', {
      method: 'POST',
      body: JSON.stringify({ userId: 'seller-1' }),
    });
    expect(serviceRequest).toHaveBeenNthCalledWith(2, '/api/social/follow/seller-1', {
      method: 'DELETE',
    });
  });
});