import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children as React.ReactNode);
  return {
    View: host('View'),
    Text: host('Text'),
    Image: host('Image'),
    Pressable: (props: Record<string, unknown>) => React.createElement('Pressable', {
      ...props,
      style: typeof props.style === 'function' ? (props.style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : props.style,
    }, props.children as React.ReactNode),
    StyleSheet: { create: <T,>(s: T) => s, absoluteFill: {} },
    Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
  };
});
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/live/LiveAvatarRing', () => ({ LiveHostRing: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/live/useLiveDirectory', () => ({ useLiveStreamForHost: () => null }));

import { RightActionRail } from './RightActionRail';

function render(engagement: { likes?: number; saves?: number; liked?: boolean; saved?: boolean }) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <RightActionRail
        creator="Northline" avatarColor="#333" initials="N" engagement={engagement}
        commentsCount={0} shares={0} saves={0} testIdBase="p1"
        onOpenCreator={vi.fn()} onFollow={vi.fn()} onLike={vi.fn()} onOpenComments={vi.fn()} onSave={vi.fn()} onShare={vi.fn()}
      />,
    );
  });
  return tree;
}
const label = (tree: ReactTestRenderer, testID: string) =>
  tree.root.findAll(n => n.props.testID === testID && typeof n.type === 'string')[0].props.accessibilityLabel;

describe('RightActionRail accessibility counts (audit)', () => {
  it('reads one like / one save in the singular', () => {
    const tree = render({ likes: 1, saves: 1 });
    expect(label(tree, 'like-btn-p1')).toBe('Like, 1 like');
    expect(label(tree, 'save-btn-p1')).toBe('Save, 1 save');
  });
  it('keeps the plural for every other count', () => {
    const tree = render({ likes: 0, saves: 12, liked: true, saved: true });
    expect(label(tree, 'like-btn-p1')).toBe('Unlike, 0 likes');
    expect(label(tree, 'save-btn-p1')).toBe('Unsave, 12 saves');
  });
});
