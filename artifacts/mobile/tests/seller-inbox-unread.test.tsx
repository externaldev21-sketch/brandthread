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
    Animated: {
      Value: class { _value: number; constructor(v?: number) { this._value = v ?? 0; } setValue(v: number) { this._value = v; } interpolate() { return this._value; } },
      View: nativeComponent('Animated.View'),
      timing: () => ({ start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }) }),
      spring: () => ({ start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }) }),
      loop: () => ({ start: () => {}, stop: () => {} }),
      sequence: () => ({ start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }) }),
    },
    FlatList: (props: {
      data: unknown[];
      renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    }) => React.createElement(
      'FlatList',
      props,
      props.data.map((item, index) => props.renderItem({ item, index })),
    ),
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios },
    Pressable: (props: Record<string, unknown> & { children?: unknown }) => {
      const { children, ...rest } = props;
      return React.createElement(
        'Pressable',
        rest,
        typeof children === 'function' ? (children as (state: { pressed: boolean }) => React.ReactNode)({ pressed: false }) : (children as React.ReactNode),
      );
    },
    RefreshControl: nativeComponent('RefreshControl'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {}, flatten: (s: unknown) => s },
    Switch: nativeComponent('Switch'),
    Text: nativeComponent('Text'),
    TextInput: nativeComponent('TextInput'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
    useWindowDimensions: () => ({ width: 375, height: 800 }),
  };
});

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: (props: Record<string, unknown>) => React.createElement('LinearGradient', props, props.children as React.ReactNode),
}));

vi.mock('react-native-svg', () => {
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    return MockNativeComponent;
  };
  return {
    default: nativeComponent('Svg'),
    Line: nativeComponent('Line'),
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

vi.mock('@/lib/theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/theme')>();
  return {
    ...actual,
    FONT: { regular: 'System', semibold: 'System', bold: 'System', medium: 'System' },
    FS: { xs: 12, sm: 14, base: 16, md: 18 },
    SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
    RADIUS: { xs: 6, sm: 8, md: 14, lg: 16, xl: 24, pill: 999 },
    ICON: { xs: 14, sm: 16, md: 20, lg: 24, xl: 28 },
  };
});

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