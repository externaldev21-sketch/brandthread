import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
}));

vi.mock('react-native', () => ({
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
}));
vi.mock('@/components/CachedImage', () => ({ CachedImage: nativeComponent('CachedImage') }));

import { ProductPhoto, ProductPhotoPlaceholder, brandInitial, PRODUCT_PLACEHOLDER_BG } from '@/components/media/ProductPhoto';
import { PRODUCT_PHOTO_ASPECT, productPhotoHeight } from '@/constants/media';

function layout(tree: ReactTestRenderer, width = 100, height = 125) {
  const tile = tree.root.findByProps({ testID: 'product-photo-placeholder' });
  act(() => { tile.props.onLayout({ nativeEvent: { layout: { width, height } } }); });
}

describe('product photo frame', () => {
  it('is 4:5 (width : height)', () => {
    expect(PRODUCT_PHOTO_ASPECT).toBe(0.8);
    expect(productPhotoHeight(84)).toBe(105);
    expect(productPhotoHeight(140)).toBe(175);
  });
});

describe('brandInitial', () => {
  it('uses the brand first, then the product name', () => {
    expect(brandInitial('orison studio', 'Ivory Column Set')).toBe('O');
    expect(brandInitial(undefined, 'ivory column set')).toBe('I');
    expect(brandInitial('  ', null, '22 Forme')).toBe('2');
  });
  it('skips leading punctuation and handles non-Latin letters', () => {
    expect(brandInitial('@kuro.line')).toBe('K');
    expect(brandInitial('é atelier')).toBe('É');
  });
  it('is empty when nothing usable is given', () => {
    expect(brandInitial(undefined, null, '—')).toBe('');
  });
});

describe('ProductPhotoPlaceholder', () => {
  it('is a flat dark tile with the brand initial — no icon, no text label', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = create(<ProductPhotoPlaceholder brand="Maison Vela" name="Linen Shirt" />); });
    layout(tree);
    const tile = tree.root.findByProps({ testID: 'product-photo-placeholder' });
    const style = [tile.props.style].flat(3).filter(Boolean);
    expect(style.some((s: { backgroundColor?: string }) => s.backgroundColor === PRODUCT_PLACEHOLDER_BG)).toBe(true);
    const texts = tree.root.findAll((n) => (n.type as unknown) === 'Text');
    expect(texts).toHaveLength(1);
    expect(texts[0].props.children).toBe('M');
    expect(tree.root.findAll((n) => (n.type as unknown) === 'Feather')).toHaveLength(0);
  });
});

describe('ProductPhoto', () => {
  it('shows the photo when there is one', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = create(<ProductPhoto uri="https://img.test/a.jpg" brand="Orison" />); });
    expect(tree.root.findAll((n) => (n.type as unknown) === 'CachedImage')).toHaveLength(1);
  });

  it('falls back to the placeholder with no uri', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = create(<ProductPhoto uri={null} brand="Orison" />); });
    expect(tree.root.findAll((n) => (n.type as unknown) === 'CachedImage')).toHaveLength(0);
    layout(tree);
    expect(tree.root.findAllByType('Text' as never)[0].props.children).toBe('O');
  });

  it('swaps to the placeholder when the photo fails to load', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = create(<ProductPhoto uri="https://img.test/broken.jpg" brand="Saint Rue" />); });
    const image = tree.root.find((n) => (n.type as unknown) === 'CachedImage');
    act(() => { image.props.onError(); });
    expect(tree.root.findAll((n) => (n.type as unknown) === 'CachedImage')).toHaveLength(0);
    layout(tree);
    expect(tree.root.findAllByType('Text' as never)[0].props.children).toBe('S');
  });
});
