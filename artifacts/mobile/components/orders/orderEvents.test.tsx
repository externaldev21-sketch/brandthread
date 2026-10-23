/**
 * Order events UI: the compact Ordered → Shipped → Delivered dots on order
 * cards, the seller's "Mark as shipped" form (carrier picker + tracking
 * number validation), and the buyer status mapping that drives the dots.
 */
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => {
    function C(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    C.displayName = name;
    return C;
  };
  const noopAnim = { start: vi.fn(), stop: vi.fn(), reset: vi.fn() };
  return {
    Animated: {
      Value: class { constructor(public v: number) {} },
      loop: () => noopAnim, sequence: () => noopAnim, timing: () => noopAnim,
      View: el('AnimatedView'),
    },
    StyleSheet: { create: (s: unknown) => s },
    Text: el('Text'),
    TextInput: el('TextInput'),
    TouchableOpacity: el('TouchableOpacity'),
    View: el('View'),
  };
});
vi.mock('@expo/vector-icons', () => ({
  Feather: Object.assign(({ name }: { name: string }) => React.createElement('Feather', { name }), { glyphMap: {} }),
}));
vi.mock('@/lib/theme', () => ({
  FONT: { regular: 'r', medium: 'm', semibold: 's', bold: 'b' },
  FS: { xs: 11, sm: 13, base: 15 },
  SP: { xs: 4, sm: 8, md: 16 },
  RADIUS: { sm: 10, pill: 999 },
  ICON: { xs: 12, sm: 16, md: 20 },
}));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      accent: '#A855F7', accentLight: '#D8B4FE', accentDim: '#A855F72E', onAccent: '#07080A',
      surface: '#111', border: '#222', text: '#FFF', muted: '#999', subtle: '#666', error: '#F87171',
    },
  }),
}));
vi.mock('@/components/BrandthreadUI', () => ({
  BrandthreadCard: ({ children, testID }: { children: React.ReactNode; testID?: string }) =>
    React.createElement('Card', { testID }, children),
  PrimaryButton: (props: { label: string; onPress: () => void; testID?: string }) =>
    React.createElement('PrimaryButton', props),
}));

import { OrderStatusTimeline, compactStageIndex } from './OrderStatusTimeline';
import { MarkShippedForm } from './MarkShippedForm';

const texts = (root: ReactTestInstance) =>
  root.findAll(n => (n.type as unknown) === 'Text').map(n => [n.props.children].flat().join(''));

function render(node: React.ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => { r = create(node); });
  return r;
}

describe('compact order progress dots', () => {
  it('labels the three order events Ordered / Shipped / Delivered', () => {
    const r = render(<OrderStatusTimeline status="new" compact />);
    expect(texts(r.root)).toEqual(['Ordered', 'Shipped', 'Delivered']);
  });

  it.each([
    ['new', 0], ['processing', 0], ['ready_to_ship', 0], ['shipped', 1], ['delivered', 2],
  ] as const)('puts a %s order on stage %i', (status, index) => {
    expect(compactStageIndex(status)).toBe(index);
    const r = render(<OrderStatusTimeline status={status} compact />);
    const row = r.root.findAll(n => n.props.accessibilityLabel?.startsWith?.('Order progress'))[0];
    expect(row.props.accessibilityLabel).toBe(`Order progress: ${['Ordered', 'Shipped', 'Delivered'][index]}`);
    // Completed stages carry a check; a delivered order is complete end to end.
    const checks = r.root.findAll(n => (n.type as unknown) === 'Feather' && n.props.name === 'check').length;
    expect(checks).toBe(status === 'delivered' ? 3 : index);
  });

  it('keeps the full five-stage tracker on the order detail screens', () => {
    const r = render(<OrderStatusTimeline status="shipped" />);
    expect(texts(r.root)).toEqual(['Placed', 'Packing', 'Ready', 'Shipped', 'Delivered']);
  });
});

describe('MarkShippedForm', () => {
  const find = (r: ReactTestRenderer, id: string) => r.root.find(n => n.props.testID === id && typeof n.type !== 'function' || (n.props.testID === id && (n.type as unknown) === 'PrimaryButton'));

  it('asks for a carrier, then rejects a malformed number without calling the server', async () => {
    const onSubmit = vi.fn(async () => null);
    const r = render(<MarkShippedForm onSubmit={onSubmit} />);
    await act(async () => { find(r, 'mark-shipped-submit').props.onPress(); });
    expect(texts(r.root)).toContain("Choose a carrier, or enter the carrier's name.");

    act(() => { find(r, 'carrier-ups').props.onPress(); });
    act(() => { find(r, 'tracking-number-input').props.onChangeText('12345'); });
    await act(async () => { find(r, 'mark-shipped-submit').props.onPress(); });
    expect(texts(r.root).some(t => t.startsWith("This doesn't look like a valid tracking number. UPS tracking numbers start with 1Z"))).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the carrier label and normalized number', async () => {
    const onSubmit = vi.fn(async () => null);
    const r = render(<MarkShippedForm onSubmit={onSubmit} />);
    act(() => { find(r, 'carrier-usps').props.onPress(); });
    act(() => { find(r, 'tracking-number-input').props.onChangeText('9400 1118 9922 3344 5566 77'); });
    await act(async () => { find(r, 'mark-shipped-submit').props.onPress(); });
    expect(onSubmit).toHaveBeenCalledWith('USPS', '9400111899223344556677');
  });

  it('takes the carrier name for Other and shows a server rejection under its field', async () => {
    const onSubmit = vi.fn(async () => ({ field: 'trackingNumber' as const, error: 'Server says no.' }));
    const r = render(<MarkShippedForm onSubmit={onSubmit} />);
    act(() => { find(r, 'carrier-other').props.onPress(); });
    act(() => { find(r, 'carrier-other-name').props.onChangeText('Local courier'); });
    act(() => { find(r, 'tracking-number-input').props.onChangeText('lc123456'); });
    await act(async () => { find(r, 'mark-shipped-submit').props.onPress(); });
    expect(onSubmit).toHaveBeenCalledWith('Local courier', 'LC123456');
    expect(texts(r.root)).toContain('Server says no.');
  });
});
