import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  storage,
  storageMock,
  imageGetSizeMock,
  manipulateAsyncMock,
  requestPermissionMock,
  launchImageLibraryMock,
  generateFromLogoMock,
  generateFromMoodBoardMock,
  applyFromLogoMock,
  applyFromMoodboardMock,
  routerMock,
} = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const storageMock = {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  };

  return {
    storage,
    storageMock,
    imageGetSizeMock: vi.fn(),
    manipulateAsyncMock: vi.fn(),
    requestPermissionMock: vi.fn(),
    launchImageLibraryMock: vi.fn(),
    generateFromLogoMock: vi.fn(),
    generateFromMoodBoardMock: vi.fn(),
    applyFromLogoMock: vi.fn(),
    applyFromMoodboardMock: vi.fn(),
    routerMock: { back: vi.fn(), push: vi.fn() },
  };
});

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
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    Alert: { alert: vi.fn() },
    Image: Object.assign(nativeComponent('Image'), { getSize: imageGetSizeMock }),
    ScrollView: nativeComponent('ScrollView'),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
  };
});

vi.mock('@clerk/expo', () => ({
  useUser: () => ({ user: { id: 'seller-219' }, isLoaded: true }),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  requestMediaLibraryPermissionsAsync: requestPermissionMock,
  launchImageLibraryAsync: launchImageLibraryMock,
}));

vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: manipulateAsyncMock,
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: storageMock,
}));

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
}));

vi.mock('@/hooks/useHeaderTopInset', () => ({
  useHeaderTopInset: () => 0,
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    primary: '#8B5CF6',
    accent: '#8B5CF6',
    accentForeground: '#FFFFFF',
    info: '#38BDF8',
  }),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#8B5CF6',
      accentDim: '#2E1B55',
      accentLight: '#C4B5FD',
      primaryGradient: ['#8B5CF6', '#6366F1'],
      onAccent: '#FFFFFF',
    },
  }),
}));

vi.mock('@/lib/theme', () => ({
  BG: '#09090B',
  CARD: '#18181B',
  SURFACE: '#27272A',
  BORDER: '#3F3F46',
  FG: '#FAFAFA',
  MUTED: '#A1A1AA',
  SUBTLE: '#71717A',
  PURPLE: '#8B5CF6',
  PURPLE_LIGHT: '#C4B5FD',
  PURPLE_DIM: '#2E1B55',
  CYAN: '#38BDF8',
  SUCCESS: '#22C55E',
  FONT: { regular: 'Inter', medium: 'Inter', semibold: 'Inter', bold: 'Inter' },
  FS: { xs: 12, sm: 14, base: 16, xl: 22 },
  SP: { xs: 4, sm: 8, md: 16 },
  RADIUS: { xs: 4, sm: 8, md: 12, lg: 16 },
  ICON: { sm: 14, md: 18, xxl: 32 },
}));

vi.mock('@/components/BrandthreadUI', () => {
  const React = require('react') as typeof import('react');
  const native = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);

  return {
    BrandthreadCard: native('BrandthreadCard'),
    PrimaryButton: native('PrimaryButton'),
    SecondaryButton: native('SecondaryButton'),
    StatusBadge: ({ label }: { label: string }) => React.createElement('Text', null, label),
  };
});

vi.mock('@/services/storeService', () => ({
  generateFromLogo: generateFromLogoMock,
  generateFromMoodBoard: generateFromMoodBoardMock,
  applyFromLogo: applyFromLogoMock,
  applyFromMoodboard: applyFromMoodboardMock,
  getStoreApplyFailure: vi.fn(() => ({
    kind: 'unknown',
    message: 'Could not apply this design.',
  })),
}));

import StoreFromLogoScreen from './store-from-logo';
import StoreFromMoodboardScreen from './store-from-moodboard';

const LOGO_CACHE_KEY = 'bt:store:logo-analysis:transient:v1:seller-219';
const MOODBOARD_CACHE_KEY = 'bt:store:moodboard-analysis:transient:v1:seller-219';

const logoResult = {
  dominantColors: ['#111111', '#EEEEEE'],
  suggestedPalette: {
    primary: '#111111',
    secondary: '#222222',
    accent: '#8B5CF6',
    background: '#FFFFFF',
    text: '#111111',
    buttonText: '#FFFFFF',
  },
  suggestedThemeId: 'thread',
  suggestedTypography: 'editorial',
  brandMoods: ['editorial'],
  aiSections: [],
  source: 'ai',
};

const moodboardResult = {
  colorPalette: {
    primary: '#111111',
    secondary: '#222222',
    accent: '#8B5CF6',
    background: '#FFFFFF',
    text: '#111111',
    buttonText: '#FFFFFF',
  },
  typographyDirection: 'Editorial serif',
  layoutStyle: 'Editorial',
  imageTreatment: 'High contrast',
  suggestedThemeId: 'thread',
  suggestedSections: ['hero_image'],
  aiSections: [],
  source: 'ai',
};

function imageUris(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll(node => String(node.type) === 'Image')
    .map(node => (node.props.source as { uri: string }).uri);
}

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (!value || typeof value !== 'object') return '';

  const node = value as {
    children?: unknown;
    props?: { children?: unknown };
  };
  return textContent(node.props?.children ?? node.children);
}

function screenText(renderer: ReactTestRenderer): string {
  return textContent(renderer.toJSON());
}

async function flushPromises() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

async function renderScreen(Screen: React.ComponentType): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Screen />);
    await flushPromises();
  });
  return renderer;
}

function seedLogoCache(logoUri = 'file:///logo-original.png') {
  storage.set(LOGO_CACHE_KEY, JSON.stringify({ logoUri, result: logoResult }));
}

