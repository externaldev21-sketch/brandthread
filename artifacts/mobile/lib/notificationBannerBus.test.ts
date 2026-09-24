import { describe, expect, it, vi, afterEach } from 'vitest';
import { setNotificationBannerListener, showNotificationBanner } from './notificationBannerBus';

describe('notificationBannerBus', () => {
  afterEach(() => setNotificationBannerListener(null));

  it('delivers a shown banner to the registered listener', () => {
    const listener = vi.fn();
    setNotificationBannerListener(listener);
    const payload = { id: '1', title: 'Hello', body: 'World' };
    showNotificationBanner(payload);
    expect(listener).toHaveBeenCalledWith(payload);
  });

  it('does not throw when no listener is registered', () => {
    expect(() => showNotificationBanner({ id: '1', title: 'x', body: 'y' })).not.toThrow();
  });

  it('stops delivering after the listener is cleared', () => {
    const listener = vi.fn();
    setNotificationBannerListener(listener);
    setNotificationBannerListener(null);
    showNotificationBanner({ id: '2', title: 'x', body: 'y' });
    expect(listener).not.toHaveBeenCalled();
  });
});
