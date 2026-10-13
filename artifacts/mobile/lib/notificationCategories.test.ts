import { describe, expect, it, vi } from 'vitest';

const setNotificationCategoryAsync = vi.fn();
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-notifications', () => ({
  setNotificationCategoryAsync: (...args: unknown[]) => setNotificationCategoryAsync(...args),
}));

import { registerNotificationCategories } from './notificationCategories';

describe('registerNotificationCategories', () => {
  it('registers the new_order category with a foreground "Ship now" action', async () => {
    await registerNotificationCategories();
    expect(setNotificationCategoryAsync).toHaveBeenCalledWith('new_order', [
      { identifier: 'ship_now', buttonTitle: 'Ship now', options: { opensAppToForeground: true } },
    ]);
  });

  it('never throws when the native module is unavailable', async () => {
    setNotificationCategoryAsync.mockRejectedValueOnce(new Error('unavailable'));
    await expect(registerNotificationCategories()).resolves.toBeUndefined();
  });
});
