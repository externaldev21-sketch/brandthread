/**
 * Item 74 (photo/video send with upload progress ring) — focused tests for
 * the two pieces of real logic this item added:
 *
 *  1. UploadRing's indeterminate-arc math (components/chat/UploadRing.tsx) —
 *     uploadMedia() has no byte-level progress callback (a plain base64
 *     POST via fetch — see lib/api.ts), so the ring is intentionally a
 *     fixed-length spinning arc rather than a fabricated 0-100% fill. This
 *     pins that arc's geometry so a future edit can't quietly turn it into
 *     a full circle (which would just look like a static ring, not "in
 *     progress") or silently start filling to a percentage that isn't real.
 *  2. MediaUploadThumb's rendering rules (components/chat/MediaUploadThumb.tsx)
 *     — real thumbnail vs. placeholder, and the ring overlay appearing only
 *     while `uploading` is true.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function nativeComponent(name: string) {
  function MockNativeComponent(props: Record<string, unknown>) {
    return React.createElement(name, props, props.children as React.ReactNode);
  }
  MockNativeComponent.displayName = name;
  return MockNativeComponent;
}

vi.mock('react-native', () => ({
  View: nativeComponent('View'),
  StyleSheet: {
    create: (styles: unknown) => styles,
    absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  },
  Animated: {
    View: nativeComponent('RNAnimated.View'),
    Value: class { constructor(public v: number) {} interpolate() { return '0deg'; } },
    loop: () => ({ start: () => undefined, stop: () => undefined }),
    timing: () => ({ start: () => undefined }),
    createAnimatedComponent: (Component: unknown) => Component,
  },
  Easing: { linear: (t: number) => t },
}));

vi.mock('react-native-svg', () => ({
  default: nativeComponent('Svg'),
  Circle: nativeComponent('Circle'),
}));

vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));

vi.mock('@/components/CachedImage', () => ({ CachedImage: nativeComponent('CachedImage') }));

import UploadRing from '@/components/chat/UploadRing';
import MediaUploadThumb from '@/components/chat/MediaUploadThumb';

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(element); });
  return renderer;
}

describe('UploadRing — indeterminate arc math', () => {
  it('draws a fixed 28%-of-circumference arc (not a full ring, not a fill)', () => {
    const size = 28;
    const tree = render(<UploadRing size={size} color="#fff" />);
    const circles = tree.root.findAllByType('Circle' as never);
    // Only the spinning arc circle — no track circle when trackColor is omitted.
    expect(circles).toHaveLength(1);
    const radius = size / 2 - 2.5;
    const circumference = 2 * Math.PI * radius;
    const [arcLen, gap] = (circles[0].props.strokeDasharray as string).split(' ').map(Number);
    expect(arcLen).toBeCloseTo(circumference * 0.28, 5);
    expect(gap).toBeCloseTo(circumference, 5);
    // Never a full-circle dash (that would read as a static ring, not "in progress").
    expect(arcLen).toBeLessThan(gap);
  });

  it('renders a track circle only when trackColor is given', () => {
    const withTrack = render(<UploadRing size={24} color="#fff" trackColor="#333" />);
    expect(withTrack.root.findAllByType('Circle' as never)).toHaveLength(2);

    const withoutTrack = render(<UploadRing size={24} color="#fff" />);
    expect(withoutTrack.root.findAllByType('Circle' as never)).toHaveLength(1);
  });

  it('scales its radius (and so its circumference) with size, staying inset by the stroke width', () => {
    const small = render(<UploadRing size={20} color="#fff" />);
    const big = render(<UploadRing size={40} color="#fff" />);
    const rSmall = small.root.findByType('Circle' as never).props.r as number;
    const rBig = big.root.findByType('Circle' as never).props.r as number;
    expect(rSmall).toBeCloseTo(20 / 2 - 2.5, 5);
    expect(rBig).toBeCloseTo(40 / 2 - 2.5, 5);
    expect(rBig).toBeGreaterThan(rSmall);
  });
});

describe('MediaUploadThumb — real thumbnail vs. placeholder, ring only while uploading', () => {
  const colors = { ringColor: '#8B5CF6', iconColor: '#8A8A8E', trackColor: '#2A2A2E' };

  it('image type with a uri: shows the real thumbnail, no placeholder glyph', () => {
    const tree = render(
      <MediaUploadThumb type="image" uri="file:///local/picked-photo.jpg" uploading={false} {...colors} />,
    );
    const img = tree.root.findByType('CachedImage' as never);
    expect(img.props.source).toEqual({ uri: 'file:///local/picked-photo.jpg' });
    expect(tree.root.findAllByType('Feather' as never)).toHaveLength(0);
  });

  it('video type: always shows the placeholder glyph, never attempts an image thumbnail', () => {
    const tree = render(
      <MediaUploadThumb type="video" uri="https://cdn.example.com/clip.mp4" uploading={false} {...colors} />,
    );
    expect(tree.root.findAllByType('CachedImage' as never)).toHaveLength(0);
    const icon = tree.root.findByType('Feather' as never);
    expect(icon.props.name).toBe('video');
  });

  it('image type with no uri yet (picker resolved but no local uri): falls back to the placeholder glyph', () => {
    const tree = render(<MediaUploadThumb type="image" uploading uri={undefined} {...colors} />);
    expect(tree.root.findAllByType('CachedImage' as never)).toHaveLength(0);
    expect(tree.root.findByType('Feather' as never).props.name).toBe('image');
  });

  it('shows the UploadRing overlay only while uploading=true', () => {
    const uploading = render(
      <MediaUploadThumb type="image" uri="file:///x.jpg" uploading {...colors} />,
    );
    expect(uploading.root.findAllByProps({ testID: 'media-upload-thumb-overlay' }).length).toBeGreaterThan(0);
    expect(uploading.root.findAllByType('Circle' as never).length).toBeGreaterThan(0);

    const resting = render(
      <MediaUploadThumb type="image" uri="file:///x.jpg" uploading={false} {...colors} />,
    );
    expect(resting.root.findAllByProps({ testID: 'media-upload-thumb-overlay' })).toHaveLength(0);
    expect(resting.root.findAllByType('Circle' as never)).toHaveLength(0);
  });

  it('the uploading ring overlay is always white (monochrome dark-overlay treatment, not a new accent)', () => {
    const tree = render(
      <MediaUploadThumb type="image" uri="file:///x.jpg" uploading ringColor="#8B5CF6" iconColor="#8A8A8E" trackColor="#2A2A2E" />,
    );
    expect(tree.root.findByType('Circle' as never).props.stroke).toBe('#fff');
  });
});
