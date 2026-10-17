import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  alertMock, actionSheetMock, addListenerMock, dispatchMock, routerPushMock, saveDraftMock, leaveSetupFlowMock,
} = vi.hoisted(() => ({
  alertMock: vi.fn(),
  actionSheetMock: vi.fn(),
  addListenerMock: vi.fn(),
  dispatchMock: vi.fn(),
  routerPushMock: vi.fn(),
  saveDraftMock: vi.fn(),
  leaveSetupFlowMock: vi.fn(),
}));

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const native = (name: string) => {
    function Mock(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    Mock.displayName = name;
    return Mock;
  };
  return {
    Alert: { alert: alertMock },
    Platform: { OS: 'ios' },
    Pressable: native('Pressable'),
    ScrollView: native('ScrollView'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: native('Text'),
    TextInput: native('TextInput'),
    View: native('View'),
  };
});

vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: routerPushMock, back: vi.fn() }),
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ addListener: addListenerMock, dispatch: dispatchMock }),
}));

vi.mock('@/components/KeyboardProviderCompat', () => ({
  KeyboardAvoidingView: ({ children }: { children?: React.ReactNode }) => React.createElement('KAV', null, children),
}));

vi.mock('@/components/ScreenHeader', () => ({
  ScreenHeader: ({ title, onBack, rightElement }: { title: string; onBack: () => void; rightElement?: React.ReactNode }) =>
    React.createElement('Header', { title }, React.createElement('Close', { testID: 'add-product-close', onPress: onBack }), rightElement),
}));

vi.mock('@/components/ui/ActionSheet', () => ({ showActionSheet: actionSheetMock }));

vi.mock('@/components/listing/PhotoStrip', () => ({
  PhotoStrip: () => React.createElement('PhotoStrip'),
}));

vi.mock('@/components/listing/ListingRows', () => {
  const React = require('react') as typeof import('react');
  return {
    SectionGap: () => null,
    GroupNote: ({ children }: { children: React.ReactNode }) => React.createElement('Note', null, children),
    FormRow: (props: { testID?: string; label: string; error?: boolean; onPress: () => void }) => React.createElement('FormRow', props),
    LabeledField: (props: Record<string, unknown>) => React.createElement('TextInput', props),
    ListingBottomBar: (props: { primaryLabel: string; onPrimary: () => void; secondaryLabel?: string; onSecondary?: () => void }) =>
      React.createElement('Bar', null,
        props.secondaryLabel ? React.createElement('Button', { testID: 'add-product-save-draft', onPress: props.onSecondary, label: props.secondaryLabel }) : null,
        React.createElement('Button', { testID: 'add-product-preview', onPress: props.onPrimary, label: props.primaryLabel })),
  };
});

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { background: '#111', surface: '#222', text: '#eee', muted: '#aaa', subtle: '#999', border: '#333', error: '#f99' } }),
}));

vi.mock('@/lib/api', () => ({ useApi: () => ({ products: {} }) }));
vi.mock('@/lib/tabBarVisibility', () => ({ useHideTabBar: () => {} }));
vi.mock('@/lib/setupNavigation', () => ({ leaveSetupFlow: leaveSetupFlowMock }));
vi.mock('@/hooks/useFeeSchedule', () => ({ useFeeSchedule: () => ({ platformFeeBps: 500, processing: { bps: 290, fixedCents: 30 } }) }));
vi.mock('@/lib/listing/listingMedia', () => ({
  pickFromLibrary: vi.fn(), takePhoto: vi.fn(), removePhoto: vi.fn(), uploadListingPhoto: vi.fn(),
}));
vi.mock('@/services/productService', () => ({
  loadDraft: vi.fn(async () => null),
  saveDraft: saveDraftMock,
}));

import AddProductScreen from '@/app/add-product';
import { resetListing, updateListing } from '@/lib/listing/listingStore';

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<AddProductScreen />);
    await Promise.resolve();
  });
  return r;
}

type SheetButton = { text: string; onPress?: () => void };
const lastSheetButtons = (): SheetButton[] => actionSheetMock.mock.lastCall?.[2] ?? [];

