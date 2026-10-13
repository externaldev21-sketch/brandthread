/**
 * Seller: a new order arriving in the foreground plays the success haptic
 * (once); every other in-app banner arrives without a haptic.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-haptics', () => ({}));
import { isNewOrderNotification, NEW_ORDER_SOUND_PREF } from '@/lib/newOrderAlert';
import { HAPTIC_MAP } from '@/lib/haptics';

const ROOT = resolve(__dirname, '..');

describe('new order alert', () => {
  it('recognises the new-order push', () => {
    expect(isNewOrderNotification({ type: 'new_order_received', category: 'orders' })).toBe(true);
    expect(isNewOrderNotification({ type: 'order_shipped', category: 'orders' })).toBe(false);
    expect(isNewOrderNotification(undefined)).toBe(false);
  });

  it('maps to the success haptic', () => {
    expect(HAPTIC_MAP.newOrder).toBe('success');
  });

  it('the in-app banner plays the haptic only for new orders', () => {
    const src = readFileSync(resolve(ROOT, 'components/notifications/NotificationBanner.tsx'), 'utf8');
    expect(src).toMatch(/if \(isNewOrderNotification\(next\.data\)\) haptic\('newOrder'\)/);
    expect(src).not.toMatch(/Haptics\.\w+Async/);
  });

  it('the seller switch saves the preference the server reads', () => {
    const screen = readFileSync(resolve(ROOT, 'app/sounds-haptics.tsx'), 'utf8');
    expect(screen).toContain('NEW_ORDER_SOUND_PREF');
    const server = readFileSync(resolve(ROOT, '../api-server/src/routes/notification-prefs.ts'), 'utf8');
    expect(server).toContain(`${NEW_ORDER_SOUND_PREF}: true`);
  });
});
