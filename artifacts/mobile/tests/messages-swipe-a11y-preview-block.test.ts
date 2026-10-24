import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Animated: {}, PanResponder: { create: () => ({ panHandlers: {} }) }, Platform: { OS: 'ios' },
  Pressable: () => null, StyleSheet: { create: (s: unknown) => s }, Text: () => null, View: () => null,
}));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('@/components/ui/SwipeRow', () => ({ default: () => null }));

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('inbox swipe actions are reachable by screen readers', () => {
  it('derives accessibilityActions from the swipe action list and runs the matching one', async () => {
    const { inboxSwipeAccessibilityProps } = await import('@/components/inbox/InboxSwipeRow');
    const block = vi.fn();
    const del = vi.fn();
    const props = inboxSwipeAccessibilityProps([
      { key: 'block', label: 'Block', icon: 'slash', onPress: block, accessibilityLabel: 'Block Mara' },
      { key: 'delete', label: 'Delete', icon: 'trash-2', onPress: del },
    ]);
    expect(props.accessibilityActions).toEqual([
      { name: 'block', label: 'Block Mara' },
      { name: 'delete', label: 'Delete' },
    ]);
    props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
    expect(del).toHaveBeenCalledTimes(1);
    expect(block).not.toHaveBeenCalled();
  });

  it('inbox, request and group rows spread them on the focusable row button', () => {
    const inbox = read('components/inbox/MessagesInbox.tsx');
    expect(inbox).toContain('{...inboxSwipeAccessibilityProps(rowActions)}');
    expect(inbox).toContain('{...inboxSwipeAccessibilityProps(swipeActions)}');
    expect(read('components/community-inbox/CommunityInboxRow.tsx')).toContain('{...inboxSwipeAccessibilityProps(actions)}');
  });
});

describe('preview Block never calls the real API', () => {
  it('conversation details applies block/unblock locally in preview', () => {
    const src = read('app/conversation-details.tsx');
    expect(src).toContain('confirmBlock(subject, isPreview ? previewNoop : api.social.block, showAlert)');
    expect(src).toContain('confirmUnblock(subject, isPreview ? previewNoop : api.social.unblock, showAlert)');
  });

  it('the shared thread options menu does the same for seeded preview threads', () => {
    const src = read('components/chat/ConversationThread.tsx');
    expect(src).toContain('const block = conv && isPreviewId(conv.id) ? async () => {} : api.social.block;');
    expect(src).toContain('const unblock = conv && isPreviewId(conv.id) ? async () => {} : api.social.unblock;');
  });
});

describe('seller inbox header shows the unread total', () => {
  it('computes unread across inbox threads and passes it as the header subtitle (sellers only, hidden at 0)', () => {
    const src = read('components/inbox/MessagesInbox.tsx');
    expect(src).toContain('const totalUnread = conversations.reduce(');
    expect(src).toContain('subtitle={isSeller && totalUnread > 0 ? `${totalUnread} unread` : undefined}');
    const header = read('components/reframe/ScreenHeader.tsx');
    expect(header).toContain('subtitle?: string;');
    expect(header).toContain('testID="screen-header-subtitle"');
  });
});
