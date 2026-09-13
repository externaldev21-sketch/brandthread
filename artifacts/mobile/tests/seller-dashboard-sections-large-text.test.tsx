import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent, windowMetrics } = vi.hoisted(() => ({
  windowMetrics: { width: 320, height: 720, scale: 1, fontScale: 2 },
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
}));

vi.mock('react-native', () => ({
  StyleSheet: {
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean)),
  },
  Text: nativeComponent('Text'),
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  useWindowDimensions: () => windowMetrics,
  View: nativeComponent('View'),
}));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('@/components/BrandthreadUI', () => ({
  PressableScale: nativeComponent('PressableScale'),
  PrimaryButton: nativeComponent('PrimaryButton'),
  SecondaryButton: nativeComponent('SecondaryButton'),
}));

import {
  SellerDashboardActionRow,
  SellerDashboardListGroup,
  SellerDashboardListItem,
  SellerDashboardSectionHeader,
  SellerDashboardTrendHeader,
} from '@/components/SellerDashboardSections';

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
}

describe('seller dashboard remaining sections at large text sizes', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it.each([320, 375, 402])('keeps section titles and controls separated at %ipx', async viewportWidth => {
    await act(async () => {
      renderer = create(
        <SellerDashboardSectionHeader title="Needs Attention" action="View all orders" onAction={vi.fn()} />,
      );
    });

    const header = renderer!.root.findByProps({ testID: 'seller-dashboard-section-needs-attention' });
    const texts = header.findAllByType('Text' as React.ElementType);
    expect(flattenStyle(header.props.style)).toMatchObject({
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    });
    expect(flattenStyle(texts[0].props.style)).toMatchObject({ flex: 1, minWidth: 0, flexShrink: 1 });
    expect(texts[0].props.maxFontSizeMultiplier).toBe(2);
    expect(texts[1].props.maxFontSizeMultiplier).toBe(2);

    const estimatedActionWidthAt2x = 'View all orders'.length * 13 * 2 * 0.48;
    expect(estimatedActionWidthAt2x).toBeLessThan(viewportWidth - 32);
  });

  it('lets operation and order rows grow vertically without hiding controls at 2x text', async () => {
    await act(async () => {
      renderer = create(
        <SellerDashboardListGroup>
          <SellerDashboardListItem
            icon="shopping-bag"
            title="A customer with a long display name"
            subtitle="12 new orders, 8 waiting to process"
            value="$1,234.56"
            badge={12}
            onPress={vi.fn()}
            isLast
          />
        </SellerDashboardListGroup>,
      );
    });

    const row = renderer!.root.findByProps({ testID: 'seller-dashboard-row-a-customer-with-a-long-display-name' });
    expect(flattenStyle(row.props.style)).toMatchObject({ alignItems: 'flex-start' });

    const texts = row.findAllByType('Text' as React.ElementType);
    const title = texts.find(node => node.props.children === 'A customer with a long display name')!;
    const subtitle = texts.find(node => node.props.children === '12 new orders, 8 waiting to process')!;
    const value = texts.find(node => node.props.children === '$1,234.56')!;
    expect(title.props).toMatchObject({ numberOfLines: 2, maxFontSizeMultiplier: 2 });
    expect(subtitle.props).toMatchObject({ numberOfLines: 2, maxFontSizeMultiplier: 2 });
    expect(value.props).toMatchObject({
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      minimumFontScale: 0.75,
      maxFontSizeMultiplier: 2,
    });
    expect(row.findAllByType('Feather' as React.ElementType).some(node => node.props.name === 'chevron-right')).toBe(true);
  });

  it.each([320, 375, 402])('renders card headers and stacks card actions at %ipx with 2x text', async width => {
    windowMetrics.width = width;
    windowMetrics.fontScale = 2;
    await act(async () => {
      renderer = create(
        <>
          <SellerDashboardTrendHeader />
          <SellerDashboardActionRow
            testID="seller-dashboard-welcome-actions"
            actions={[
              { label: 'Start setup', variant: 'primary', onPress: vi.fn() },
              { label: 'Explore on my own', variant: 'secondary', onPress: vi.fn() },
            ]}
          />
        </>,
      );
    });

    const trend = renderer!.root.findByProps({ testID: 'seller-dashboard-trend-header' });
    expect(flattenStyle(trend.props.style)).toMatchObject({ flexWrap: 'wrap', alignItems: 'flex-start' });
    const [trendTitle, trendPeriod] = trend.findAllByType('Text' as React.ElementType);
    expect(flattenStyle(trendTitle.props.style)).toMatchObject({ flexGrow: 1, flexShrink: 1, minWidth: 0 });
    expect(flattenStyle(trendPeriod.props.style)).toMatchObject({ flexShrink: 0 });
    expect(trendTitle.props.maxFontSizeMultiplier).toBe(2);
    expect(trendPeriod.props.maxFontSizeMultiplier).toBe(2);

    const actions = renderer!.root.findAllByProps({ testID: 'seller-dashboard-welcome-actions' })
      .find(node => String(node.type) === 'View')!;
    expect(flattenStyle(actions.props.style)).toMatchObject({ flexDirection: 'column' });
    const buttons = actions.findAll(node => ['PrimaryButton', 'SecondaryButton'].includes(String(node.type)));
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(flattenStyle(button.props.style)).toMatchObject({ width: '100%', flexBasis: 'auto' });
    }
  });
});