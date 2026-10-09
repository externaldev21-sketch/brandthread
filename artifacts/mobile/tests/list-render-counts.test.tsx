/**
 * Render counts per like — "never a lag or glitch" means liking one row must
 * not re-render every other row in the list.
 *
 *  - Feed: SpotlightPage is React.memo'd with spotlightPagePropsEqual
 *    (lib/feedPageMemo.ts). The harness below mounts five pages through that
 *    exact comparator and likes one, once with handlers that depend on the
 *    engagements state (the old wiring) and once with handlers that read it
 *    through a ref (the current wiring in app/(tabs)/feed.tsx).
 *  - Product grid: a save (the grid's "like") goes through the savedProducts
 *    external store; each SaveHeart subscribes to its own boolean, so only
 *    the toggled heart re-renders.
 */
import React, { Profiler, useCallback, useRef, useState } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { spotlightPagePropsEqual, type FeedEngagement } from '@/lib/feedPageMemo';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Pressable: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('Pressable', props, children),
}));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { card: '#111', border: '#222', text: '#fff' } }),
}));
vi.mock('@/components/ui/IconFillTransition', () => ({
  IconFillTransition: ({ active }: { active: boolean }) => React.createElement('Icon', { active }),
}));
vi.mock('@/lib/haptics', () => ({ hapticLight: () => {}, hapticMedium: () => {} }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: false, userId: null }) }));
vi.mock('@/services/socialService', () => ({
  getSavedItems: async () => [],
  saveItem: async () => ({}),
  removeSavedItem: async () => ({}),
}));

// ─── Feed harness ────────────────────────────────────────────────────────────

const POSTS = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
const BASE: FeedEngagement = { liked: false, likes: 3, saved: false, saves: 0, reposted: false, reposts: 0, following: false };

type PageProps = {
  item: { id: string };
  isActive: boolean;
  engagement: FeedEngagement;
  soundOn: boolean;
  onLike: (id: string) => void;
  onRender: (id: string) => void;
};

function PageImpl({ item, onRender }: PageProps) {
  onRender(item.id);
  return React.createElement('Page', { id: item.id });
}
const Page = React.memo(PageImpl, spotlightPagePropsEqual);

function FeedHarness({ stableHandlers, onRender, likeRef }: {
  stableHandlers: boolean;
  onRender: (id: string) => void;
  likeRef: { current: ((id: string) => void) | null };
}) {
  const [engagements, setEngagements] = useState<Record<string, FeedEngagement>>({});
  const engagementsRef = useRef(engagements);
  engagementsRef.current = engagements;
  const toggle = (snapshot: FeedEngagement, id: string) => {
    setEngagements((prev) => ({ ...prev, [id]: { ...snapshot, liked: !snapshot.liked, likes: snapshot.likes + 1 } }));
  };
  // Old wiring: the handler closes over `engagements`, so it is recreated on every like.
  const unstableLike = useCallback((id: string) => toggle(engagements[id] ?? BASE, id), [engagements]);
  // Current wiring: read through a ref, identity never changes.
  const stableLike = useCallback((id: string) => toggle(engagementsRef.current[id] ?? BASE, id), []);
  const onLike = stableHandlers ? stableLike : unstableLike;
  likeRef.current = onLike;
  return React.createElement(React.Fragment, null, POSTS.map((post) => React.createElement(Page, {
    key: post.id,
    item: post,
    isActive: post.id === 'a',
    // A fresh object for un-engaged posts every render, exactly like the feed's call site.
    engagement: engagements[post.id] ?? { ...BASE },
    soundOn: false,
    onLike,
    onRender,
  })));
}

function rendersPerLike(stableHandlers: boolean): Record<string, number> {
  const counts: Record<string, number> = {};
  const onRender = (id: string) => { counts[id] = (counts[id] ?? 0) + 1; };
  const likeRef: { current: ((id: string) => void) | null } = { current: null };
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(React.createElement(FeedHarness, { stableHandlers, onRender, likeRef })); });
  for (const key of Object.keys(counts)) delete counts[key];
  act(() => { likeRef.current?.('c'); });
  act(() => { tree.unmount(); });
  return counts;
}

describe('feed: render counts per like', () => {
  it('re-renders every mounted page when the like handler depends on engagements (old wiring)', () => {
    const counts = rendersPerLike(false);
    expect(Object.keys(counts).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('re-renders only the liked page with ref-stable handlers (current wiring)', () => {
    const counts = rendersPerLike(true);
    expect(counts).toEqual({ c: 1 });
  });

  it('compares engagement by value, so an un-engaged page with a fresh object does not re-render', () => {
    const handler = () => {};
    const base = { item: POSTS[0], isActive: false, soundOn: false, onLike: handler };
    expect(spotlightPagePropsEqual({ ...base, engagement: { ...BASE } }, { ...base, engagement: { ...BASE } })).toBe(true);
    expect(spotlightPagePropsEqual({ ...base, engagement: { ...BASE } }, { ...base, engagement: { ...BASE, liked: true } })).toBe(false);
    expect(spotlightPagePropsEqual({ ...base, engagement: BASE }, { ...base, engagement: BASE, onLike: () => {} })).toBe(false);
  });
});

// ─── Product grid hearts ────────────────────────────────────────────────────

describe('product grid: render counts per save', () => {
  it('re-renders only the saved product\'s heart', async () => {
    const { SaveHeart } = await import('@/components/SaveHeart');
    const { savedProducts } = await import('@/lib/saved/savedProducts');
    const counts: Record<string, number> = {};
    const onRender = (id: string) => { counts[id] = (counts[id] ?? 0) + 1; };
    const ids = ['p1', 'p2', 'p3', 'p4'];
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(React.createElement(React.Fragment, null, ids.map((id) => React.createElement(
        Profiler,
        { key: id, id, onRender },
        React.createElement(SaveHeart, { productId: id, title: `Product ${id}` }),
      ))));
    });
    for (const key of Object.keys(counts)) delete counts[key];
    act(() => { savedProducts.markSaved('p2'); });
    expect(counts).toEqual({ p2: 1 });
    const icons = tree.root.findAll((node) => String(node.type) === 'Icon');
    expect(icons.map((node) => node.props.active)).toEqual([false, true, false, false]);
    act(() => { tree.unmount(); });
  });
});
