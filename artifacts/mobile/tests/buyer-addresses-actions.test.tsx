/**
 * Shipping addresses: delete / set-default pending state + double-tap guard,
 * friendly error feedback, keyboard "Next" order, and the checkout country
 * picker (stores the ISO code).
 */
import React from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { apiMock, alertMock, focusMock } = vi.hoisted(() => ({
  apiMock: {
    buyer: {
      addresses: {
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        setDefault: vi.fn(),
      },
    },
  },
  alertMock: { showAlert: vi.fn(), confirmAlert: vi.fn() },
  focusMock: vi.fn(),
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
  // Ref-able TextInput so the screen's focus() chain can be observed.
  const TextInput = React.forwardRef(function MockTextInput(props: Record<string, unknown>, ref: React.Ref<unknown>) {
    React.useImperativeHandle(ref, () => ({
      focus: () => focusMock(props.accessibilityLabel),
      blur: vi.fn(),
    }));
    return React.createElement('TextInput', props);
  });
  return {
    View: native('View'),
    Text: native('Text'),
    ScrollView: native('ScrollView'),
    TouchableOpacity: native('TouchableOpacity'),
    ActivityIndicator: native('ActivityIndicator'),
    TextInput,
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
    Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
  };
});

vi.mock('@/components/KeyboardProviderCompat', () => ({
  KeyboardAvoidingView: ({ children }: { children: React.ReactNode }) => React.createElement('KeyboardAvoidingView', null, children),
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: (p: Record<string, unknown>) => React.createElement('Icon', p) }));
vi.mock('@/components/ui', () => {
  const native = (name: string) => (p: Record<string, unknown>) => React.createElement(name, p, p.children as React.ReactNode);
  return { Button: native('Button'), Card: native('Card'), IconButton: native('IconButton') };
});
vi.mock('@/components/BrandthreadUI', () => ({ EmptyState: (p: Record<string, unknown>) => React.createElement('EmptyState', p) }));
vi.mock('@/components/ScreenHeader', () => ({ ScreenHeader: (p: Record<string, unknown>) => React.createElement('ScreenHeader', p) }));
vi.mock('@/components/checkout/RegionPickerSheet', () => ({
  RegionPickerSheet: (p: Record<string, unknown>) => React.createElement('RegionPickerSheet', p),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'buyer-1' }) }));
vi.mock('@/lib/api', () => ({ useApi: () => apiMock }));
vi.mock('@/lib/actionSheet', () => alertMock);
vi.mock('@/lib/haptics', () => ({
  hapticDestructiveConfirm: vi.fn(), hapticSuccess: vi.fn(), hapticToggle: vi.fn(), haptics: {},
}));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isPreviewDemoMode: () => false }));
vi.mock('@/lib/previewCheckout', () => ({
  PREVIEW_CHECKOUT_ADDRESS: { firstName: 'Jordan', lastName: 'Reyes', line1: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
  PREVIEW_CHECKOUT_CONTACT: { phone: '555' },
}));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ mutedForeground: '#777' }) }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#000', text: '#FFF', muted: '#AAA', border: '#333', cardElevated: '#111',
      accent: '#CCC', onAccent: '#000', success: '#0F0', error: '#F00',
    },
  }),
}));

import BuyerAddressesScreen, { countryName } from '@/app/buyer-addresses';

const ADDRESSES = [
  { id: 'a1', label: 'Home', recipientName: 'Maya', street: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', isDefault: true },
  { id: 'a2', label: 'Work', recipientName: 'Maya', street: '2 Broad', city: 'Toronto', state: 'ON', postalCode: 'M5H', country: 'ca', isDefault: false },
];

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const byLabel = (r: ReactTestRenderer, type: string, label: string): ReactTestInstance[] =>
  r.root.findAll(n => (n.type as unknown) === type && n.props.accessibilityLabel === label);

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<BuyerAddressesScreen />); await flush(); });
  return r;
}