function seedMoodboardCache(imageUrisToCache = ['file:///mood-1.png', 'file:///mood-2.png']) {
  storage.set(MOODBOARD_CACHE_KEY, JSON.stringify({
    imageUris: imageUrisToCache,
    result: moodboardResult,
  }));
}

describe('Store Builder logo and mood board analysis recovery', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    storage.clear();
    renderer = undefined;
    routerMock.back.mockReset();
    routerMock.push.mockReset();

    imageGetSizeMock.mockReset();
    imageGetSizeMock.mockImplementation((_uri: string, onSuccess: (width: number, height: number) => void) => {
      onSuccess(1200, 800);
    });
    manipulateAsyncMock.mockReset();
    manipulateAsyncMock.mockImplementation(async (uri: string) => ({ base64: `base64:${uri}` }));
    requestPermissionMock.mockReset();
    requestPermissionMock.mockResolvedValue({ granted: true });
    launchImageLibraryMock.mockReset();
    generateFromLogoMock.mockReset();
    generateFromMoodBoardMock.mockReset();
    applyFromLogoMock.mockReset();
    applyFromMoodboardMock.mockReset();
    applyFromLogoMock.mockResolvedValue({});
    applyFromMoodboardMock.mockResolvedValue({});
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  });

  it('restores a valid cached logo analysis with its original image', async () => {
    seedLogoCache();

    renderer = await renderScreen(StoreFromLogoScreen);

    expect(imageUris(renderer)).toContain('file:///logo-original.png');
    expect(screenText(renderer)).toContain('Detected Colors');
    expect(screenText(renderer)).toContain('thread');
    expect(manipulateAsyncMock).toHaveBeenCalledWith(
      'file:///logo-original.png',
      [{ resize: { width: 1024 } }],
      expect.objectContaining({ base64: true }),
    );
    expect(storageMock.removeItem).not.toHaveBeenCalledWith(LOGO_CACHE_KEY);
  });

  it('restores a valid cached mood board analysis with its original images', async () => {
    seedMoodboardCache();

    renderer = await renderScreen(StoreFromMoodboardScreen);

    expect(imageUris(renderer)).toEqual([
      'file:///mood-1.png',
      'file:///mood-2.png',
    ]);
    expect(screenText(renderer)).toContain('Color Palette');
    expect(screenText(renderer)).toContain('Editorial serif');
    expect(manipulateAsyncMock).toHaveBeenCalledTimes(2);
    expect(storageMock.removeItem).not.toHaveBeenCalledWith(MOODBOARD_CACHE_KEY);
  });

  it('clears the transient logo analysis when the seller changes the image', async () => {
    seedLogoCache();
    launchImageLibraryMock.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///logo-new.png' }],
    });

    renderer = await renderScreen(StoreFromLogoScreen);
    const upload = renderer.root.findByProps({ testID: 'store-from-logo-upload' });

    await act(async () => {
      await upload.props.onPress();
      await flushPromises();
    });

    expect(storageMock.removeItem).toHaveBeenCalledWith(LOGO_CACHE_KEY);
    expect(storage.get(LOGO_CACHE_KEY)).toBeUndefined();
    expect(imageUris(renderer)).toContain('file:///logo-new.png');
    expect(screenText(renderer)).not.toContain('Detected Colors');
  });

  it('clears the transient mood board analysis when the seller adds an image', async () => {
    seedMoodboardCache();
    launchImageLibraryMock.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///mood-new.png' }],
    });

    renderer = await renderScreen(StoreFromMoodboardScreen);
    const addImage = renderer.root.findByProps({ testID: 'store-from-moodboard-add' });

    await act(async () => {
      await addImage.props.onPress();
      await flushPromises();
    });

    expect(storageMock.removeItem).toHaveBeenCalledWith(MOODBOARD_CACHE_KEY);
    expect(storage.get(MOODBOARD_CACHE_KEY)).toBeUndefined();
    expect(imageUris(renderer)).toContain('file:///mood-new.png');
    expect(screenText(renderer)).not.toContain('Color Palette');
  });

  it('clears the transient logo analysis after Apply succeeds', async () => {
    seedLogoCache();
    renderer = await renderScreen(StoreFromLogoScreen);

    await act(async () => {
      await renderer?.root.findByProps({ label: 'Apply to Store' }).props.onPress();
      await flushPromises();
    });

    expect(applyFromLogoMock).toHaveBeenCalledWith(
      'file:///logo-original.png',
      'base64:file:///logo-original.png',
    );
    expect(storageMock.removeItem).toHaveBeenCalledWith(LOGO_CACHE_KEY);
    expect(storage.get(LOGO_CACHE_KEY)).toBeUndefined();
    expect(routerMock.push).toHaveBeenCalledWith('/store-editor');
  });

  it('clears the transient mood board analysis after Apply succeeds', async () => {
    seedMoodboardCache();
    renderer = await renderScreen(StoreFromMoodboardScreen);

    await act(async () => {
      await renderer?.root.findByProps({ label: 'Apply These Settings' }).props.onPress();
      await flushPromises();
    });

    expect(applyFromMoodboardMock).toHaveBeenCalledWith(
      ['file:///mood-1.png', 'file:///mood-2.png'],
      ['base64:file:///mood-1.png', 'base64:file:///mood-2.png'],
    );
    expect(storageMock.removeItem).toHaveBeenCalledWith(MOODBOARD_CACHE_KEY);
    expect(storage.get(MOODBOARD_CACHE_KEY)).toBeUndefined();
    expect(routerMock.push).toHaveBeenCalledWith('/store-editor');
  });
});