describe('Sell an item form', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    [alertMock, actionSheetMock, addListenerMock, dispatchMock, routerPushMock, saveDraftMock, leaveSetupFlowMock].forEach(m => m.mockReset());
    saveDraftMock.mockResolvedValue(undefined);
    addListenerMock.mockReturnValue(vi.fn());
    resetListing();
  });

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
  });

  it('shows the Vinted field rows in order with Depop’s Save to drafts / Preview bar', async () => {
    renderer = await render();
    const rows = renderer.root.findAll(n => n.type === 'FormRow').map(n => n.props.label);
    expect(rows).toEqual(['Category', 'Brand', 'Size', 'Condition', 'Colours', 'Material (recommended)', 'Price', 'Shipping']);
    expect(renderer.root.findByProps({ testID: 'add-product-save-draft' }).props.label).toBe('Save to drafts');
    expect(renderer.root.findByProps({ testID: 'add-product-preview' }).props.label).toBe('Preview');
    // Fixes #105: no step tabs.
    expect(renderer.root.findAll(n => n.props.accessibilityRole === 'tab')).toHaveLength(0);
  });

  it('closes straight away when nothing was entered', async () => {
    renderer = await render();
    await act(async () => { renderer!.root.findByProps({ testID: 'add-product-close' }).props.onPress(); });
    expect(actionSheetMock).not.toHaveBeenCalled();
    expect(leaveSetupFlowMock).toHaveBeenCalledOnce();
  });

  it('offers Save to drafts on close after an edit, and saves the listing', async () => {
    renderer = await render();
    await act(async () => { updateListing({ title: 'Boxy tee' }); });
    await act(async () => { renderer!.root.findByProps({ testID: 'add-product-close' }).props.onPress(); });
    expect(actionSheetMock).toHaveBeenCalledWith('Save to drafts?', expect.any(String), expect.any(Array));
    expect(lastSheetButtons().map(b => b.text)).toEqual(['Save to drafts', 'Discard', 'Cancel']);
    await act(async () => {
      lastSheetButtons()[0].onPress?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(saveDraftMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Boxy tee', isDraft: true }));
    expect(leaveSetupFlowMock).toHaveBeenCalledOnce();
  });

  it('guards native back after an edit until the seller chooses', async () => {
    renderer = await render();
    await act(async () => { updateListing({ description: 'Worn twice' }); });
    const beforeRemove = addListenerMock.mock.calls.find(c => c[0] === 'beforeRemove')![1];
    const preventDefault = vi.fn();
    const action = { type: 'GO_BACK' };
    await act(async () => { beforeRemove({ preventDefault, data: { action } }); });
    expect(preventDefault).toHaveBeenCalledOnce();
    await act(async () => { lastSheetButtons().find(b => b.text === 'Discard')!.onPress?.(); });
    expect(dispatchMock).toHaveBeenCalledWith(action);
  });

  it('Preview lists what is missing and marks the rows instead of a hidden disabled button', async () => {
    renderer = await render();
    await act(async () => { renderer!.root.findByProps({ testID: 'add-product-preview' }).props.onPress(); });
    expect(alertMock).toHaveBeenCalledWith('Almost there', 'Add photos, title, category, condition and price to continue.');
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ testID: 'add-product-price' }).props.error).toBe(true);
  });

  it('opens the preview once the listing is complete, and previews earnings under Price', async () => {
    renderer = await render();
    await act(async () => {
      updateListing({
        photos: [{ id: 'a', uri: 'file:///a.jpg', remoteUri: '/objects/a', status: 'done' }],
        title: 'Boxy tee', department: 'Men', category: 'Tops', subcategory: 'T-shirts',
        condition: 'good', priceStr: '40',
      });
    });
    const note = renderer.root.findAll(n => n.type === 'Note').map(n => n.props.children);
    expect(note[0]).toMatch(/^You’ll earn \$\d+\.\d\d after fees\.$/);
    await act(async () => { renderer!.root.findByProps({ testID: 'add-product-preview' }).props.onPress(); });
    expect(routerPushMock).toHaveBeenCalledWith('/listing/preview');
  });
});
