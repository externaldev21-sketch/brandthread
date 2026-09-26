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
  Image: nativeComponent('Image'),
  Modal: nativeComponent('Modal'),
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios },
  RefreshControl: nativeComponent('RefreshControl'),
  ScrollView: nativeComponent('ScrollView'),
  StyleSheet: { create: (styles: unknown) => styles, flatten: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {} },
  Switch: nativeComponent('Switch'),
  Text: nativeComponent('Text'),
  TextInput: nativeComponent('TextInput'),
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  View: nativeComponent('View'),
  Pressable: (props: Record<string, unknown> & { children?: unknown }) => {
    const { children, ...rest } = props;
    return React.createElement(
      'Pressable',
      rest,
      typeof children === 'function' ? (children as (state: { pressed: boolean }) => React.ReactNode)({ pressed: false }) : (children as React.ReactNode),
    );
  },
  Animated: {
    Value: class { _value: number; constructor(v?: number) { this._value = v ?? 0; } setValue(v: number) { this._value = v; } },
    View: nativeComponent('Animated.View'),
    timing: () => ({ start: (cb?: () => void) => cb?.() }),
    spring: () => ({ start: (cb?: () => void) => cb?.() }),
    parallel: () => ({ start: (cb?: () => void) => cb?.() }),
  },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  SectionList: (props: { sections: Array<{ title: string; data: unknown[] }>; renderItem: (info: { item: unknown }) => React.ReactNode; renderSectionHeader?: (info: { section: { title: string } }) => React.ReactNode; keyExtractor?: (item: unknown, index: number) => string }) =>
    React.createElement(
      'SectionList',
      props,
      props.sections.map((section, sIndex) =>
        React.createElement(
          React.Fragment,
          { key: `section-${sIndex}` },
          props.renderSectionHeader ? props.renderSectionHeader({ section }) : null,
          section.data.map((item, index) =>
            React.createElement(
              React.Fragment,
              { key: props.keyExtractor ? props.keyExtractor(item, index) : String(index) },
              props.renderItem({ item }),
            ),
          ),
        ),
      ),
    ),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(() => Promise.resolve()),
  selectionAsync: vi.fn(() => Promise.resolve()),
  notificationAsync: vi.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: (props: Record<string, unknown>) => React.createElement('LinearGradient', props, props.children as React.ReactNode),
}));

vi.mock('react-native-svg', () => ({
  default: nativeComponent('Svg'),
  Line: nativeComponent('Line'),
}));

