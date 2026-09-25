import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
}));

const {
  getConversationsMock, getNotificationsMock, markConversationReadMock,
  archiveConversationMock, muteUserMock, subscribeSocialMock, routerMock,
} = vi.hoisted(() => ({
  getConversationsMock: vi.fn(),
  getNotificationsMock: vi.fn(),
  markConversationReadMock: vi.fn(),
  archiveConversationMock: vi.fn(),
  muteUserMock: vi.fn(),
  subscribeSocialMock: vi.fn(() => () => {}),
  routerMock: { back: vi.fn(), push: vi.fn() },
}));

vi.mock('react-native', () => ({
  ActivityIndicator: nativeComponent('ActivityIndicator'),
  Alert: { alert: vi.fn() },
  FlatList: (props: { data?: unknown[]; renderItem: (info: { item: unknown; index: number }) => React.ReactNode; keyExtractor?: (item: unknown, index: number) => string }) =>
    React.createElement(
      'FlatList',
      props,
      (props.data ?? []).map((item, index) =>
        React.createElement(
          React.Fragment,
          { key: props.keyExtractor ? props.keyExtractor(item, index) : String(index) },
          props.renderItem({ item, index }),
        ),
      ),
    ),
  Modal: nativeComponent('Modal'),
  RefreshControl: nativeComponent('RefreshControl'),
  ScrollView: nativeComponent('ScrollView'),
  StyleSheet: { create: (styles: unknown) => styles, flatten: (s: unknown) => s },
  Text: nativeComponent('Text'),
  TextInput: nativeComponent('TextInput'),
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  View: nativeComponent('View'),
  Pressable: nativeComponent('Pressable'),
  Animated: {
    Value: class { _value: number; constructor(v?: number) { this._value = v ?? 0; } setValue(v: number) { this._value = v; } },
    View: nativeComponent('Animated.View'),
    timing: () => ({ start: (cb?: () => void) => cb?.() }),
    spring: () => ({ start: (cb?: () => void) => cb?.() }),
  },
  PanResponder: { create: () => ({ panHandlers: {} }) },
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(() => Promise.resolve()),
  selectionAsync: vi.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
  useFocusEffect: (callback: () => void | (() => void)) => {
    React.useEffect(() => {
      const cleanup = callback();
      return () => { if (typeof cleanup === 'function') cleanup(); };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: 'buyer-1' }),
}));

vi.mock('@/components/buyer-nav/buyerTabBarMetrics', () => ({
  useBuyerTabBarInset: () => 0,
}));

vi.mock('@/components/layout', () => ({
  EmptyState: ({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) =>
    React.createElement(
      'View',
      {},
      React.createElement('Text', {}, message),
      actionLabel
        ? React.createElement(
          'TouchableOpacity',
          { testID: 'empty-state-action', onPress: onAction },
          React.createElement('Text', {}, actionLabel),
        )
        : null,
    ),
  ListSkeleton: () => React.createElement('View', { testID: 'inbox-skeleton' }),
}));

vi.mock('@/components/BrandthreadUI', () => ({
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: { label: string; onPress: () => void } }) =>
    React.createElement(
      'View',
      {},
      React.createElement('Text', {}, title),
      description ? React.createElement('Text', {}, description) : null,
      action
        ? React.createElement(
          'TouchableOpacity',
          { testID: 'empty-state-action', onPress: action.onPress },
          React.createElement('Text', {}, action.label),
        )
        : null,
    ),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#0a0a0b',
      surface: '#111113',
      card: '#18181b',
      cardElevated: '#202024',
      border: '#3f3f46',
      text: '#fafafa',
      muted: '#a1a1aa',
      subtle: '#71717a',
      accent: '#c7cdd5',
      accentDim: '#34383e',
      onAccent: '#0a0a0b',
      success: '#22c55e',
      shadowColor: '#000000',
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ conversations: { accept: vi.fn(), decline: vi.fn() } }),
}));

