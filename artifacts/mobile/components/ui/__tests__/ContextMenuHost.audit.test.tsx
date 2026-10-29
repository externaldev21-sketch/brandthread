/**
 * The long-press preview menu must never render a bare string as a child of
 * a View: on iOS/Android that throws "Text strings must be rendered within a
 * <Text> component" and takes the whole menu down. A `// comment` written
 * after a JSX element (instead of `{/* … *\/}`) becomes exactly such a string.
 */
import React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      id: 'monochrome', background: '#0A0A0B', text: '#fff', muted: '#999', card: '#111',
      cardElevated: '#1C1C1E', border: '#333', error: '#f00', shadowColor: '#000',
    },
  }),
}));
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 0 }));
vi.mock('@/hooks/useReduceMotion', () => ({ useReduceMotion: () => false }));
vi.mock('@/lib/haptics', () => ({ haptics: { rigid: () => {} } }));
vi.mock('@/constants/motion', () => ({ springTo: () => ({ start: () => {} }) }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/lib/a11y/modal', () => ({ a11yModalProps: () => ({}) }));
vi.mock('@/lib/contextMenu', () => ({
  closeContextMenu: () => {},
  closePullDownMenu: () => {},
  placePullDown: () => ({ left: 0, top: 0, origin: 'right' }),
  previewAspectRatio: () => 1,
  subscribeMenus: (fn: (s: unknown) => void) => {
    fn({
      context: {
        id: 'ctx-1',
        preview: { title: 'Post', imageUri: 'https://cdn.test/p.jpg', aspectRatio: 1 },
        items: [{ label: 'Share', onPress: () => {} }],
      },
      pullDown: null,
    });
    return () => {};
  },
}));

import { ContextMenuHost } from '../ContextMenuHost';

function strayStrings(node: ReactTestInstance): string[] {
  const out: string[] = [];
  const isText = typeof node.type === 'string' && /Text$/.test(node.type);
  for (const child of node.children) {
    if (typeof child === 'string') {
      if (!isText && child.trim()) out.push(child);
    } else {
      out.push(...strayStrings(child));
    }
  }
  return out;
}

describe('ContextMenuHost preview menu', () => {
  it('renders no raw text outside a <Text> (native would throw)', () => {
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<ContextMenuHost />); });
    expect(strayStrings(renderer.root)).toEqual([]);
    act(() => renderer.unmount());
  });
});
