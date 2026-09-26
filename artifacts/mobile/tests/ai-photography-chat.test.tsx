import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  alertMock,
  apiMock,
  featureFlagState,
  launchImageLibraryMock,
} = vi.hoisted(() => ({
  alertMock: vi.fn(),
  apiMock: {
    photography: {
      generate: vi.fn(),
      generateOutfitSwap: vi.fn(),
    },
  },
  featureFlagState: { outfitSwap: true },
  launchImageLibraryMock: vi.fn(),
}));

vi.mock('react-native', () => {
  const React = require('react');
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  };

  function MockFlatList(props: {
    data?: unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
    ListHeaderComponent?: React.ReactNode;
  }) {
    return React.createElement(
      'FlatList',
      props,
      props.ListHeaderComponent,
      ...(props.data ?? []).map((item, index) => props.renderItem({ item, index })),
    );
  }

  return {
    Alert: { alert: alertMock },
    FlatList: MockFlatList,
    Image: nativeComponent('Image'),
    KeyboardAvoidingView: nativeComponent('KeyboardAvoidingView'),
    Platform: { OS: 'web' },
    Pressable: nativeComponent('Pressable'),
    ScrollView: nativeComponent('ScrollView'),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: nativeComponent('Text'),
    TextInput: nativeComponent('TextInput'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
    Animated: {
      Value: class { constructor(_v?: number) {} setValue() {} interpolate() { return 0; } },
      View: nativeComponent('Animated.View'),
      Text: nativeComponent('Animated.Text'),
      timing: () => ({ start: (cb?: () => void) => cb?.() }),
      spring: () => ({ start: (cb?: () => void) => cb?.() }),
      parallel: () => ({ start: (cb?: () => void) => cb?.() }),
      sequence: () => ({ start: (cb?: () => void) => cb?.() }),
      loop: () => ({ start: () => {}, stop: () => {} }),
    },
  };
});

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: (props: Record<string, unknown>) => React.createElement('LinearGradient', props, props.children as React.ReactNode),
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: launchImageLibraryMock,
  MediaTypeOptions: { Images: 'Images' },
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ScreenHeader', () => ({
  ScreenHeader: ({ title, subtitle, rightElement }: {
    title: string;
    subtitle?: string;
    rightElement?: React.ReactNode;
  }) => React.createElement(
    'ScreenHeader',
    null,
    React.createElement('Text', null, title),
    subtitle ? React.createElement('Text', null, subtitle) : null,
    rightElement,
  ),
}));

vi.mock('@/hooks/useApi', () => ({
  useApi: () => apiMock,
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    accent: '#34383E',
    background: '#09090b',
    border: '#27272a',
    card: '#18181b',
    destructive: '#ef4444',
    foreground: '#fafafa',
    mutedForeground: '#a1a1aa',
    primary: '#C7CDD5',
    primaryForeground: '#ffffff',
    secondary: '#27272a',
    success: '#22c55e',
  }),
}));

vi.mock('@/contexts/FeatureFlagContext', () => ({
  useFeatureFlag: () => featureFlagState.outfitSwap,
}));

// The shared Button component (components/ui/Button.tsx) pulls in the real
// AppThemeContext (Clerk, AsyncStorage, the API client) at module load time
// otherwise — none of which are available in this unit-test environment.
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#C7CDD5',
      onAccent: '#000000',
      accentLight: '#C7CDD5',
      accentDim: '#34383E',
    },
  }),
}));

import AIPhotographyChatScreen from '@/app/ai-photography-chat';

type AlertButton = {
  text?: string;
  onPress?: () => void | Promise<void>;
};

type PhotoAsset = {
  uri: string;
  base64: string;
  mimeType?: string;
  assetId?: string;
};

function photoAsset(name: string): PhotoAsset {
  return {
    uri: `file:///${name}.jpg`,
    base64: `${name}-base64`,
    mimeType: 'image/jpeg',
    assetId: name,
  };
}

function queuePhotos(...names: string[]) {
  launchImageLibraryMock.mockResolvedValueOnce({
    canceled: false,
    assets: names.map(photoAsset),
  });
}

async function flush() {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<AIPhotographyChatScreen />);
    await flush();
  });
  return renderer;
}

async function press(renderer: ReactTestRenderer, testID: string) {
  await act(async () => {
    renderer.root.findByProps({ testID }).props.onPress();
    await flush();
  });
}

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (!value || typeof value !== 'object') return '';
  const node = value as { children?: unknown; props?: { children?: unknown } };
  return textContent(node.children ?? node.props?.children);
}

function screenText(renderer: ReactTestRenderer): string {
  return textContent(renderer.toJSON());
}

function textInput(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ testID: 'ai-photography-input' });
}

function removeButtons(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (node) => String(node.type) === 'TouchableOpacity'
      && node.props.accessibilityLabel === 'Remove photo',
  );
}

function lastAlertButtons(): AlertButton[] {
  const buttons = alertMock.mock.lastCall?.[2];
  return Array.isArray(buttons) ? buttons : [];
}

