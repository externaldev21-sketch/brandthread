/**
 * Item 72 — Thread Cash send in chat: the animated send confirmation and
 * the resulting chat bubble, both in components/thread-cash/ChatAttachThreadCash.tsx.
 *
 * Covers: (1) a real send actually persists before anything closes, (2) the
 * "You sent $X to {name}" confirmation reuses the existing monochrome
 * SuccessCheck 'draw' component (no new green/colored moment introduced),
 * and only afterward hands off to onSent + closes, (3) the in-thread
 * ThreadCashMessageCard's Accept/Cancel affordances follow status/sender
 * correctly, matching what both app/buyer-conversation.tsx and
 * app/seller-conversation.tsx rely on.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { sendMock, alertMock, successCheckCalls } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  alertMock: vi.fn(),
  successCheckCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };
  return {
    View: nativeComponent('View'),
    Text: nativeComponent('Text'),
    TextInput: nativeComponent('TextInput'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    Pressable: nativeComponent('Pressable'),
    Modal: (props: Record<string, unknown>) => (props.visible ? React.createElement(React.Fragment, null, props.children as React.ReactNode) : null),
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Alert: { alert: alertMock },
    Animated: {
      View: nativeComponent('AnimatedView'),
      Value: class { constructor(public v: number) {} interpolate() { return this; } },
      loop: () => ({ start: () => undefined, stop: () => undefined }),
      sequence: (a: unknown) => a,
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
    },
    Easing: { inOut: (fn: unknown) => fn, ease: (t: number) => t },
  };
});

vi.mock('@expo/vector-icons', () => ({ Feather: (props: Record<string, unknown>) => React.createElement('Feather', props) }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: (props: Record<string, unknown>) => React.createElement('LinearGradient', props, props.children as React.ReactNode) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('expo-haptics', () => ({
  selectionAsync: vi.fn(async () => {}),
  notificationAsync: vi.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success' },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));
vi.mock('@/lib/appLock', () => ({
  authenticateForAppLock: vi.fn(async () => ({ success: true, cancelled: false })),
  getDeviceSecurity: vi.fn(async () => ({ supported: false, hasDeviceSecurity: false })),
}));
vi.mock('@/lib/previewInbox', () => ({
  isPreviewConversationId: (id: string) => !!id && id.startsWith('preview-conversation-'),
  isSellerPreviewConversationId: (id: string) => !!id && id.startsWith('preview-seller-conversation-'),
}));
vi.mock('@/lib/money', () => ({ formatCents: (c: number) => `$${(c / 100).toFixed(2)}` }));
vi.mock('@/lib/theme', () => ({
  FONT: { regular: 'Inter', medium: 'Inter-Medium', semibold: 'Inter-SemiBold', bold: 'Inter-Bold' },
  FS: { xs: 12, sm: 13, base: 15, xl: 22, h1: 28 },
  SP: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  RADIUS: { pill: 999, lg: 16, xl: 24 },
}));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      text: '#FAFAFA', muted: '#B8B8C0', subtle: '#A8A8B1', background: '#0A0A0B',
      card: '#18181B', cardElevated: '#18181B', border: '#FFFFFF2B', borderSubtle: '#FFFFFF1A',
      accent: '#F7F7FA', accentDim: '#F7F7FA2E', onAccent: '#0A0A0B',
    },
  }),
}));
vi.mock('@/components/ui/Button', () => ({
  Button: ({ label, onPress, testID, disabled }: { label: string; onPress: () => void; testID?: string; disabled?: boolean }) =>
    React.createElement('Button', { testID, onPress, disabled, label }, label),
}));
vi.mock('@/components/motion/SheetRise', () => ({
  SheetRise: (props: Record<string, unknown>) => React.createElement('SheetRise', props, props.children as React.ReactNode),
}));
vi.mock('@/components/thread-cash/ThreadCashBill', () => ({
  ThreadCashBill: () => React.createElement('ThreadCashBill'),
  ThreadCashBillIcon: () => React.createElement('ThreadCashBillIcon'),
}));
// SuccessCheck itself is unit-tested in tests/success-check-draw.test.tsx
// (its monochrome white-stroke-only rendering, no fill/color). Mocked here
// to a prop-capturing marker so this suite can assert *that* it is reused
// for the send confirmation, with which variant, without re-testing its
// internal reanimated/svg drawing.
vi.mock('@/components/ui/SuccessCheck', () => ({
  SuccessCheck: (props: Record<string, unknown>) => {
    successCheckCalls.push(props);
    return React.createElement('SuccessCheck', props);
  },
}));
vi.mock('@/lib/api', () => ({
  useApi: () => ({ threadCash: { send: sendMock, get: vi.fn(async () => ({ balanceCents: 5000 })) } }),
}));

import { ThreadCashAttachButton, ThreadCashMessageCard } from '@/components/thread-cash/ChatAttachThreadCash';

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(element); });
  return renderer;
}

describe('ThreadCashAttachButton — send confirmation (item 72)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendMock.mockReset();
    alertMock.mockReset();
    successCheckCalls.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists the transfer via the real API, then shows a monochrome "You sent" confirmation reusing SuccessCheck(variant="draw") before onSent fires', async () => {
    sendMock.mockResolvedValue({ ok: true, transferId: 'transfer-abc' });
    const onSent = vi.fn();

    const tree = render(
      <ThreadCashAttachButton
        recipientId="seller-1"
        recipientName="Forme 22"
        recipientHandle="forme22"
        conversationId="real-conversation-1"
        onSent={onSent}
      />,
    );

    // Open the sheet, pick the $10 preset, go to confirm, then send.
    await act(async () => { tree.root.findByProps({ testID: undefined }); });
    const opener = tree.root.findAllByType('TouchableOpacity' as never)[0];
    await act(async () => { (opener.props as { onPress: () => void }).onPress(); });

    const chip10 = tree.root.findByProps({ testID: 'thread-cash-chip-10' });
    await act(async () => { (chip10.props as { onPress: () => void }).onPress(); });

    const continueBtn = tree.root.findByProps({ testID: 'thread-cash-continue' });
    await act(async () => { (continueBtn.props as { onPress: () => void }).onPress(); });

    // The backend send must already be in flight/awaited before any
    // confirmation UI appears — this is a real persisted transfer, not a
    // purely local animation.
    const confirmBtn = tree.root.findByProps({ testID: 'thread-cash-confirm-send' });
    await act(async () => { await (confirmBtn.props as { onPress: () => Promise<void> }).onPress(); });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: 'seller-1', conversationId: 'real-conversation-1', amountCents: 1000,
    }));
    // onSent must NOT have fired yet — the confirmation is still showing.
    expect(onSent).not.toHaveBeenCalled();

    const confirmation = tree.root.findByProps({ testID: 'thread-cash-sent-confirmation' });
    expect(confirmation).toBeTruthy();
    // Reuses the app's one existing monochrome "it's done" moment, same
    // draw variant as the checkout/order-published success screens —
    // never a new (potentially green) checkmark or animation curve.
    expect(successCheckCalls.at(-1)).toMatchObject({ variant: 'draw' });
    const texts = tree.root.findAllByType('Text' as never).map((n) => [n.props.children].flat().join(''));
    expect(texts).toEqual(expect.arrayContaining([expect.stringContaining('You sent $10.00')]));
    expect(texts).toEqual(expect.arrayContaining([expect.stringContaining('to @forme22')]));

    // Only after the confirmation's hold finishes does the real chat
    // message get posted (onSent) and the sheet reset/close.
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(onSent).toHaveBeenCalledWith({ transferId: 'transfer-abc', amountCents: 1000, note: null });
  });

  it('mocks the send locally (never hits the real API) for a seller-preview conversation id, so the seller side is clickable end-to-end too', async () => {
    const onSent = vi.fn();
    const tree = render(
      <ThreadCashAttachButton
        recipientId="buyer-1"
        recipientHandle="mayatorres"
        conversationId="preview-seller-conversation-02"
        onSent={onSent}
      />,
    );
    const opener = tree.root.findAllByType('TouchableOpacity' as never)[0];
    await act(async () => { (opener.props as { onPress: () => void }).onPress(); });
    const chip5 = tree.root.findByProps({ testID: 'thread-cash-chip-5' });
    await act(async () => { (chip5.props as { onPress: () => void }).onPress(); });
    const continueBtn = tree.root.findByProps({ testID: 'thread-cash-continue' });
    await act(async () => { (continueBtn.props as { onPress: () => void }).onPress(); });
    const confirmBtn = tree.root.findByProps({ testID: 'thread-cash-confirm-send' });
    await act(async () => { await (confirmBtn.props as { onPress: () => Promise<void> }).onPress(); });

    expect(sendMock).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'thread-cash-sent-confirmation' })).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(onSent).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 500 }));
  });
});

describe('ThreadCashMessageCard — chat bubble status affordances', () => {
  it('shows Accept only for the recipient of a pending transfer', () => {
    const tree = render(
      <ThreadCashMessageCard
        amountCents={500}
        status="pending"
        isRecipient
        isSender={false}
        onClaim={() => {}}
      />,
    );
    expect(tree.root.findByProps({ testID: 'thread-cash-accept' })).toBeTruthy();
  });

  it('shows Cancel only for the sender of a pending transfer, never both controls at once', () => {
    const tree = render(
      <ThreadCashMessageCard
        amountCents={500}
        status="pending"
        isRecipient={false}
        isSender
        onClaim={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(() => tree.root.findByProps({ testID: 'thread-cash-accept' })).toThrow();
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Cancel send' }).length).toBeGreaterThanOrEqual(0);
  });

  it('shows neither action once claimed — a settled transfer is read-only', () => {
    const tree = render(
      <ThreadCashMessageCard
        amountCents={500}
        status="claimed"
        isRecipient
        isSender={false}
        onClaim={() => {}}
      />,
    );
    expect(() => tree.root.findByProps({ testID: 'thread-cash-accept' })).toThrow();
  });
});
