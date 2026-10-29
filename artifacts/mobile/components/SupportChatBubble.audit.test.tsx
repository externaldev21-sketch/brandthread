/**
 * Audit regression: an AI reply with `shouldEscalate` escalates from the
 * sendMessage closure captured when the message was sent. If the person
 * tapped "Human" while that reply was in flight, the closure still saw
 * `escalated === false` and filed a second support ticket.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const chat = vi.hoisted(() => ({ send: vi.fn(), escalate: vi.fn() }));

vi.mock('@/lib/api', () => ({ useApi: () => ({ supportChat: chat }) }));
vi.mock('@/components/KeyboardProviderCompat', () => {
  const R = require('react') as typeof import('react');
  return { KeyboardAvoidingView: ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children) };
});
vi.mock('@/components/ui/Composer', () => {
  const R = require('react') as typeof import('react');
  return { default: (props: Record<string, unknown>) => R.createElement('Composer', props) };
});
vi.mock('react-native', async (importOriginal) => {
  const RN = await importOriginal<Record<string, unknown>>();
  const R = require('react') as typeof import('react');
  const FlatList = ({ data, renderItem, ListFooterComponent }: {
    data: unknown[]; renderItem: (i: { item: unknown; index: number }) => React.ReactNode; ListFooterComponent?: React.ReactNode;
  }) => R.createElement(R.Fragment, null, ...data.map((item, index) => R.createElement(R.Fragment, { key: index }, renderItem({ item, index }))), ListFooterComponent ?? null);
  const anim = () => ({ start() {}, stop() {} });
  const Animated = { ...(RN.Animated as object), delay: anim, sequence: anim, loop: anim };
  return { ...RN, Animated, FlatList, Keyboard: { addListener: () => ({ remove() {} }) } };
});

const { SupportChatModal } = await import('./SupportChatBubble');

describe('SupportChatModal — one ticket per conversation', () => {
  it('does not escalate again when an AI reply asks to after "Human" was tapped', async () => {
    let resolveReply!: (v: unknown) => void;
    chat.send.mockReturnValue(new Promise((r) => { resolveReply = r; }));
    chat.escalate.mockResolvedValue({ ok: true, message: 'ok' });

    let r!: ReactTestRenderer;
    act(() => { r = create(<SupportChatModal visible onClose={() => {}} />); });
    // Send a question; the reply is still pending.
    act(() => { r.root.find((n) => n.type === 'Composer').props.onChangeText('Where is my payout?'); });
    await act(async () => { r.root.find((n) => n.type === 'Composer').props.onSend(); });
    // Tap "Human" (the header's escalate button) while waiting.
    const human = r.root.find((n) => n.type === 'TouchableOpacity'
      && n.findAll((c) => c.type === 'Text' && c.props.children === 'Human').length > 0);
    await act(async () => { human.props.onPress(); });
    expect(chat.escalate).toHaveBeenCalledTimes(1);
    // Now the AI reply lands, asking to escalate.
    await act(async () => { resolveReply({ content: 'Let me get a human.', shouldEscalate: true }); await Promise.resolve(); });
    expect(chat.escalate).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});