describe('AI photography Outfit Swap mobile flow', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    alertMock.mockReset();
    apiMock.photography.generate.mockReset();
    apiMock.photography.generateOutfitSwap.mockReset();
    featureFlagState.outfitSwap = true;
    launchImageLibraryMock.mockReset();
    apiMock.photography.generate.mockResolvedValue({ b64_json: 'free-result' });
    apiMock.photography.generateOutfitSwap.mockResolvedValue({
      results: [{ garmentIndex: 1, b64_json: 'swap-result' }],
    });
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = undefined;
    }
  });

  it('switches modes without losing the free-form prompt or product photos', async () => {
    renderer = await renderScreen();
    queuePhotos('free-product');
    await press(renderer, 'ai-photography-attach');

    await act(async () => {
      textInput(renderer!).props.onChangeText('Use an editorial studio background');
    });
    await press(renderer, 'ai-photography-mode-outfit-swap');

    expect(textInput(renderer).props.placeholder).toBe('Add outfit notes (optional)...');
    expect(textInput(renderer).props.value).toBe('Use an editorial studio background');

    await press(renderer, 'ai-photography-mode-free');
    expect(textInput(renderer).props.placeholder).toBe('Describe the shot you want...');
    expect(textInput(renderer).props.value).toBe('Use an editorial studio background');
    expect(renderer.root.findByProps({ testID: 'ai-photography-send' }).props.disabled).toBe(false);

    await press(renderer, 'ai-photography-send');

    expect(apiMock.photography.generate).toHaveBeenCalledWith(
      ['data:image/jpeg;base64,free-product-base64'],
      'Use an editorial studio background',
    );
    expect(screenText(renderer)).toContain("Here's your studio photo.");
  });

  it('locks a hero once, accepts multiple garments, supports removal, and enforces the four-garment limit', async () => {
    renderer = await renderScreen();
    await press(renderer, 'ai-photography-mode-outfit-swap');

    queuePhotos('hero');
    await press(renderer, 'ai-photography-attach');
    expect(screenText(renderer)).toContain('Hero locked — upload garment mockups to keep the same scene.');

    await press(renderer, 'ai-photography-send');
    expect(apiMock.photography.generateOutfitSwap).not.toHaveBeenCalled();
    expect(screenText(renderer)).toContain('Hero photo locked.');

    queuePhotos('garment-1', 'garment-2', 'garment-3', 'garment-4');
    await press(renderer, 'ai-photography-attach');
    expect(removeButtons(renderer)).toHaveLength(4);
    expect(renderer.root.findByProps({ testID: 'ai-photography-attach' }).props.disabled).toBe(true);

    await act(async () => {
      removeButtons(renderer!)[1].props.onPress();
      await flush();
    });
    expect(removeButtons(renderer)).toHaveLength(3);
    expect(renderer.root.findByProps({ testID: 'ai-photography-attach' }).props.disabled).toBe(false);

    queuePhotos('garment-5');
    await press(renderer, 'ai-photography-attach');
    expect(removeButtons(renderer)).toHaveLength(4);
    expect(renderer.root.findByProps({ testID: 'ai-photography-attach' }).props.disabled).toBe(true);
    expect(apiMock.photography.generateOutfitSwap).not.toHaveBeenCalled();
  });

  it('starts a new swap by releasing the old hero while preserving the conversation', async () => {
    renderer = await renderScreen();
    await press(renderer, 'ai-photography-mode-outfit-swap');
    queuePhotos('first-hero', 'first-garment');
    await press(renderer, 'ai-photography-attach');
    await press(renderer, 'ai-photography-send');

    const resetButton = renderer.root.findByProps({
      accessibilityLabel: 'Start a new Outfit Swap',
    });
    await act(async () => {
      resetButton.props.onPress();
    });
    expect(alertMock).toHaveBeenCalledWith(
      'Start a new Outfit Swap?',
      expect.stringContaining('releases the locked hero photo'),
      expect.any(Array),
    );

    const startNewSwap = lastAlertButtons().find((button) => button.text === 'Start new swap');
    await act(async () => {
      await startNewSwap?.onPress?.();
      await flush();
    });

    expect(screenText(renderer)).toContain('New Outfit Swap started.');
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Start a new Outfit Swap' })).toHaveLength(0);
    expect(removeButtons(renderer)).toHaveLength(0);

    queuePhotos('second-hero');
    await press(renderer, 'ai-photography-attach');
    expect(screenText(renderer)).toContain('Hero locked — upload garment mockups to keep the same scene.');
  });

  it('renders result labels in garment order and keeps partial failures visible', async () => {
    apiMock.photography.generateOutfitSwap.mockResolvedValueOnce({
      results: [
        { garmentIndex: 1, b64_json: 'first-result' },
        { garmentIndex: 2, b64_json: 'second-result' },
      ],
      errors: [{ garmentIndex: 3 }],
    });

    renderer = await renderScreen();
    await press(renderer, 'ai-photography-mode-outfit-swap');
    queuePhotos('hero', 'garment-1', 'garment-2', 'garment-3');
    await press(renderer, 'ai-photography-attach');
    await press(renderer, 'ai-photography-send');

    expect(apiMock.photography.generateOutfitSwap).toHaveBeenCalledWith(
      'data:image/jpeg;base64,hero-base64',
      [
        'data:image/jpeg;base64,garment-1-base64',
        'data:image/jpeg;base64,garment-2-base64',
        'data:image/jpeg;base64,garment-3-base64',
      ],
      '',
    );
    const rendered = screenText(renderer);
    expect(rendered).toContain('Outfit Swap result 1 of 3 — garment 1 on the locked hero scene.');
    expect(rendered).toContain('Outfit Swap result 2 of 3 — garment 2 on the locked hero scene.');
    expect(rendered).toContain('Garment 3 could not be generated. Please try that design again.');
  });
});