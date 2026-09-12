import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  storage,
  applyFromLogoMock,
  applyFromMoodboardMock,
  getStoreApplyFailureMock,
  routerPushMock,
  useUserMock,
} = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  applyFromLogoMock: vi.fn(),
  applyFromMoodboardMock: vi.fn(),
  getStoreApplyFailureMock: vi.fn((failure: unknown) => failure),
  routerPushMock: vi.fn(),
  useUserMock: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
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
  const Image = nativeComponent('Image') as any;
  Image.getSize = vi.fn((_uri: string, success: (width: number, height: number) => void) => {
    success(1200, 800);
  });

  return {
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    Alert: { alert: vi.fn() },
    Image,
    ScrollView: nativeComponent('ScrollView'),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
  };
});

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(async () => ({ base64: 'prepared-image' })),
  SaveFormat: { JPEG: 'jpeg' },
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(),
  MediaTypeOptions: { Images: 'Images' },
  requestMediaLibraryPermissionsAsync: vi.fn(),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('@clerk/expo', () => ({
  useUser: useUserMock,
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ back: vi.fn(), push: routerPushMock }),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#c7cdd5',
      accentDim: '#34383e',
      accentLight: '#f8fafc',
      secondaryDim: '#172554',
    },
  }),
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    primary: '#c7cdd5',
    accent: '#727a84',
    accentForeground: '#ffffff',
    info: '#22d3ee',
  }),
}));

vi.mock('@/hooks/useHeaderTopInset', () => ({
  useHeaderTopInset: () => 0,
}));

vi.mock('@/lib/theme', () => ({
  BG: '#09090b',
  SCREEN_BG: 'transparent',
  CARD: '#18181b',
  CARD_GLASS: 'rgba(18, 18, 31, 0.45)',
  CARD_ELEVATED_GLASS: 'rgba(24, 24, 46, 0.65)',
  SURFACE_GLASS: 'rgba(12, 12, 23, 0.65)',
  SKELETON_GLASS: 'rgba(255,255,255,0.05)',
  SURFACE: '#27272a',
  BORDER: '#3f3f46',
  FG: '#fafafa',
  MUTED: '#a1a1aa',
  SUBTLE: '#71717a',
  PURPLE: '#c7cdd5',
  PURPLE_LIGHT: '#f8fafc',
  PURPLE_DIM: '#34383e',
  CYAN: '#22d3ee',
  CYAN_DIM: '#164e63',
  SUCCESS: '#22c55e',
  FONT: { regular: 'System', semibold: 'System', bold: 'System' },
  FS: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 32 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  RADIUS: { sm: 8, md: 12, lg: 16, pill: 999 },
  ICON: { sm: 16, md: 20, lg: 24, xl: 32, xxl: 40 },
}));

vi.mock('@/components/BrandthreadUI', () => {
  const React = require('react') as typeof import('react');
  const native = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);

  return {
    BrandthreadCard: native('BrandthreadCard'),
    PrimaryButton: native('PrimaryButton'),
    SecondaryButton: native('SecondaryButton'),
    StatusBadge: native('StatusBadge'),
  };
});

vi.mock('@/services/storeService', () => ({
  applyFromLogo: applyFromLogoMock,
  applyFromMoodboard: applyFromMoodboardMock,
  generateFromLogo: vi.fn(),
  generateFromMoodBoard: vi.fn(),
  getStoreApplyFailure: getStoreApplyFailureMock,
}));

import StoreFromLogoScreen from '@/app/store-from-logo';
import StoreFromMoodboardScreen from '@/app/store-from-moodboard';

const LOGO_CACHE_KEY = 'bt:store:logo-analysis:transient:v1:seller-1';
const MOODBOARD_CACHE_KEY = 'bt:store:moodboard-analysis:transient:v1:seller-1';

const logoAnalysis = {
  dominantColors: ['#111111', '#222222', '#333333'],
  suggestedPalette: {
    primary: '#111111',
    secondary: '#222222',
    accent: '#333333',
    background: '#ffffff',
    text: '#111111',
  },
  suggestedThemeId: 'editorial',
  suggestedTypography: 'modern',
  brandMoods: ['minimal'],
  aiSections: [],
  source: 'ai' as const,
};

const moodboardAnalysis = {
  colorPalette: {
    primary: '#111111',
    secondary: '#222222',
    accent: '#333333',
    background: '#ffffff',
    text: '#111111',
  },
  typographyDirection: 'Modern sans',
  layoutStyle: 'Editorial',
  imageTreatment: 'Bright',
  suggestedThemeId: 'editorial',
  suggestedSections: ['hero'] as const,
  aiSections: [],
  source: 'ai' as const,
};

async function flushRestoration() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function textValues(renderer: ReactTestRenderer): unknown[] {
  return renderer.root
    .findAll((node: any) => node.type === 'Text')
    .map(node => node.props.children);
}

describe('Apply to Store failure recovery', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    storage.clear();
    applyFromLogoMock.mockReset();
    applyFromMoodboardMock.mockReset();
    getStoreApplyFailureMock.mockClear();
    routerPushMock.mockReset();
    useUserMock.mockReturnValue({ user: { id: 'seller-1' }, isLoaded: true });
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = undefined;
    }
  });

  it('keeps the generated logo result visible and offers retry after a failed apply', async () => {
    storage.set(LOGO_CACHE_KEY, JSON.stringify({ logoUri: 'file:///logo.png', result: logoAnalysis }));
    const failure = {
      kind: 'network',
      message: 'We could not reach Brandthread. Check your connection, then try again.',
    };
    applyFromLogoMock.mockRejectedValueOnce(failure);
    getStoreApplyFailureMock.mockReturnValue(failure);

    await act(async () => {
      renderer = create(<StoreFromLogoScreen />);
      await flushRestoration();
    });

    expect(renderer!.root.findByProps({ label: 'modern' })).toBeTruthy();

    await act(async () => {
      renderer!.root.findByProps({ label: 'Apply to Store' }).props.onPress();
      await Promise.resolve();
    });

    expect(textValues(renderer!)).toContain('Connection problem');
    expect(renderer!.root.findByProps({ label: 'modern' })).toBeTruthy();
    expect(renderer!.root.findByProps({
      accessibilityLabel: 'Retry applying this store design',
    })).toBeTruthy();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it('keeps the generated mood board result visible and offers retry after a failed apply', async () => {
    storage.set(MOODBOARD_CACHE_KEY, JSON.stringify({
      imageUris: ['file:///mood-1.png', 'file:///mood-2.png'],
      result: moodboardAnalysis,
    }));
    const failure = {
      kind: 'server',
      message: 'Our store service could not save this design. Please try again in a moment.',
    };
    applyFromMoodboardMock.mockRejectedValueOnce(failure);
    getStoreApplyFailureMock.mockReturnValue(failure);

    await act(async () => {
      renderer = create(<StoreFromMoodboardScreen />);
      await flushRestoration();
    });

    expect(textValues(renderer!)).toContain('Editorial');

    await act(async () => {
      renderer!.root.findByProps({ label: 'Apply These Settings' }).props.onPress();
      await Promise.resolve();
    });

    expect(textValues(renderer!)).toContain('Store service problem');
    expect(textValues(renderer!)).toContain('Editorial');
    expect(renderer!.root.findByProps({
      accessibilityLabel: 'Retry applying these store settings',
    })).toBeTruthy();
    expect(routerPushMock).not.toHaveBeenCalled();
  });
});