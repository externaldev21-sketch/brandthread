import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const sizes: Record<string, [number, number] | null> = {};

vi.mock('react-native', () => {
  const React = require('react') as typeof import('react');
  const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
  return {
    View: host('View'),
    Text: host('Text'),
    Image: {
      getSize: (uri: string, ok: (w: number, h: number) => void, fail: () => void) => {
        const s = sizes[uri];
        if (s) ok(s[0], s[1]); else fail();
      },
    },
    Dimensions: { get: () => ({ width: 393, height: 852 }) },
    Platform: { OS: 'ios' },
    StyleSheet: { create: (s: unknown) => s, absoluteFill: {} },
  };
});
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/BrandthreadUI', () => {
  const React = require('react') as typeof import('react');
  return { PressableScale: (props: Record<string, unknown>) => React.createElement('PressableScale', props, props.children as React.ReactNode) };
});
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', border: '#333', accent: '#fff', background: '#000' } }),
}));
vi.mock('@/lib/theme', () => ({ FONT: {}, FS: {}, SP: { lg: 24, md: 16, sm: 12, xl: 32 }, RADIUS: {}, TEXT_DISABLED: '#555' }));

import { MediaCropper } from './MediaCropper';

function doneButton(r: ReactTestRenderer) {
  return r.root.findAll((n) => n.props.testID === 'media-cropper-save' && n.type === ('PressableScale' as never))[0];
}

describe('MediaCropper', () => {
  it('does not keep the previous image size (and enable Done) after the source changes', () => {
    sizes['a.jpg'] = [1000, 1250];
    sizes['b.jpg'] = null; // still measuring / unreadable
    const props = { visible: true, targetRatio: 4 / 5, onCancel: () => {}, onSave: vi.fn() };
    let r!: ReactTestRenderer;
    act(() => { r = create(<MediaCropper {...props} uri="a.jpg" />); });
    expect(doneButton(r).props.disabled).toBe(false);
    act(() => { r.update(<MediaCropper {...props} uri="b.jpg" />); });
    expect(doneButton(r).props.disabled).toBe(true);
    act(() => { (doneButton(r).props.onPress as () => void)(); });
    expect(props.onSave).not.toHaveBeenCalled();
  });
});