vi.mock('@/lib/theme', () => ({
  BG: '#09090b',
  SCREEN_BG: 'transparent',
  CARD: '#18181b',
  CARD_ELEVATED: '#202024',
  BORDER: '#3f3f46',
  FG: '#fafafa',
  MUTED: '#a1a1aa',
  SUBTLE: '#71717a',
  RED: '#ef4444',
  SURFACE: '#111113',
  FONT: { regular: 'Test-Regular', medium: 'Test-Medium', semibold: 'Test-Semibold', bold: 'Test-Bold' },
  FS: { xs: 11, sm: 13, base: 15, md: 17 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, pill: 999 },
  COMP: {},
  ICON: { xs: 14, sm: 16, md: 20, lg: 24, xl: 28 },
}));

vi.mock('@/services/socialService', () => ({
  getConversations: getConversationsMock,
  getNotifications: getNotificationsMock,
  markConversationRead: markConversationReadMock,
  archiveConversation: archiveConversationMock,
  subscribeSocial: subscribeSocialMock,
  markNotificationRead: vi.fn(),
  searchProfiles: vi.fn().mockResolvedValue([]),
  createOrGetConversation: vi.fn(),
  muteUser: muteUserMock,
  MY_USER_ID: 'me',
}));

import InboxScreen from '@/app/(buyer)/inbox';

type ConversationFixture = ReturnType<typeof conversation>;

function conversation(id: string, unreadCount: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'buyer_to_seller',
    participants: [
      { userId: `seller-${id}`, name: `Seller ${id}`, handle: `@seller_${id}`, initials: 'S', color: '#c7cdd5', accountType: 'seller' },
    ],
    lastMessage: 'Can you help with sizing?',
    lastMessageTs: Date.now() - 60_000,
    unreadCount,
    isFriendshipActive: true,
    isArchived: false,
    isRequest: false,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function flushPromises() {
  return Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
}

function findTextNodes(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => (node.type as unknown) === 'Text');
}

function textContent(renderer: ReactTestRenderer): string {
  const parts: string[] = [];
  findTextNodes(renderer).forEach((node) => {
    const collect = (child: unknown): void => {
      if (child == null || typeof child === 'boolean') return;
      if (typeof child === 'string' || typeof child === 'number') { parts.push(String(child)); return; }
      if (Array.isArray(child)) child.forEach(collect);
    };
    collect(node.props.children);
  });
  return parts.join(' ');
}

function fontFamilyOf(node: ReturnType<typeof findTextNodes>[number]): string[] {
  const style = node.props.style;
  const flat = Array.isArray(style) ? style : [style];
  return flat.filter(Boolean).map((entry: Record<string, unknown>) => entry.fontFamily).filter(Boolean) as string[];
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<InboxScreen />);
    await flushPromises();
  });
  return renderer;
}