vi.mock('react-native-reanimated', () => ({
  default: {
    View: (props: Record<string, unknown>) => React.createElement('Animated.View', props, props.children as React.ReactNode),
  },
  Easing: { out: (fn: unknown) => fn, cubic: (v: number) => v, linear: (v: number) => v },
  useSharedValue: (initial: number) => ({ value: initial, set: () => {} }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withTiming: (value: unknown) => value,
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

vi.mock('@/components/BrandthreadUI', () => ({
  SearchBar: ({ value, onChange, placeholder, style }: any) =>
    React.createElement('TextInput', {
      testID: 'inbox-compose-search-input', value, onChangeText: onChange, placeholder, style,
    }),
  SheetHandle: () => React.createElement('View', { testID: 'inbox-compose-sheet-handle' }),
  PressableScale: ({ children, ...rest }: any) =>
    React.createElement('Pressable', rest, typeof children === 'function' ? children({ pressed: false }) : children),
  AnimatedEntrance: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, {}, children),
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
  PrimaryButton: ({ label, onPress, disabled, loading, testID }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; testID?: string }) =>
    React.createElement(
      'TouchableOpacity',
      { testID: testID ?? `primary-button-${label}`, onPress, disabled: !!disabled || !!loading },
      React.createElement('Text', {}, label),
    ),
}));

vi.mock('@/components/layout', () => ({
  ListSkeleton: () => React.createElement('View', { testID: 'inbox-skeleton' }),
}));

vi.mock('@/components/layout/TabPageHeader', () => ({
  TabPageHeader: ({ title, actions }: { title: string; actions?: Array<{ accessibilityLabel: string; onPress: () => void; testID?: string }> }) =>
    React.createElement(
      'View',
      { testID: 'tab-page-header' },
      React.createElement('Text', {}, title),
      ...(actions ?? []).map((action) =>
        React.createElement('TouchableOpacity', {
          key: action.accessibilityLabel,
          testID: action.testID,
          accessibilityLabel: action.accessibilityLabel,
          onPress: action.onPress,
        }),
      ),
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

// Stable reference: inbox.tsx's compose-directory effect depends on `api`,
// so a fresh object per render (a naive `useApi: () => ({...})` factory)
// would retrigger that effect every render and spin forever under act().
const apiStub = vi.hoisted(() => ({
  conversations: { accept: vi.fn(), decline: vi.fn() },
  social: {
    following: vi.fn().mockResolvedValue([]),
    followers: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('@/lib/api', () => ({
  useApi: () => apiStub,
}));

// previewInbox.ts (like previewCatalog.ts) imports expo-asset and requires
// bundled image assets at module scope, neither of which Vitest can
// transform — mocked out here the same way native modules above are, since
// __DEV__ is false in this test environment anyway (these are all no-ops).
vi.mock('@/lib/previewInbox', () => ({
  isPreviewInboxEnabled: () => false,
  getPreviewConversations: () => [],
  getPreviewNotifications: () => [],
  getPreviewMessages: () => [],
  isPreviewConversationId: () => false,
  subscribePreviewTyping: () => () => {},
}));

vi.mock('@/components/branding/BrandthreadLogo', () => ({
  default: () => React.createElement('BrandthreadLogo'),
}));

vi.mock('@/lib/theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/theme')>();
  return {
    ...actual,
    FONT: { regular: 'Test-Regular', medium: 'Test-Medium', semibold: 'Test-Semibold', bold: 'Test-Bold' },
    FS: { xs: 11, sm: 13, base: 15, md: 17 },
    SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
    RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, pill: 999 },
    ICON: { xs: 14, sm: 16, md: 20, lg: 24, xl: 28 },
  };
});

vi.mock('@/services/socialService', () => ({
  getConversations: getConversationsMock,
  getNotifications: getNotificationsMock,
  markConversationRead: markConversationReadMock,
  archiveConversation: archiveConversationMock,
  subscribeSocial: subscribeSocialMock,
  markNotificationRead: vi.fn(),
  searchProfiles: vi.fn().mockResolvedValue([]),
  createOrGetConversation: vi.fn(),
  getFriendSuggestions: vi.fn().mockResolvedValue([]),
  muteUser: muteUserMock,
  MY_USER_ID: 'me',
}));

// "Suggested" section data (Inbox pill) — a separate service module from the
// conversations/notifications one above; stubbed empty by default so it
// doesn't add noise to assertions that aren't about it.
vi.mock('@/services/activityService', () => ({
  getSuggestedPeople: vi.fn().mockResolvedValue([]),
  dismissSuggestedPerson: vi.fn().mockResolvedValue(undefined),
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

    // The redesigned inbox also shows each participant's name (as plain
    // text) in the Notes-style active-people rail above the list, so scope
    // the search to the actual conversation row rather than matching the
    // first "Alice Unread" text node found anywhere on screen.
    const unreadRow = renderer.root.findByProps({ testID: 'inbox-conversation-unread-thread' });
    const readRow = renderer.root.findByProps({ testID: 'inbox-conversation-read-thread' });
    const unreadName = unreadRow.findAllByType('Text' as never).find((n) => n.props.children === 'Alice Unread');
    const readName = readRow.findAllByType('Text' as never).find((n) => n.props.children === 'Bob Read');
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
    expect(textContent(renderer!)).toContain('Keep it real in DMs');
    const cta = renderer!.root.findByProps({ testID: 'primary-button-Send a message' });
    expect(cta).toBeTruthy();

    await act(async () => {
      cta.props.onPress();
      await flushPromises();
    });
    expect(renderer!.root.findAllByProps({ placeholder: 'Search people' }).length).toBeGreaterThan(0);
  });
});
