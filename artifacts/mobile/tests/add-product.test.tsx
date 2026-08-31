import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  alertMock,
  addListenerMock,
  dispatchMock,
  routerBackMock,
  saveDraftMock,
} = vi.hoisted(() => ({
  alertMock: vi.fn(),
  addListenerMock: vi.fn(),
  dispatchMock: vi.fn(),
  routerBackMock: vi.fn(),
  saveDraftMock: vi.fn(),
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

  return {
    Alert: { alert: alertMock },
    Image: nativeComponent('Image'),
    KeyboardAvoidingView: nativeComponent('KeyboardAvoidingView'),
    LayoutAnimation: { configureNext: vi.fn(), Presets: { easeInEaseOut: {} } },
    Platform: { OS: 'ios' },
    ScrollView: nativeComponent('ScrollView'),
    StyleSheet: { create: (styles: unknown) => styles },
    Switch: nativeComponent('Switch'),
    Text: nativeComponent('Text'),
    TextInput: nativeComponent('TextInput'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    UIManager: { setLayoutAnimationEnabledExperimental: vi.fn() },
    View: nativeComponent('View'),
  };
});

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('LinearGradient', props, children),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ back: routerBackMock }),
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({
    addListener: addListenerMock,
    dispatch: dispatchMock,
  }),
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
      secondaryDim: '#172554',
    },
  }),
}));

vi.mock('@/hooks/useApi', () => ({
  useApi: () => ({}),
}));

vi.mock('@/services/productService', () => ({
  deleteDraft: vi.fn(),
  getCollections: vi.fn(async () => []),
  getProduct: vi.fn(),
  loadDraft: vi.fn(async () => null),
  saveDraft: saveDraftMock,
}));

vi.mock('@/components/StyleTagsPicker', () => ({
  default: () => null,
}));

vi.mock('@/components/BrandthreadUI', () => {
  const React = require('react') as typeof import('react');
  const native = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as React.ReactNode);

  return {
    BrandthreadCard: native('BrandthreadCard'),
    GradientCard: native('GradientCard'),
    PrimaryButton: native('PrimaryButton'),
    SecondaryButton: native('SecondaryButton'),
    IconButton: native('IconButton'),
    FilterChip: native('FilterChip'),
    StatusBadge: native('StatusBadge'),
    SectionHeader: native('SectionHeader'),
    ProgressCard: native('ProgressCard'),
    EmptyState: native('EmptyState'),
    GuidedTip: native('GuidedTip'),
    FormInput: ({
      label,
      value,
      onChange,
      onSubmitEditing,
    }: {
      label?: string;
      value: string;
      onChange: (value: string) => void;
      onSubmitEditing?: () => void;
    }) =>
      React.createElement(
        'View',
        null,
        label ? React.createElement('Text', null, label) : null,
        React.createElement('TextInput', {
          testID: label ? `product-input-${label}` : undefined,
          value,
          onChangeText: onChange,
          onSubmitEditing,
        }),
      ),
  };
});

vi.mock('@/lib/productUtils', () => ({
  buildVariantTitle: vi.fn((values: string[]) => values.join(' / ')),
  calcPricing: vi.fn(() => ({
    grossProfitCents: undefined,
    netProfitCents: undefined,
    marginPercent: undefined,
    breakEvenPriceCents: undefined,
  })),
  generateVariantCombinations: vi.fn(() => []),
  validateForPublish: vi.fn(() => []),
}));

vi.mock('@/lib/money', () => ({
  formatCents: vi.fn(() => '$0.00'),
  parseDecimalToCents: vi.fn(() => undefined),
}));

import AddProductScreen from '@/app/add-product';

type AlertButton = {
  text?: string;
  onPress?: () => void | Promise<void>;
};

function lastAlertButtons(): AlertButton[] {
  const buttons = alertMock.mock.lastCall?.[2];
  return Array.isArray(buttons) ? buttons : [];
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<AddProductScreen />);
    await Promise.resolve();
  });
  return renderer;
}

describe('AddProduct draft exit protection', () => {
  let renderer!: ReactTestRenderer;

  beforeEach(() => {
    vi.useFakeTimers();
    alertMock.mockReset();
    addListenerMock.mockReset();
    dispatchMock.mockReset();
    routerBackMock.mockReset();
    saveDraftMock.mockReset();
    saveDraftMock.mockResolvedValue(undefined);
    addListenerMock.mockReturnValue(vi.fn());
  });

  afterEach(async () => {
    await act(async () => {
      renderer?.unmount();
    });
    vi.useRealTimers();
  });

  it('warns after an immediate edit, then skips the warning once that edit is saved', async () => {
    renderer = await renderScreen();

    const nameInput = renderer.root.findByProps({ testID: 'product-input-Product name *' });
    await act(async () => {
      nameInput.props.onChangeText('Last-second product edit');
    });

    await act(async () => {
      renderer.root.findByProps({ testID: 'add-product-exit' }).props.onPress();
    });

    expect(alertMock).toHaveBeenCalledWith(
      'Exit product creation?',
      'You have unsaved changes — save as draft?',
      expect.any(Array),
    );
    expect(routerBackMock).not.toHaveBeenCalled();
    expect(lastAlertButtons().map((button) => button.text)).toEqual([
      'Save draft',
      'Discard',
      'Cancel',
    ]);

    alertMock.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(saveDraftMock).toHaveBeenCalledOnce();
    expect(saveDraftMock.mock.calls[0][0]).toMatchObject({
      id: expect.any(String),
      name: 'Last-second product edit',
      isDraft: true,
    });

    await act(async () => {
      renderer.root.findByProps({ testID: 'add-product-exit' }).props.onPress();
    });

    expect(alertMock).not.toHaveBeenCalled();
    expect(routerBackMock).toHaveBeenCalledOnce();
  });

  it('prevents native back navigation after an immediate edit until the seller chooses to leave', async () => {
    renderer = await renderScreen();

    const nameInput = renderer.root.findByProps({ testID: 'product-input-Product name *' });
    await act(async () => {
      nameInput.props.onChangeText('Native back draft edit');
    });

    expect(addListenerMock).toHaveBeenCalledWith('beforeRemove', expect.any(Function));
    const beforeRemove = addListenerMock.mock.calls[0][1] as (event: {
      preventDefault: () => void;
      data: { action: unknown };
    }) => void;
    const preventDefaultMock = vi.fn();
    const nativeBackAction = { type: 'GO_BACK' };

    await act(async () => {
      beforeRemove({
        preventDefault: preventDefaultMock,
        data: { action: nativeBackAction },
      });
    });

    expect(preventDefaultMock).toHaveBeenCalledOnce();
    expect(alertMock).toHaveBeenCalledWith(
      'Exit product creation?',
      'You have unsaved changes — save as draft?',
      expect.any(Array),
    );
    expect(dispatchMock).not.toHaveBeenCalled();

    await act(async () => {
      const discardButton = lastAlertButtons().find((button) => button.text === 'Discard');
      discardButton?.onPress?.();
      await Promise.resolve();
    });

    expect(dispatchMock).toHaveBeenCalledWith(nativeBackAction);
  });
});