describe('shipping addresses actions', () => {
  let r: ReactTestRenderer | undefined;

  beforeEach(() => {
    Object.values(apiMock.buyer.addresses).forEach(fn => fn.mockReset());
    apiMock.buyer.addresses.list.mockResolvedValue(ADDRESSES);
    alertMock.showAlert.mockReset();
    alertMock.confirmAlert.mockReset();
    focusMock.mockReset();
  });

  afterEach(async () => {
    if (r) await act(async () => { r?.unmount(); });
    r = undefined;
  });

  it('set as default: shows loading, ignores a second tap while pending', async () => {
    const call = deferred();
    apiMock.buyer.addresses.setDefault.mockReturnValue(call.promise);
    r = await render();

    const btn = () => byLabel(r!, 'Button', 'Set Work as default address')[0];
    await act(async () => { btn().props.onPress(); btn().props.onPress(); await flush(); });
    expect(apiMock.buyer.addresses.setDefault).toHaveBeenCalledTimes(1);
    expect(btn().props.loading).toBe(true);
    expect(btn().props.disabled).toBe(true);
    // The row's other actions are locked too.
    expect(byLabel(r, 'IconButton', 'Delete Work address')[0].props.disabled).toBe(true);

    await act(async () => { btn().props.onPress(); await flush(); });
    expect(apiMock.buyer.addresses.setDefault).toHaveBeenCalledTimes(1);

    await act(async () => { call.resolve(); await flush(); });
    expect(btn().props.loading).toBe(false);
    expect(btn().props.disabled).toBe(false);
  });

  it('set as default failure shows a friendly alert', async () => {
    apiMock.buyer.addresses.setDefault.mockRejectedValue(new Error('Network request failed'));
    r = await render();
    await act(async () => { byLabel(r!, 'Button', 'Set Work as default address')[0].props.onPress(); await flush(); });
    expect(alertMock.showAlert).toHaveBeenCalledWith("Couldn't set default address", 'Check your connection and try again.');
    expect(byLabel(r, 'Button', 'Set Work as default address')[0].props.loading).toBe(false);
  });

  it('delete: one confirmation per double tap, busy spinner while deleting', async () => {
    const confirm = deferred<boolean>();
    alertMock.confirmAlert.mockReturnValue(confirm.promise);
    const call = deferred();
    apiMock.buyer.addresses.delete.mockReturnValue(call.promise);
    r = await render();

    const trash = byLabel(r, 'IconButton', 'Delete Work address')[0];
    await act(async () => { trash.props.onPress(); trash.props.onPress(); await flush(); });
    expect(alertMock.confirmAlert).toHaveBeenCalledTimes(1);
    expect(alertMock.confirmAlert.mock.calls[0][0]).toMatchObject({ confirmLabel: 'Delete address', destructive: true });

    await act(async () => { confirm.resolve(true); await flush(); });
    expect(apiMock.buyer.addresses.delete).toHaveBeenCalledTimes(1);
    const spinner = byLabel(r, 'View', 'Deleting Work address')[0];
    expect(spinner.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(byLabel(r, 'IconButton', 'Delete Work address')).toHaveLength(0);
    expect(byLabel(r, 'Button', 'Set Work as default address')[0].props.disabled).toBe(true);

    apiMock.buyer.addresses.list.mockResolvedValue([ADDRESSES[0]]);
    await act(async () => { call.resolve(); await flush(); });
    expect(byLabel(r, 'View', 'Deleting Work address')).toHaveLength(0);
  });

  it('delete: cancelling the confirmation releases the guard; failures alert', async () => {
    alertMock.confirmAlert.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    apiMock.buyer.addresses.delete.mockRejectedValue(Object.assign(new Error('API 500: boom'), {}));
    r = await render();

    await act(async () => { byLabel(r!, 'IconButton', 'Delete Work address')[0].props.onPress(); await flush(); });
    expect(apiMock.buyer.addresses.delete).not.toHaveBeenCalled();

    await act(async () => { byLabel(r!, 'IconButton', 'Delete Work address')[0].props.onPress(); await flush(); });
    expect(apiMock.buyer.addresses.delete).toHaveBeenCalledTimes(1);
    expect(alertMock.showAlert).toHaveBeenCalledWith("Couldn't delete address", 'Try again.');
    expect(byLabel(r, 'IconButton', 'Delete Work address')[0].props.disabled).toBe(false);
  });

  it('keyboard Next walks the form fields; phone is the last field', async () => {
    r = await render();
    await act(async () => { byLabel(r!, 'IconButton', 'Edit Work address')[0].props.onPress(); await flush(); });

    const order = ['Label', 'Recipient name', 'Street address', 'Apt, suite, etc. (optional)', 'City', 'State / province', 'ZIP / postal code'];
    const next = ['Recipient name', 'Street address', 'Apt, suite, etc. (optional)', 'City', 'State / province', 'ZIP / postal code', 'Phone (optional)'];
    order.forEach((label, i) => {
      const input = byLabel(r!, 'TextInput', label)[0];
      expect(input.props.returnKeyType).toBe('next');
      expect(input.props.blurOnSubmit).toBe(false);
      focusMock.mockReset();
      input.props.onSubmitEditing();
      expect(focusMock).toHaveBeenCalledWith(next[i]);
    });
    const phone = byLabel(r, 'TextInput', 'Phone (optional)')[0];
    expect(phone.props.returnKeyType).toBe('done');
    expect(phone.props.blurOnSubmit).not.toBe(false);
  });

  it('country uses the checkout picker and stores the ISO code', async () => {
    apiMock.buyer.addresses.update.mockResolvedValue({});
    r = await render();
    // Legacy lower-case code is shown by name in the list.
    expect(r.root.findAll(n => (n.type as unknown) === 'Text' && n.props.children === 'Canada')).toHaveLength(1);

    await act(async () => { byLabel(r!, 'IconButton', 'Edit Work address')[0].props.onPress(); await flush(); });
    expect(r.root.findAll(n => (n.type as unknown) === 'TextInput' && n.props.textContentType === 'countryName')).toHaveLength(0);
    const trigger = byLabel(r, 'TouchableOpacity', 'Country: Canada')[0];
    expect(trigger.props.accessibilityRole).toBe('button');

    await act(async () => { trigger.props.onPress(); await flush(); });
    const sheet = r.root.find(n => (n.type as unknown) === 'RegionPickerSheet');
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.value).toBe('CA');

    await act(async () => { sheet.props.onSelect('GB'); sheet.props.onClose(); await flush(); });
    expect(byLabel(r, 'TouchableOpacity', 'Country: United Kingdom')).toHaveLength(1);

    await act(async () => { r!.root.find(n => (n.type as unknown) === 'Button' && n.props.label === 'Save address').props.onPress(); await flush(); });
    expect(apiMock.buyer.addresses.update).toHaveBeenCalledWith('a2', expect.objectContaining({ country: 'GB' }));
  });

  it('countryName falls back to the stored value', () => {
    expect(countryName('US')).toBe('United States');
    expect(countryName('Narnia')).toBe('Narnia');
    expect(countryName(undefined)).toBe('');
  });
});
