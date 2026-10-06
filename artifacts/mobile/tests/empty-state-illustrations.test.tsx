/**
 * Regression coverage for the "FEEL 10x better" empty-state illustration
 * pass: every empty-state used to render the same generic icon-in-a-square
 * with two decorative dots (see the old `esS.artCard`/`spark*` styles in
 * BrandthreadUI.tsx). This replaces that with one shared set of monochrome
 * thread-motif line illustrations (components/illustrations/EmptyStateArt.tsx)
 * wired into the ten screens the owner named, with copy/CTA layout unchanged.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { create, act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false) },
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
}));

const { ThreadIllustration } = await import('@/components/illustrations/EmptyStateArt');
type ThreadMotif = Parameters<typeof ThreadIllustration>[0]['motif'];

const MOTIFS: ThreadMotif[] = [
  'hanger', 'spool', 'friends', 'search', 'trending', 'envelope', 'bell', 'tee', 'bookmark', 'heart',
];

describe('ThreadIllustration', () => {
  it.each(MOTIFS)('renders the %s motif without throwing', (motif) => {
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<ThreadIllustration motif={motif} animated={false} />);
    });
    expect(renderer!.toJSON()).toBeTruthy();
  });
});

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');

describe('the old colored icon-in-a-square + two dots decoration is gone', () => {
  it('BrandthreadUI EmptyState no longer renders the gradient artCard / orbit / spark dots', () => {
    const src = read('../components/BrandthreadUI.tsx');
    expect(src).not.toContain('esS.orbit');
    expect(src).not.toContain('esS.spark');
    expect(src).not.toContain('esS.artCard');
    // Every empty state now draws the one shared badge (2px silver ring,
    // optically-centred Feather-family stroke icon).
    expect(src).toContain('<EmptyStateBadge');
  });
});

describe('each named screen wires its thread-motif illustration through the shared EmptyState', () => {
  const cases: [path: string, needle: string][] = [
    ['../app/(buyer)/cart.tsx', "motif=\"hanger\""],
    ['../components/profile/profileEmptyStates.ts', "illustration: 'spool'"],
    ['../app/(buyer)/friends.tsx', 'illustration="friends"'],
    ['../app/buyer-search.tsx', 'illustration="search"'],
    ['../components/discover/DiscoverGrid.tsx', 'illustration="trending"'],
    ['../app/(buyer)/inbox.tsx', 'illustration="envelope"'],
    ['../app/activity-center.tsx', 'illustration="bell"'],
    ['../app/(buyer)/orders.tsx', 'illustration="tee"'],
    ['../app/buyer-saved.tsx', 'illustration="bookmark"'],
  ];

  it.each(cases)('%s references %s', (path, needle) => {
    expect(read(path)).toContain(needle);
  });

  it('the profile Liked tab maps to the stitched-heart motif', () => {
    const src = read('../components/profile/profileEmptyStates.ts');
    const likedBlock = src.slice(src.indexOf("'buyer:liked': {"), src.indexOf("'buyer:orders': {"));
    expect(likedBlock).toContain("illustration: 'heart'");
  });
});
