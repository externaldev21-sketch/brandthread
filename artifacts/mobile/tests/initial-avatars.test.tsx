import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
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
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('@/components/CachedImage', () => ({ CachedImage: nativeComponent('CachedImage') }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { accentDim: '#222', accent: '#fff', accentLight: '#ddd' } }),
}));

import { Avatar } from '@/components/ui/Avatar';
import { initialsOf } from '@/lib/initials';

const root = path.resolve(__dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('initialsOf (item 50)', () => {
  it('takes up to two letters from the first words', () => {
    expect(initialsOf('Maya Okafor')).toBe('MO');
    expect(initialsOf('northline studio co')).toBe('NS');
    expect(initialsOf('Orison')).toBe('O');
    expect(initialsOf('Maya Okafor', 1)).toBe('M');
  });
  it('skips handles and punctuation, keeps digits and accents', () => {
    expect(initialsOf('@kuro.line')).toBe('K');
    expect(initialsOf('Forme 22')).toBe('F2');
    expect(initialsOf('élan — studio')).toBe('ÉS');
  });
  it('is empty with nothing usable', () => {
    expect(initialsOf(undefined)).toBe('');
    expect(initialsOf('   ')).toBe('');
  });
});

describe('Avatar', () => {
  it('falls back to initials when the photo fails to load', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = create(<Avatar uri="https://img.test/broken.jpg" name="Jordan Reyes" />); });
    const image = tree.root.find((n) => (n.type as unknown) === 'CachedImage');
    act(() => { image.props.onError(); });
    expect(tree.root.findAll((n) => (n.type as unknown) === 'CachedImage')).toHaveLength(0);
    expect(tree.root.find((n) => (n.type as unknown) === 'Text').props.children).toBe('JR');
  });
});

describe('no generic person glyph where an avatar belongs', () => {
  it.each([
    ['app/link-in-bio.tsx'],
    ['components/live/LiveModerationOverlays.tsx'],
    ['app/product-store.tsx'],
    ['components/buyer-feed/CaptionBlock.tsx'],
  ])('%s', (file) => {
    expect(read(file)).not.toMatch(/<Feather name="user"/);
  });
  it('brand rows in search show the brand initials, not a bag icon', () => {
    const row = read('components/search/BrandRow.tsx');
    expect(row).toContain('{brand.initials}');
    expect(row).not.toContain('name="shopping-bag"');
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === '__tests__') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('no stock or AI-generated people (item 47)', () => {
  it('no stock-photo or fake-face hosts anywhere in the app', () => {
    const hits = ['app', 'components', 'lib', 'services', 'hooks']
      .flatMap((dir) => walk(path.join(root, dir)))
      .filter((file) => /['"`]https?:\/\/(?:[\w-]+\.)*(?:unsplash\.com|pexels\.com|pravatar\.cc|randomuser\.me|ui-avatars\.com|picsum\.photos|thispersondoesnotexist\.com)/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));
    expect(hits).toEqual([]);
  });
  it('preview people never use the AI runway posters as their face', () => {
    expect(read('lib/previewActivity.ts')).not.toMatch(/avatarUrl: posterUri/);
    expect(read('lib/previewStories.ts')).not.toMatch(/avatarUrl: posterUri/);
    expect(read('lib/previewComments.ts')).not.toContain('fashion_runway');
    expect(read('lib/previewInbox.ts')).not.toContain('return posterUri(seed.posterIndex)');
    expect(read('app/live-feed.tsx')).not.toMatch(/avatar: require\('\.\.\/assets\/videos\/fashion_runway/);
  });
  it('a real search never blends in the bundled sample posts or products', () => {
    const search = read('app/buyer-search.tsx');
    expect(search).toContain('(previewMode && trimmedQuery.length > 0 ? PREVIEW_VIDEOS');
    expect(search).toContain('(previewMode && trimmedQuery.length > 0 && activeFilterCount === 0 ? PREVIEW_PRODUCTS');
  });
  it('release builds never download the sample runway clip', () => {
    const feed = read('app/(tabs)/feed.tsx');
    expect(feed).toContain('if (__DEV__ && FASHION_PREVIEW_POSTER_URIS[0])');
    expect(feed).toContain('if (__DEV__ && FASHION_PREVIEW_VIDEO_URIS[0])');
  });
});
