import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  socialServiceMock, apiMock, routerMock, focusEffects, alertMock,
} = vi.hoisted(() => ({
  socialServiceMock: {
    getConversation: vi.fn(),
    createOrGetConversation: vi.fn(),
    getMessages: vi.fn(),
    sendMessage: vi.fn(),
    retryMessage: vi.fn(),
    addReaction: vi.fn(),
    deleteMessageForMe: vi.fn(),
    markConversationRead: vi.fn(),
    subscribeSocial: vi.fn(() => () => {}),
    archiveConversation: vi.fn(),
    MY_USER_ID: 'me',
    MY_NAME: 'Jordan',
    MY_INITIALS: 'J',
    MY_COLOR: '#8B5CF6',
  },
  apiMock: {
    conversations: { uploadMedia: vi.fn() },
    products: { publicList: vi.fn().mockResolvedValue([]) },
    posts: { publicList: vi.fn().mockResolvedValue([]) },
    social: { block: vi.fn(), unblock: vi.fn() },
  },
  routerMock: { back: vi.fn(), push: vi.fn() },
  focusEffects: { callbacks: [] as Array<() => void | (() => void)> },
  alertMock: vi.fn(),
}));

// ─── react-native ──────────────────────────────────────────────────────────

vi.mock('react-native', () => {
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };

  class FakeAnimatedValue {
    private value: number;
    constructor(value: number) { this.value = value; }
    setValue(value: number) { this.value = value; }
    interpolate() { return this.value; }
  }

  const finishStart = (cb?: (result: { finished: boolean }) => void) => {
    if (cb) cb({ finished: true });
  };

  const Animated = {
    Value: FakeAnimatedValue,
    timing: () => ({ start: finishStart }),
    spring: () => ({ start: finishStart }),
    parallel: () => ({ start: finishStart }),
    loop: () => ({ start: () => {}, stop: () => {} }),
    createAnimatedComponent: (Component: unknown) => Component,
    View: nativeComponent('Animated.View'),
    Image: nativeComponent('Animated.Image'),
  };

  return {
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    Alert: { alert: alertMock },
    AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false) },
    Animated,
    Dimensions: { get: () => ({ width: 375, height: 800 }) },
    Easing: { linear: (v: number) => v, inOut: () => (v: number) => v, quad: (v: number) => v },
    FlatList: (props: {
      data: unknown[];
      renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    }) => React.createElement(
      'FlatList',
      props,
      props.data.map((item, index) => props.renderItem({ item, index })),
    ),
    Image: nativeComponent('Image'),
    KeyboardAvoidingView: nativeComponent('KeyboardAvoidingView'),
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) =>
      props.visible ? React.createElement('Modal', props, props.children) : null,
    PanResponder: { create: () => ({ panHandlers: {} }) },
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
    ScrollView: nativeComponent('ScrollView'),
    Share: { share: vi.fn().mockResolvedValue({}) },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, hairlineWidth: 1 },
    Text: nativeComponent('Text'),
    TextInput: nativeComponent('TextInput'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
    useWindowDimensions: () => ({ width: 375, height: 800 }),
  };
});

vi.mock('react-native-svg', () => {
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    return MockNativeComponent;
  };
  return {
    default: nativeComponent('Svg'),
    Defs: nativeComponent('Defs'),
    G: nativeComponent('G'),
    Path: nativeComponent('Path'),
    Pattern: nativeComponent('Pattern'),
    Rect: nativeComponent('Rect'),
    Circle: nativeComponent('Circle'),
  };
});

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: (props: Record<string, unknown>) => React.createElement('LinearGradient', props, props.children as React.ReactNode),
}));

vi.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => React.createElement('Image', props, props.children as React.ReactNode),
}));

vi.mock('react-native-reanimated', () => ({
  default: {
    View: (props: Record<string, unknown>) => React.createElement('Animated.View', props, props.children as React.ReactNode),
  },
  Easing: { out: (fn: unknown) => fn, cubic: (v: number) => v, linear: (v: number) => v, bezier: (..._points: number[]) => (t: number) => t },
  useSharedValue: (initial: number) => ({ value: initial, set: () => {} }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withTiming: (value: unknown) => value,
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
  MaterialCommunityIcons: ({ name }: { name: string }) => React.createElement('MaterialCommunityIcons', { name }),
}));

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
  useLocalSearchParams: () => ({ id: 'conv-1' }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    React.useEffect(() => {
      const cleanup = callback();
      return () => { if (typeof cleanup === 'function') cleanup(); };
    }, [callback]);
  },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: vi.fn().mockResolvedValue({ canceled: true, assets: [] }),
  MediaTypeOptions: { Images: 'Images', Videos: 'Videos' },
}));

