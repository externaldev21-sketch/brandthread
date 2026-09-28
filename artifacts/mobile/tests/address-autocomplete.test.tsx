import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent, api } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
  api: { buyer: { addresses: { autocomplete: vi.fn(), resolveSuggestion: vi.fn() } } },
}));

vi.mock('react-native', () => ({
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  TextInput: nativeComponent('TextInput'),
  Pressable: nativeComponent('Pressable'),
  ActivityIndicator: nativeComponent('ActivityIndicator'),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Platform: { OS: 'ios', select: (spec: Record<string, unknown>) => spec.ios ?? spec.default },
}));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => api }));
vi.mock('@/lib/inputReset', () => ({ WEB_INPUT_RESET: {} }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#aaa', subtle: '#777', border: '#333', background: '#000', cardElevated: '#111' } }),
}));

import {
  AddressAutocompleteInput, resolveErrorMessage, searchStatusForError,
} from '@/components/AddressAutocompleteInput';

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

/** Controlled like AddressSheet: typing and picking both update `value`. */
function Harness({ initial = '', onSelect }: { initial?: string; onSelect: (a: unknown) => void }) {
  const [value, setValue] = React.useState(initial);
  return (
    <AddressAutocompleteInput
      value={value}
      onChangeText={setValue}
      onSelect={(address) => { setValue(address.line1); onSelect(address); }}
    />
  );
}

let tree: ReactTestRenderer;
function render(initial?: string) {
  const onSelect = vi.fn();
  act(() => { tree = create(<Harness initial={initial} onSelect={onSelect} />); });
  return onSelect;
}
const input = () => tree.root.findByType('TextInput' as never);
const type = (text: string) => act(() => { input().props.onChangeText(text); });
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(350); }); };
const suggestions = () => tree.root.findAll((n) => (n.type as unknown) === 'Pressable' && /^Use address /.test(n.props.accessibilityLabel ?? ''));
const byTestId = (id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type === 'string');
const allText = () => tree.root.findAllByType('Text' as never).map((t) => [t.props.children].flat().join('')).join(' | ');

const ROWS = [
  { placeId: 'p1', label: '350 Bedford Ave, Brooklyn, NY 11211, USA' },
  { placeId: 'p2', label: '350 Bedford St, San Francisco, CA 94110, USA' },
];

describe('AddressAutocompleteInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.buyer.addresses.autocomplete.mockReset();
    api.buyer.addresses.resolveSuggestion.mockReset();
  });
  afterEach(() => { act(() => tree?.unmount()); vi.useRealTimers(); });

  it('shows suggestions as the buyer types (debounced, 3+ chars)', async () => {
    api.buyer.addresses.autocomplete.mockResolvedValue(ROWS);
    render();
    type('35');
    await flush();
    expect(api.buyer.addresses.autocomplete).not.toHaveBeenCalled();
    type('350 Bedf');
    await flush();
    expect(api.buyer.addresses.autocomplete).toHaveBeenCalledWith('350 Bedf', 'US');
    expect(suggestions()).toHaveLength(2);
  });

  it('picking a suggestion fills every field and does not reopen the list', async () => {
    api.buyer.addresses.autocomplete.mockResolvedValue(ROWS);
    const resolved = { line1: '350 Bedford Ave', city: 'Brooklyn', state: 'NY', postalCode: '11211', country: 'US' };
    api.buyer.addresses.resolveSuggestion.mockResolvedValue(resolved);
    const onSelect = render();
    type('350 Bedf');
    await flush();
    await act(async () => { suggestions()[0].props.onPress(); });
    expect(onSelect).toHaveBeenCalledWith(resolved);
    await flush();
    expect(suggestions()).toHaveLength(0);
    // line1 changed to "350 Bedford Ave" — that must not trigger a new search.
    expect(api.buyer.addresses.autocomplete).toHaveBeenCalledTimes(1);
  });

  it('re-opening with a saved street does not search until the buyer types', async () => {
    api.buyer.addresses.autocomplete.mockResolvedValue(ROWS);
    render('1120 NW Everett Street');
    await flush();
    expect(api.buyer.addresses.autocomplete).not.toHaveBeenCalled();
    expect(suggestions()).toHaveLength(0);
  });

  it('no matches → designed "No matching addresses" state', async () => {
    api.buyer.addresses.autocomplete.mockResolvedValue([]);
    render();
    type('99999 Nowhere Rd');
    await flush();
    expect(byTestId('address-search-empty')).toHaveLength(1);
    expect(allText()).toContain('No matching addresses');
    expect(allText()).not.toContain('Powered by Google');
  });

  it('Places down → "Suggestions aren’t loading" with a working Try again', async () => {
    api.buyer.addresses.autocomplete.mockRejectedValueOnce(httpError(502)).mockResolvedValueOnce(ROWS);
    render();
    type('350 Bedf');
    await flush();
    expect(byTestId('address-search-error')).toHaveLength(1);
    const retry = tree.root.find((n) => n.props.accessibilityLabel === 'Try loading address suggestions again' && typeof n.type === 'string');
    act(() => { retry.props.onPress(); });
    await flush();
    expect(api.buyer.addresses.autocomplete).toHaveBeenCalledTimes(2);
    expect(suggestions()).toHaveLength(2);
    expect(byTestId('address-search-error')).toHaveLength(0);
  });

  it('Places not configured (503) → "Address search is unavailable", no retry', async () => {
    api.buyer.addresses.autocomplete.mockRejectedValue(httpError(503));
    render();
    type('350 Bedf');
    await flush();
    expect(byTestId('address-search-unavailable')).toHaveLength(1);
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === 'Try loading address suggestions again')).toHaveLength(0);
  });

  it('an incomplete place (422) is explained inline, not in a (web no-op) Alert', async () => {
    api.buyer.addresses.autocomplete.mockResolvedValue(ROWS);
    api.buyer.addresses.resolveSuggestion.mockRejectedValue(httpError(422));
    const onSelect = render();
    type('350 Bedf');
    await flush();
    await act(async () => { suggestions()[0].props.onPress(); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(byTestId('address-resolve-error')).toHaveLength(1);
    expect(allText()).toContain('isn’t a full street address');
    // Typing again clears it.
    type('350 Bedford Av');
    expect(byTestId('address-resolve-error')).toHaveLength(0);
  });

  it('maps server errors to states and copy', () => {
    expect(searchStatusForError(httpError(503))).toBe('unavailable');
    expect(searchStatusForError(httpError(502))).toBe('error');
    expect(searchStatusForError(new TypeError('Network request failed'))).toBe('error');
    expect(resolveErrorMessage(httpError(422))).toMatch(/full street address/);
    expect(resolveErrorMessage(httpError(502))).toMatch(/couldn’t load/);
  });
});
