import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { surface: '#111', border: '#333', text: '#fff', muted: '#888' } }),
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/CachedImage', () => ({
  CachedImage: (props: Record<string, unknown>) => React.createElement('CachedImage', props),
}));

import { QuotedPostCard } from '../QuotedPostCard';

const post = (thumbnailUrl: string) => ({
  id: 'p1', userId: 'u1', author: { displayName: 'Ana', brandName: null, username: 'ana' },
  caption: 'hi', thumbnailUrl, mediaType: 'photo',
});

const images = (root: TestRenderer.ReactTestRenderer) =>
  root.root.findAll((n) => (n.type as unknown) === 'CachedImage').length;

describe('QuotedPostCard (audit)', () => {
  it('tries a new thumbnail again after an earlier one failed to load', async () => {
    let root!: TestRenderer.ReactTestRenderer;
    await act(async () => { root = TestRenderer.create(<QuotedPostCard quotedPost={post('https://cdn/a.jpg')} />); });
    expect(images(root)).toBe(1);
    const img = root.root.find((n) => (n.type as unknown) === 'CachedImage');
    await act(async () => { (img.props.onError as () => void)(); });
    expect(images(root)).toBe(0);
    // Same card instance now shows a different original (new thumbnail URL).
    await act(async () => { root.update(<QuotedPostCard quotedPost={post('https://cdn/b.jpg')} />); });
    expect(images(root)).toBe(1);
  });
});
