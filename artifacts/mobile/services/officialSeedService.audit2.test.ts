import { beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest, hasServiceToken } = vi.hoisted(() => ({
  serviceRequest: vi.fn(),
  hasServiceToken: vi.fn(async () => true),
}));

vi.mock('@/lib/serviceConfig', () => ({ serviceRequest, hasServiceToken }));

import { createOfficialSeedCursor, fetchOfficialSeedPage } from './officialSeedService';

const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];

describe('fetchOfficialSeedPage: server transient error', () => {
  beforeEach(() => {
    serviceRequest.mockReset();
    hasServiceToken.mockResolvedValue(true);
  });

  it("treats { seeding:false, reason:'error' } as retryable (cursor not marked done)", async () => {
    serviceRequest.mockResolvedValueOnce({ seeding: false, reason: 'error' });
    const page = await fetchOfficialSeedPage(ids, createOfficialSeedCursor(), false);
    expect(page.seeding).toBe(false);
    expect(page.items.map((i) => (i.type === 'organic' ? i.id : null))).toEqual(ids);
    expect(page.cursor.done).toBeFalsy();

    serviceRequest.mockResolvedValueOnce({ seeding: false, reason: 'error' });
    await fetchOfficialSeedPage(ids, page.cursor, false);
    expect(serviceRequest).toHaveBeenCalledTimes(2);
  });

  it('still stops asking when the server says the viewer is not seeded', async () => {
    serviceRequest.mockResolvedValueOnce({ seeding: false, reason: 'not_new_user' });
    const page = await fetchOfficialSeedPage(ids, createOfficialSeedCursor(), false);
    expect(page.cursor.done).toBe(true);
    await fetchOfficialSeedPage(ids, page.cursor, false);
    expect(serviceRequest).toHaveBeenCalledTimes(1);
  });
});