describe('buyer inbox', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    getConversationsMock.mockReset();
    getNotificationsMock.mockReset().mockResolvedValue([]);
    markConversationReadMock.mockReset().mockResolvedValue(undefined);
    archiveConversationMock.mockReset().mockResolvedValue(undefined);
    muteUserMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
  });

  it('renders an unread conversation name in bold and a read conversation name in regular weight', async () => {
    getConversationsMock.mockResolvedValue([
      conversation('unread-thread', 2, { participants: [{ userId: 's1', name: 'Alice Unread', handle: '@alice', initials: 'A', color: '#fff', accountType: 'seller' }] }),
      conversation('read-thread', 0, { participants: [{ userId: 's2', name: 'Bob Read', handle: '@bob', initials: 'B', color: '#fff', accountType: 'seller' }] }),
    ]);
    renderer = await renderScreen();

    const unreadName = findTextNodes(renderer).find((n) => n.props.children === 'Alice Unread');
    const readName = findTextNodes(renderer).find((n) => n.props.children === 'Bob Read');
    expect(unreadName).toBeTruthy();
    expect(readName).toBeTruthy();
    expect(fontFamilyOf(unreadName!)).toContain('Test-Bold');
    expect(fontFamilyOf(readName!)).toContain('Test-Regular');
  });

  it('shows the unread badge with the right count and hides it once read', async () => {
    getConversationsMock.mockResolvedValue([conversation('unread-thread', 3)]);
    renderer = await renderScreen();

    expect(renderer.root.findAllByProps({ testID: 'inbox-unread-badge-unread-thread' }, { deep: false })).toHaveLength(1);
    expect(textContent(renderer)).toContain('3');

    getConversationsMock.mockResolvedValue([conversation('unread-thread', 0)]);
    await act(async () => {
      renderer!.root.findByProps({ testID: `inbox-swipe-read-unread-thread` }).props.onPress();
      await flushPromises();
    });

    expect(markConversationReadMock).toHaveBeenCalledWith('unread-thread');
    expect(renderer.root.findAllByProps({ testID: 'inbox-unread-badge-unread-thread' }, { deep: false })).toHaveLength(0);
  });

  it('filters conversations by name, handle and last-message text', async () => {
    getConversationsMock.mockResolvedValue([
      conversation('c1', 1, { participants: [{ userId: 's1', name: 'Alice Unread', handle: '@alice', initials: 'A', color: '#fff', accountType: 'seller' }], lastMessage: 'See you soon' }),
      conversation('c2', 0, { participants: [{ userId: 's2', name: 'Bob Read', handle: '@bob', initials: 'B', color: '#fff', accountType: 'seller' }], lastMessage: 'Order shipped today' }),
    ]);
    renderer = await renderScreen();

    expect(renderer.root.findAllByProps({ testID: 'inbox-conversation-c1' }, { deep: false })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ testID: 'inbox-conversation-c2' }, { deep: false })).toHaveLength(1);

    await act(async () => {
      renderer!.root.findByProps({ testID: 'inbox-search-input' }).props.onChangeText('shipped');
      await flushPromises();
    });

    expect(renderer.root.findAllByProps({ testID: 'inbox-conversation-c1' }, { deep: false })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'inbox-conversation-c2' }, { deep: false })).toHaveLength(1);

    await act(async () => {
      renderer!.root.findByProps({ testID: 'inbox-search-input' }).props.onChangeText('alice');
      await flushPromises();
    });

    expect(renderer.root.findAllByProps({ testID: 'inbox-conversation-c1' }, { deep: false })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ testID: 'inbox-conversation-c2' }, { deep: false })).toHaveLength(0);
  });

  it('triggers mute, delete and mark-read from the swipe actions', async () => {
    const convs: ConversationFixture[] = [conversation('swipe-thread', 1)];
    getConversationsMock.mockResolvedValue(convs);
    renderer = await renderScreen();

    await act(async () => {
      renderer!.root.findByProps({ testID: 'inbox-swipe-mute-swipe-thread' }).props.onPress();
      await flushPromises();
    });
    expect(muteUserMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'seller-swipe-thread' }));

    await act(async () => {
      renderer!.root.findByProps({ testID: 'inbox-swipe-read-swipe-thread' }).props.onPress();
      await flushPromises();
    });
    expect(markConversationReadMock).toHaveBeenCalledWith('swipe-thread');

    // Delete last: the row (and its swipe actions) leaves the list once archived.
    await act(async () => {
      renderer!.root.findByProps({ testID: 'inbox-swipe-delete-swipe-thread' }).props.onPress();
      await flushPromises();
    });
    expect(archiveConversationMock).toHaveBeenCalledWith('swipe-thread');
  });

  it('shows a skeleton while loading, then a CTA empty state once loaded empty', async () => {
    let resolveConvs!: (value: ConversationFixture[]) => void;
    const pending = new Promise<ConversationFixture[]>((resolve) => { resolveConvs = resolve; });
    getConversationsMock.mockReturnValue(pending);

    await act(async () => {
      renderer = create(<InboxScreen />);
      await Promise.resolve();
    });

    expect(renderer!.root.findAllByProps({ testID: 'inbox-skeleton' }, { deep: false }).length).toBeGreaterThan(0);
    expect(renderer!.root.findAllByProps({ testID: 'empty-state-action' }, { deep: false })).toHaveLength(0);

    await act(async () => {
      resolveConvs([]);
      await flushPromises();
    });

    expect(renderer!.root.findAllByProps({ testID: 'inbox-skeleton' }, { deep: false })).toHaveLength(0);
    expect(textContent(renderer!)).toContain('No messages yet');
    const cta = renderer!.root.findByProps({ testID: 'empty-state-action' });
    expect(cta).toBeTruthy();

    await act(async () => {
      cta.props.onPress();
      await flushPromises();
    });
    expect(renderer!.root.findAllByProps({ placeholder: 'Search people' }).length).toBeGreaterThan(0);
  });
});