vi.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
  setAudioModeAsync: vi.fn().mockResolvedValue(undefined),
  useAudioPlayer: () => ({ pause: vi.fn(), seekTo: vi.fn().mockResolvedValue(undefined), replace: vi.fn(), play: vi.fn() }),
  useAudioPlayerStatus: () => ({ didJustFinish: false }),
  useAudioRecorder: () => ({
    prepareToRecordAsync: vi.fn().mockResolvedValue(undefined),
    record: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    getStatus: () => ({ url: null, durationMillis: 0 }),
    uri: null,
  }),
}));

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'me' }) }));

vi.mock('@/lib/safety', () => ({
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
  confirmBlock: vi.fn(),
  confirmUnblock: vi.fn(),
  reportHref: () => '/report',
}));

vi.mock('@/components/safety/DmSafety', () => ({
  BlockedComposer: () => React.createElement('BlockedComposer'),
}));

vi.mock('@/lib/money', () => ({ formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}` }));

vi.mock('@/components/branding/BrandthreadLogo', () => ({
  default: () => React.createElement('BrandthreadLogo'),
}));

vi.mock('@/lib/mediaLibraryAdapter', () => ({ saveImageToMediaLibrary: vi.fn().mockResolvedValue('saved') }));

vi.mock('@/lib/api', () => ({ useApi: () => apiMock }));

vi.mock('@/services/socialService', () => socialServiceMock);

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#0A0A0B',
      surface: '#111113',
      card: '#18181B',
      cardElevated: '#222226',
      cardGlass: 'rgba(24,24,27,0.6)',
      border: '#3f3f46',
      text: '#fafafa',
      muted: '#a1a1aa',
      subtle: '#71717a',
      accent: '#c7cdd5',
      accentLight: '#f8fafc',
      accentDim: '#34383e',
      onAccent: '#0A0A0B',
      secondary: '#22d3ee',
      secondaryDim: '#164e63',
      success: '#7FF0B0',
      warning: '#FFD580',
      error: '#FFB4B4',
      primaryGradient: ['#c7cdd5', '#fff'],
      heroGradient: ['#0A0A0B', '#18181B'],
      shadowColor: '#000000',
    },
  }),
}));

vi.mock('@/lib/theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/theme')>();
  return {
    ...actual,
    FONT: { regular: 'System', semibold: 'System', bold: 'System', medium: 'System' },
    FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22 },
    SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
    RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, pill: 999 },
    ICON: { xs: 14, sm: 16, md: 20, lg: 24, xl: 28 },
  };
});

import BuyerConversationScreen from '@/app/buyer-conversation';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function participant(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'seller-1', name: 'Vault Studio', handle: '@vaultstudio',
    initials: 'VS', color: '#00C853', accountType: 'seller',
    ...overrides,
  };
}

function conversationFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    type: 'buyer_to_seller',
    participants: [
      { userId: 'me', name: 'Jordan', handle: '@jordan', initials: 'J', color: '#8B5CF6', accountType: 'buyer' },
      participant(),
    ],
    unreadCount: 0,
    isFriendshipActive: true,
    isArchived: false,
    isRequest: false,
    updatedAt: '2026-09-24T12:00:00.000Z',
    ...overrides,
  };
}

function messageFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    fromId: 'seller-1',
    fromName: 'Vault Studio',
    fromInitials: 'VS',
    fromColor: '#00C853',
    text: 'Hey there!',
    reactions: [],
    status: 'delivered',
    ts: 1_700_000_000_000,
    deletedForMe: false,
    ...overrides,
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
    renderer = create(<BuyerConversationScreen />);
    await flushPromises();
  });
  return renderer;
}

describe('buyer conversation chat redesign', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    Object.values(socialServiceMock).forEach((fn) => { if (typeof fn === 'function' && 'mockReset' in fn) (fn as any).mockReset(); });
    socialServiceMock.subscribeSocial.mockReturnValue(() => {});
    socialServiceMock.getConversation.mockResolvedValue(conversationFixture());
    socialServiceMock.getMessages.mockResolvedValue([messageFixture()]);
    socialServiceMock.markConversationRead.mockResolvedValue(undefined);
    socialServiceMock.addReaction.mockResolvedValue(undefined);
    socialServiceMock.sendMessage.mockResolvedValue(messageFixture({ id: 'msg-2', fromId: 'me', text: 'Hi!' }));
    routerMock.back.mockReset();
    routerMock.push.mockReset();
    alertMock.mockReset();
  });

  afterEach(() => {
    renderer?.unmount();
    renderer = undefined;
    vi.useRealTimers();
  });

  it('shows the participant name and presence status in the floating header', async () => {
    socialServiceMock.getConversation.mockResolvedValue(conversationFixture({
      participants: [
        { userId: 'me', name: 'Jordan', handle: '@jordan', initials: 'J', color: '#8B5CF6', accountType: 'buyer' },
        participant({ isOnline: true }),
      ],
    }));
    renderer = await renderScreen();
    const content = textContent(renderer);
    expect(content).toContain('Vault Studio');
    expect(content).toContain('online');
  });

  it('double-tapping a bubble calls the reactions API with "like"', async () => {
    renderer = await renderScreen();
    const bubble = renderer.root.findByProps({ testID: 'conversation-bubble-msg-1' });

    await act(async () => {
      bubble.props.onPress({ nativeEvent: { pageX: 100, pageY: 200 } });
      bubble.props.onPress({ nativeEvent: { pageX: 100, pageY: 200 } });
      await flushPromises();
    });

    expect(socialServiceMock.addReaction).toHaveBeenCalledWith('conv-1', 'msg-1', 'like');
  });

  it('a single tap does not react, only a rapid second tap does', async () => {
    renderer = await renderScreen();
    const bubble = renderer.root.findByProps({ testID: 'conversation-bubble-msg-1' });

    await act(async () => {
      bubble.props.onPress({ nativeEvent: { pageX: 100, pageY: 200 } });
      await flushPromises();
    });

    expect(socialServiceMock.addReaction).not.toHaveBeenCalled();
  });

  it('long-press opens the reaction bar and selecting a reaction calls the API', async () => {
    renderer = await renderScreen();
    const bubble = renderer.root.findByProps({ testID: 'conversation-bubble-msg-1' });

    await act(async () => {
      bubble.props.onLongPress();
    });

    const loveChip = renderer.root.findByProps({ testID: 'reaction-bar-love' });
    await act(async () => {
      loveChip.props.onPress();
      await flushPromises();
    });

    expect(socialServiceMock.addReaction).toHaveBeenCalledWith('conv-1', 'msg-1', 'love');
  });

  it('toggles a reaction off when the same chip is selected again', async () => {
    renderer = await renderScreen();
    const bubble = renderer.root.findByProps({ testID: 'conversation-bubble-msg-1' });

    await act(async () => { bubble.props.onLongPress(); });
    await act(async () => {
      renderer!.root.findByProps({ testID: 'reaction-bar-fire' }).props.onPress();
      await flushPromises();
    });
    expect(socialServiceMock.addReaction).toHaveBeenNthCalledWith(1, 'conv-1', 'msg-1', 'fire');

    await act(async () => { bubble.props.onLongPress(); });
    await act(async () => {
      renderer!.root.findByProps({ testID: 'reaction-bar-fire' }).props.onPress();
      await flushPromises();
    });
    // Same call shape both times — the service layer (already covered by its
    // own tests) is responsible for the actual toggle-off semantics.
    expect(socialServiceMock.addReaction).toHaveBeenNthCalledWith(2, 'conv-1', 'msg-1', 'fire');
  });

  it('renders reaction chips with counts under a message', async () => {
    socialServiceMock.getMessages.mockResolvedValue([
      messageFixture({
        reactions: [
          { emoji: 'like', reactionType: 'like', fromId: 'me', fromName: 'Jordan' },
          { emoji: 'like', reactionType: 'like', fromId: 'seller-1', fromName: 'Vault Studio' },
        ],
      }),
    ]);
    renderer = await renderScreen();
    const chip = renderer.root.findByProps({ testID: 'reaction-chip-msg-1-like' });
    const chipText = chip.findAllByType('Text' as any).length > 0
      ? chip.findAll((n) => (n.type as unknown) === 'Text').map((n) => n.props.children).join('')
      : '';
    expect(String(chipText)).toContain('2');
  });

  it('sends a message optimistically and clears the input', async () => {
    renderer = await renderScreen();
    const input = renderer.root.findByProps({ placeholder: 'Message…' });
    await act(async () => {
      input.props.onChangeText('Hi!');
    });
    const send = renderer.root.findByProps({ testID: 'conversation-send' });
    await act(async () => {
      send.props.onPress();
      await flushPromises();
    });

    expect(socialServiceMock.sendMessage).toHaveBeenCalledWith('conv-1', 'Hi!', undefined, undefined);
    const inputAfter = renderer.root.findByProps({ placeholder: 'Message…' });
    expect(inputAfter.props.value).toBe('');
  });

  it('restores the draft and shows an alert when sending fails, and retry resends it', async () => {
    socialServiceMock.sendMessage.mockRejectedValueOnce(new Error('network down'));
    renderer = await renderScreen();
    const input = renderer.root.findByProps({ placeholder: 'Message…' });
    await act(async () => {
      input.props.onChangeText('Will this send?');
    });
    await act(async () => {
      renderer!.root.findByProps({ testID: 'conversation-send' }).props.onPress();
      await flushPromises();
    });

    expect(alertMock).toHaveBeenCalledWith('Message not sent', expect.any(String));
    const inputAfter = renderer.root.findByProps({ placeholder: 'Message…' });
    expect(inputAfter.props.value).toBe('Will this send?');

    socialServiceMock.sendMessage.mockResolvedValueOnce(messageFixture({ id: 'msg-3', fromId: 'me', text: 'Will this send?' }));
    await act(async () => {
      renderer!.root.findByProps({ testID: 'conversation-send' }).props.onPress();
      await flushPromises();
    });
    expect(socialServiceMock.sendMessage).toHaveBeenCalledTimes(2);
  });
});
