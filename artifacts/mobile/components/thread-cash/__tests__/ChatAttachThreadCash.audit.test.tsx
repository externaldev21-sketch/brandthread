import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';

const h = vi.hoisted(() => {
  const get = vi.fn();
  const send = vi.fn();
  return { get, send, api: { threadCash: { get, send } } };
});

vi.mock('@/lib/api', () => ({ useApi: () => h.api }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: new Proxy({}, { get: () => '#888888' }) }),
}));
vi.mock('@/lib/appLock', () => ({
  getDeviceSecurity: async () => ({ supported: false, hasDeviceSecurity: false }),
  authenticateForAppLock: async () => ({ success: true }),
}));
vi.mock('@/lib/previewInbox', () => ({ isPreviewConversationId: () => false, isSellerPreviewConversationId: () => false }));
vi.mock('@/lib/haptics', () => ({ haptic: () => {}, haptics: {} }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/ui/SuccessCheck', () => ({ SuccessCheck: () => null }));
vi.mock('../ThreadCashBill', () => ({ ThreadCashBill: () => null, ThreadCashBillIcon: () => null, THREAD_CASH_GREEN_MID: '#3DBE4F' }));
vi.mock('@/components/ui/Button', () => ({
  Button: (props: Record<string, unknown>) => React.createElement('Button', props),
}));
vi.mock('@/components/ui/BottomSheet', () => ({
  Sheet: ({ visible, children, footer }: { visible: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
    (visible ? React.createElement('Sheet', null, children, footer) : null),
}));

import { ThreadCashAttachButton } from '../ChatAttachThreadCash';

beforeEach(() => {
  vi.useFakeTimers();
  h.get.mockReset().mockResolvedValue({ balanceCents: 10_000 });
  h.send.mockReset().mockResolvedValue({ transferId: 't-1' });
});
afterEach(() => { vi.useRealTimers(); });

async function sendFive(onSent: () => void) {
  let open!: () => void;
  let root!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    root = TestRenderer.create(
      <ThreadCashAttachButton recipientId="u2" conversationId="c1" onSent={onSent} renderTrigger={(o) => { open = o; return null; }} />,
    );
  });
  await act(async () => { open(); });
  await act(async () => { root.root.findByProps({ testID: 'thread-cash-chip-5' }).props.onPress(); });
  await act(async () => { root.root.findByProps({ testID: 'thread-cash-continue' }).props.onPress(); });
  await act(async () => { root.root.findByProps({ testID: 'thread-cash-confirm-send' }).props.onPress(); });
  expect(h.send).toHaveBeenCalledTimes(1);
  return root;
}

describe('ThreadCashAttachButton (audit)', () => {
  it('still posts the chat bubble for a completed transfer when unmounted during the sent hold', async () => {
    const onSent = vi.fn();
    const root = await sendFive(onSent);
    expect(onSent).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { root.unmount(); });
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith({ transferId: 't-1', amountCents: 500, note: null });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('posts it exactly once when the hold finishes normally and the card later unmounts', async () => {
    const onSent = vi.fn();
    const root = await sendFive(onSent);
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(onSent).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
    expect(onSent).toHaveBeenCalledTimes(1);
  });
});
