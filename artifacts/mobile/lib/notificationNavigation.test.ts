import { describe, expect, it, vi } from 'vitest';
import { createNotificationResponseHandler } from './notificationNavigation';

function response(identifier: string) {
  return {
    notification: {
      request: {
        identifier,
        content: {
          data: {
            type: 'subscription_trial_will_end',
            route: '/subscription',
          },
        },
      },
    },
  };
}

describe('notification response navigation', () => {
  it('routes both warm and cold taps to Subscription only once', () => {
    const router = { push: vi.fn() };
    const handledResponseIds = new Set<string>();
    const handleWarmResponse = createNotificationResponseHandler(router, handledResponseIds);
    const handleColdResponse = createNotificationResponseHandler(router, handledResponseIds);
    const trialWarning = response('trial-warning-123');

    handleWarmResponse(trialWarning);
    handleColdResponse(trialWarning);

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/subscription');
  });

  it('does not treat a different notification as a stale redirect', () => {
    const router = { push: vi.fn() };
    const handler = createNotificationResponseHandler(router);

    handler(response('trial-warning-123'));
    handler(response('trial-warning-456'));

    expect(router.push).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenNthCalledWith(1, '/subscription');
    expect(router.push).toHaveBeenNthCalledWith(2, '/subscription');
  });
});