/**
 * App Store 1.2: every post "⋯" menu offers Block alongside Report.
 * Renders the shared Discover/Search menu and the feed long-press menu, and
 * guards the feed share sheet + post viewer wiring at the source level.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  Modal: nativeComponent('Modal'),
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  Pressable: nativeComponent('Pressable'),
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('expo-haptics', () => ({
  impactAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

import { DiscoverSafetyMenu } from '@/components/discover/DiscoverSafetyMenu';
import { LongPressMenu } from '@/components/buyer-feed/LongPressMenu';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

let tree: ReactTestRenderer;
const labels = () => tree.root.findAllByType('TouchableOpacity' as never).map((n) => n.props.accessibilityLabel as string);
const press = (label: string) => act(() => {
  tree.root.findAllByType('TouchableOpacity' as never).find((n) => n.props.accessibilityLabel === label)!.props.onPress();
});

describe('post menus offer Block', () => {
  afterEach(() => { act(() => tree?.unmount()); });

  it('Discover/Search menu shows "Block <author>" and calls onBlock then closes', () => {
    const onBlock = vi.fn();
    const onClose = vi.fn();
    act(() => {
      tree = create(
        <DiscoverSafetyMenu visible authorName="Maya" onNotInterested={vi.fn()} onMute={vi.fn()} onReport={vi.fn()} onBlock={onBlock} onClose={onClose} />,
      );
    });
    expect(labels()).toEqual(['Not interested', 'Mute Maya', 'Report', 'Block Maya']);
    press('Block Maya');
    expect(onBlock).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Discover/Search menu hides Block when the author cannot be blocked', () => {
    act(() => {
      tree = create(
        <DiscoverSafetyMenu visible authorName="Maya" onNotInterested={vi.fn()} onMute={vi.fn()} onReport={vi.fn()} onClose={vi.fn()} />,
      );
    });
    expect(labels()).not.toContain('Block Maya');
  });

  it('feed long-press menu adds Block after Report', () => {
    const onBlock = vi.fn();
    act(() => {
      tree = create(
        <LongPressMenu visible speedActive={false} onToggleSpeed={vi.fn()} onNotInterested={vi.fn()} onReport={vi.fn()} onBlock={onBlock} blockLabel="Block Maya" onClose={vi.fn()} />,
      );
    });
    expect(labels()).toEqual(['2x speed', 'Not interested', 'Report', 'Block Maya']);
    press('Block Maya');
    expect(onBlock).toHaveBeenCalledTimes(1);
  });

  it('feed share sheet, Discover, Search and the post viewer wire Block through the shared confirm flow', () => {
    expect(read('components/ThreadShareSheet.tsx')).toContain('<ShareAction label="Block"');
    const feed = read('app/(tabs)/feed.tsx');
    expect(feed).toContain('useBlockAction()');
    expect(feed).toMatch(/onBlock=\{onBlockCreator \?/);
    // Blocked authors disappear from the loaded feed immediately.
    expect(feed).toContain('prev.filter(post => post.sellerId !== blockedId)');
    for (const file of ['app/(buyer)/discover.tsx', 'app/buyer-search.tsx', 'app/buyer-post-viewer.tsx']) {
      const source = read(file);
      expect(source, file).toContain('useBlockAction()');
      expect(source, file).toContain('blockUser({ userId: ');
    }
  });
});
