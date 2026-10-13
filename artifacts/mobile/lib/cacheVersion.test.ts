import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '2.3.0' } } }));

import { CACHE_SCHEMA_VERSION, cacheStamp, staleCacheKeys } from './cacheVersion';

describe('cache version stamp', () => {
  it('combines the schema version with the native app version', () => {
    expect(cacheStamp()).toBe(`${CACHE_SCHEMA_VERSION}@2.3.0`);
  });

  it('flags only keys from a known cache written under a different stamp', () => {
    const stamp = cacheStamp();
    const keys = [
      `bt_feed_posts_cache_v1_${stamp}:u1:for-you`,
      'bt_feed_posts_cache_v1_u1:for-you', // pre-versioning layout
      `bt_feed_posts_cache_v1_0@1.0.0:u1:following`,
      `bt_tab_data_cache_v1_${stamp}:u1:inbox`,
      'bt_tab_data_cache_v1_u1:inbox',
      'bt:query-cache:v1',
      'unrelated',
    ];
    expect(staleCacheKeys(keys, ['bt_feed_posts_cache_v1_', 'bt_tab_data_cache_v1_'], stamp)).toEqual([
      'bt_feed_posts_cache_v1_u1:for-you',
      'bt_feed_posts_cache_v1_0@1.0.0:u1:following',
      'bt_tab_data_cache_v1_u1:inbox',
    ]);
  });
});
