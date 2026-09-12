import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock, focusState, routerMock } = vi.hoisted(() => ({
  apiMock: {
    conversations: {
      list: vi.fn(),
    },
  },
  focusState: {
    callback: undefined as (() => void | (() => void)) | undefined,
    cleanup: undefined as (() => void) | undefined,
  },
  routerMock: {
    back: vi.fn(),
    push: vi.fn(),
  },
}));

vi.mock('react-native', () => {
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };

  return {
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    FlatList: (props: {
      data: unknown[];
      renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    }) => React.createElement(
      'FlatList',
      props,
      props.data.map((item, index) => props.renderItem({ item, index })),
    ),
    RefreshControl: nativeComponent('RefreshControl'),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
  };
});

vi.mock('@clerk/expo', () => ({
  useUser: () => ({ user: { id: 'seller-user' } }),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
  useFocusEffect: (callback: () => void | (() => void)) => {
    focusState.callback = callback;
    React.useEffect(() => {
      const cleanup = callback();
      focusState.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      return () => {
        focusState.cleanup?.();
        focusState.cleanup = undefined;
      };
    }, [callback]);
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#c7cdd5',
      accentDim: '#34383e',
      accentLight: '#f8fafc',
      secondary: '#22d3ee',
      secondaryDim: '#164e63',
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => apiMock,
}));

vi.mock('@/lib/contextualPushPermission', () => ({
  requestContextualPushPermission: vi.fn(),
}));

vi.mock('@/lib/networkNotice', () => ({
  reportNetworkError: vi.fn(),
}));

vi.mock('@/lib/theme', () => ({
  BG: '#09090b',
  SCREEN_BG: 'transparent',
  CARD: '#18181b',
  CARD_GLASS: 'rgba(18, 18, 31, 0.45)',
  CARD_ELEVATED_GLASS: 'rgba(24, 24, 46, 0.65)',
  SURFACE_GLASS: 'rgba(12, 12, 23, 0.65)',
  SKELETON_GLASS: 'rgba(255,255,255,0.05)',
  BORDER: '#3f3f46',
  FG: '#fafafa',
  MUTED: '#a1a1aa',
  SUBTLE: '#71717a',
  ON_DARK: '#ffffff',
  FONT: { regular: 'System', semibold: 'System', bold: 'System', medium: 'System' },
  FS: { xs: 12, sm: 14, base: 16, md: 18 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  RADIUS: { sm: 8, lg: 16 },
  ICON: { lg: 24, sm: 16 },
}));

import SellerInboxScreen from '@/app/seller-inbox';
import { notifyConversationReadFailure } from '@/lib/conversationReadEvents';

type Conversation = {
  id: string;
  type: string;
  participants: Array<{
    userId: string;
    name: string;
    handle: string;
    initials: string;
    color: string;
    accountType: string;
  }>;
  lastMessage: string;
  lastMessageTs: number;
  unreadCount: number;
  updatedAt: string;
};

function conversation(id: string, unreadCount: number): Conversation {
  return {
    id,
    type: 'buyer_to_seller',
    participants: [
      { userId: 'seller-user', name: 'Seller', handle: '@seller', initials: 'S', color: '#c7cdd5', accountType: 'seller' },
      { userId: 'buyer-user', name: 'Buyer', handle: '@buyer', initials: 'B', color: '#22d3ee', accountType: 'buyer' },
    ],
    lastMessage: 'Can you help with sizing?',
    lastMessageTs: 1_000,
    unreadCount,
    updatedAt: '2026-08-31T12:00:00.000Z',
  };
}

function flushPromises() {
  return Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
}

function textContent(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join('') : String(children ?? '');
    })
    .join(' ');
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SellerInboxScreen />);
    await flushPromises();
  });
  return renderer;
}

async function refocusScreen() {
  await act(async () => {
    focusState.cleanup?.();
    focusState.cleanup = focusState.callback?.() as (() => void) | undefined;
    await flushPromises();
  });
}

describe('seller inbox unread state', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    apiMock.conversations.list.mockReset();
    routerMock.back.mockReset();
    routerMock.push.mockReset();
    focusState.callback = undefined;
    focusState.cleanup = undefined;
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
  });

  it('clears the opened row badge and total unread subtitle immediately', async () => {
    apiMock.conversations.list.mockResolvedValue([
      conversation('unread-thread', 2),
      conversation('another-thread', 1),
    ]);
    renderer = await renderScreen();

    expect(textContent(renderer)).toContain('3 unread');
    expect(textContent(renderer)).toContain('2');

    const row = renderer.root.findByProps({ testID: 'seller-conversation-unread-thread' });
    await act(async () => {
      row.props.onPress();
      await flushPromises();
    });

    expect(textContent(renderer)).not.toContain('3 unread');
    expect(renderer.root.findAllByProps({ testID: 'seller-unread-badge-unread-thread' }))
      .toHaveLength(0);
    expect(routerMock.push).toHaveBeenCalledWith('/seller-conversation?id=unread-thread');
  });

  it('does not restore a stale badge when a later inbox load is delayed or fails', async () => {
    apiMock.conversations.list.mockResolvedValueOnce([
      conversation('unread-thread', 2),
      conversation('another-thread', 1),
    ]);
    renderer = await renderScreen();

    await act(async () => {
      renderer!.root.findByProps({ testID: 'seller-conversation-unread-thread' }).props.onPress();
      await flushPromises();
    });
    expect(textContent(renderer)).not.toContain('3 unread');

    let resolveDelayed!: (value: Conversation[]) => void;
    const delayed = new Promise<Conversation[]>((resolve) => {
      resolveDelayed = resolve;
    });
    apiMock.conversations.list.mockReturnValueOnce(delayed);
    await refocusScreen();
    expect(textContent(renderer)).not.toContain('3 unread');

    resolveDelayed([
      conversation('unread-thread', 2),
      conversation('another-thread', 1),
    ]);
    await act(async () => {
      await flushPromises();
    });
    expect(textContent(renderer)).not.toContain('3 unread');

    apiMock.conversations.list.mockRejectedValueOnce(new Error('offline'));
    await refocusScreen();
    expect(textContent(renderer)).not.toContain('3 unread');
  });

  it('restores the server unread count after a failed read receipt and refocus', async () => {
    apiMock.conversations.list.mockResolvedValueOnce([
      conversation('unread-thread', 2),
      conversation('another-thread', 1),
    ]);
    renderer = await renderScreen();

    await act(async () => {
      renderer!.root.findByProps({ testID: 'seller-conversation-unread-thread' }).props.onPress();
      await flushPromises();
    });
    expect(textContent(renderer)).not.toContain('3 unread');

    apiMock.conversations.list.mockResolvedValue([
      conversation('unread-thread', 2),
      conversation('another-thread', 1),
    ]);
    await act(async () => {
      notifyConversationReadFailure('unread-thread');
      await flushPromises();
    });
    await refocusScreen();

    expect(textContent(renderer)).toContain('3 unread');
    expect(renderer.root.findAllByProps({ testID: 'seller-unread-badge-unread-thread' }).length)
      .toBeGreaterThan(0);
  });
});