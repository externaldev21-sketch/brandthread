import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock, focusState, routerMock, previewMock } = vi.hoisted(() => ({
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
  previewMock: {
    isPreviewInboxEnabled: vi.fn(() => false),
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
    Alert: { alert: vi.fn() },
    PanResponder: { create: (config: Record<string, unknown>) => ({ panHandlers: config }) },
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
  // seller-inbox.tsx reads useAuth().userId (not useUser()'s isLoaded) —
  // see its own comment for why: useUser()'s isLoaded can lag well behind
  // userId itself, which left the seller inbox stuck on its web-preview
  // loading skeleton forever whenever that happened.
  useAuth: () => ({ userId: 'seller-user' }),
}));

// previewInbox.ts imports expo-asset and requires bundled image assets at
// module scope, neither of which Vitest can transform — mocked out here the
// same way tests/buyer-inbox.test.tsx does for the buyer inbox. This test
// always has a real Clerk user (see the @clerk/expo mock above), so
// getSellerPreviewConversations() is never actually reached — item 71.
vi.mock('@/lib/previewInbox', () => ({
  isPreviewInboxEnabled: previewMock.isPreviewInboxEnabled,
  getSellerPreviewConversations: () => [
    conversation('preview-seller-conversation-01', 1),
  ],
  isSellerPreviewConversationId: (id: string | null | undefined) =>
    !!id && id.startsWith('preview-seller-conversation-'),
  setPreviewConversationPinned: vi.fn(),
}));

vi.mock('@/services/socialService', () => ({
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  archiveConversation: vi.fn().mockResolvedValue(undefined),
  muteUser: vi.fn().mockResolvedValue(undefined),
  setConversationPinned: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/components/ui/ActionSheet', () => ({
  showActionSheet: vi.fn(),
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
    FONT: { regular: 'Test-Regular', semibold: 'Test-Semibold', bold: 'Test-Bold', medium: 'Test-Medium' },
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

function fontFamilyOf(node: ReturnType<ReactTestRenderer['root']['findAllByType']>[number]): string[] {
  const style = node.props.style;
  const flat = Array.isArray(style) ? style : [style];
  return flat.filter(Boolean).map((entry: Record<string, unknown>) => entry.fontFamily).filter(Boolean) as string[];
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
    previewMock.isPreviewInboxEnabled.mockReset();
    previewMock.isPreviewInboxEnabled.mockReturnValue(false);
    focusState.callback = undefined;
    focusState.cleanup = undefined;
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
  });

  it('clears the opened row badge immediately', async () => {
    apiMock.conversations.list.mockResolvedValue([
      conversation('unread-thread', 2),
      conversation('another-thread', 1),
    ]);
    renderer = await renderScreen();

    expect(renderer.root.findAllByProps({ testID: 'seller-unread-badge-unread-thread' }, { deep: false }))
      .toHaveLength(1);
    expect(renderer.root.findAllByProps({ testID: 'seller-unread-badge-another-thread' }, { deep: false }))
      .toHaveLength(1);

    const row = renderer.root.findByProps({ testID: 'seller-conversation-unread-thread' });
    await act(async () => {
      row.props.onPress();
      await flushPromises();
    });

    expect(renderer.root.findAllByProps({ testID: 'seller-unread-badge-unread-thread' }, { deep: false }))
      .toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'seller-unread-badge-another-thread' }, { deep: false }))
      .toHaveLength(1);
    expect(routerMock.push).toHaveBeenCalledWith('/seller-conversation?id=unread-thread');
  });

  it('renders unread rows bold with a dot and read rows regular with no dot (matches buyer inbox)', async () => {
    apiMock.conversations.list.mockResolvedValue([
      conversation('unread-thread', 2),
      conversation('read-thread', 0),
    ]);
    renderer = await renderScreen();

    const unreadRow = renderer.root.findByProps({ testID: 'seller-conversation-unread-thread' });
    const readRow = renderer.root.findByProps({ testID: 'seller-conversation-read-thread' });

    const unreadName = unreadRow.findAllByType('Text' as never).find((n) => n.props.children === 'Buyer');
    const readName = readRow.findAllByType('Text' as never).find((n) => n.props.children === 'Buyer');
    expect(unreadName).toBeTruthy();
    expect(readName).toBeTruthy();
    expect(fontFamilyOf(unreadName!)).toContain('Test-Bold');
    expect(fontFamilyOf(readName!)).toContain('Test-Regular');

    const unreadPreview = unreadRow.findAllByType('Text' as never).find((n) => n.props.children === 'Can you help with sizing?');
    const readPreview = readRow.findAllByType('Text' as never).find((n) => n.props.children === 'Can you help with sizing?');
    expect(fontFamilyOf(unreadPreview!)).toContain('Test-Bold');
    expect(fontFamilyOf(readPreview!)).not.toContain('Test-Bold');

    expect(renderer.root.findAllByProps({ testID: 'seller-unread-badge-unread-thread' }, { deep: false })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ testID: 'seller-unread-badge-read-thread' }, { deep: false })).toHaveLength(0);
  });

  it('does not restore a stale badge when a later inbox load is delayed or fails', async () => {
    apiMock.conversations.list.mockResolvedValueOnce([
      conversation('unread-thread', 2),
      conversation('another-thread', 1),
    ]);
    renderer = await renderScreen();

    const noStaleBadge = () =>
      expect(renderer!.root.findAllByProps({ testID: 'seller-unread-badge-unread-thread' }, { deep: false }))
        .toHaveLength(0);

    await act(async () => {
      renderer!.root.findByProps({ testID: 'seller-conversation-unread-thread' }).props.onPress();
      await flushPromises();
    });
    noStaleBadge();

    let resolveDelayed!: (value: Conversation[]) => void;
    const delayed = new Promise<Conversation[]>((resolve) => {
      resolveDelayed = resolve;
    });
    apiMock.conversations.list.mockReturnValueOnce(delayed);
    await refocusScreen();
    noStaleBadge();

    resolveDelayed([
      conversation('unread-thread', 2),
      conversation('another-thread', 1),
    ]);
    await act(async () => {
      await flushPromises();
    });
    noStaleBadge();

    apiMock.conversations.list.mockRejectedValueOnce(new Error('offline'));
    await refocusScreen();
    noStaleBadge();
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
    expect(renderer.root.findAllByProps({ testID: 'seller-unread-badge-unread-thread' }, { deep: false }))
      .toHaveLength(0);

    apiMock.conversations.list.mockResolvedValue([
      conversation('unread-thread', 2),
      conversation('another-thread', 1),
    ]);
    await act(async () => {
      notifyConversationReadFailure('unread-thread');
      await flushPromises();
    });
    await refocusScreen();

    expect(renderer.root.findAllByProps({ testID: 'seller-unread-badge-unread-thread' }, { deep: false }).length)
      .toBeGreaterThan(0);
  });

  // Regression test for the QA-pass fix: the web preview (?bt_preview=seller)
  // doesn't require Clerk to be signed out — a real Clerk userId can still be
  // present while the preview's backend is unreachable/401s. Before this fix,
  // that combination (myId truthy + API failure) left the seller inbox stuck
  // showing nothing but its own error state forever, unlike the buyer inbox's
  // identical scenario, which has always fallen back to the seeded preview
  // conversations. See app/seller-inbox.tsx's `load()` catch block.
  it('falls back to seeded preview conversations when the API fails and the web preview is active', async () => {
    previewMock.isPreviewInboxEnabled.mockReturnValue(true);
    apiMock.conversations.list.mockRejectedValue(new Error('401 Unauthorized'));
    renderer = await renderScreen();

    expect(textContent(renderer)).toContain('Can you help with sizing?');
    expect(renderer.root.findAllByProps({ testID: 'seller-conversation-preview-seller-conversation-01' }).length)
      .toBeGreaterThan(0);
  });

  it('shows the real error state (not seeded data) when the API fails outside preview', async () => {
    previewMock.isPreviewInboxEnabled.mockReturnValue(false);
    apiMock.conversations.list.mockRejectedValue(new Error('offline'));
    renderer = await renderScreen();

    expect(textContent(renderer)).not.toContain('Can you help with sizing?');
  });
});