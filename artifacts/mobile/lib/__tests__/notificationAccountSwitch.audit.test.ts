import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import {
  ACCOUNT_SWITCH_SETTLE_MS,
  configureNotificationAccountSwitcher,
  createNotificationResponseHandler,
} from '../notificationNavigation';
import { handleNotificationAction } from '../notificationActions';

function push(identifier: string, data: Record<string, unknown>, actionIdentifier?: string) {
  return {
    ...(actionIdentifier ? { actionIdentifier } : {}),
    notification: { request: { identifier, content: { data } } },
  };
}

afterEach(() => {
  configureNotificationAccountSwitcher(null);
  vi.useRealTimers();
});

describe('notification actions for another signed-in account', () => {
  it('"Ship now" switches to the push\'s account before opening the fulfil screen', async () => {
    vi.useFakeTimers();
    const switchTo = vi.fn(async () => true);
    configureNotificationAccountSwitcher({ currentAccountId: () => 'seller-a', switchTo });
    const router = { push: vi.fn() };
    createNotificationResponseHandler(router)(push('n1', {
      accountId: 'seller-b', targetType: 'order', targetId: 'ord-9', type: 'new_order_received',
    }, 'ship_now'));
    expect(router.push).not.toHaveBeenCalled();
    expect(switchTo).toHaveBeenCalledWith('seller-b');
    await vi.advanceTimersByTimeAsync(ACCOUNT_SWITCH_SETTLE_MS);
    expect(router.push).toHaveBeenCalledWith('/fulfill-order?orderId=ord-9');
  });

  it('a trial push for another account switches before opening Subscription', async () => {
    vi.useFakeTimers();
    const switchTo = vi.fn(async () => true);
    configureNotificationAccountSwitcher({ currentAccountId: () => 'seller-a', switchTo });
    const router = { push: vi.fn() };
    createNotificationResponseHandler(router)(push('n2', { accountId: 'seller-b', route: '/subscription' }));
    expect(router.push).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ACCOUNT_SWITCH_SETTLE_MS);
    expect(switchTo).toHaveBeenCalledWith('seller-b');
    expect(router.push).toHaveBeenCalledWith('/subscription');
  });

  it('"Mark shipped" switches to the push\'s account before opening the fulfil screen', async () => {
    vi.useFakeTimers();
    const switchTo = vi.fn(async () => true);
    configureNotificationAccountSwitcher({ currentAccountId: () => 'seller-a', switchTo });
    const router = { push: vi.fn() };
    const handled = handleNotificationAction({
      actionIdentifier: 'mark_shipped',
      userText: undefined,
      notification: { request: { content: { data: { accountId: 'seller-b', orderId: 'ord-3' } } } },
    } as never, router);
    expect(handled).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ACCOUNT_SWITCH_SETTLE_MS);
    expect(switchTo).toHaveBeenCalledWith('seller-b');
    expect(router.push).toHaveBeenCalledWith('/fulfill-order?orderId=ord-3');
  });

  it('same account: opens straight away', () => {
    configureNotificationAccountSwitcher({ currentAccountId: () => 'seller-a', switchTo: vi.fn() });
    const router = { push: vi.fn() };
    createNotificationResponseHandler(router)(push('n3', {
      accountId: 'seller-a', targetType: 'order', targetId: 'ord-1',
    }, 'ship_now'));
    expect(router.push).toHaveBeenCalledWith('/fulfill-order?orderId=ord-1');
  });
});
