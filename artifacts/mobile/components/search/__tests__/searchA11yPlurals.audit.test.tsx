/** Audit (chunk 09): spoken labels say "1 follower" / "1 post", not "1 followers" / "1 posts". */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', surface: '#111', border: '#333', shadowColor: '#000', onAccent: '#000' } }) }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

import { BrandCard } from '../BrandCard';
import { TagRow } from '../TagRow';

function label(r: ReactTestRenderer) {
  return r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string')[0].props.accessibilityLabel as string;
}

describe('search a11y labels', () => {
  it('BrandCard: one follower', async () => {
    let r!: ReactTestRenderer;
    const brand = { name: 'Acme', followerCount: 1, handle: '@acme', initials: 'A', color: '#123456' };
    await act(async () => { r = create(<BrandCard brand={brand as never} width={120} onPress={() => {}} />); });
    expect(label(r)).toBe('Visit Acme, 1 follower');
  });

  it('BrandCard: many followers', async () => {
    let r!: ReactTestRenderer;
    const brand = { name: 'Acme', followerCount: 2, handle: '@acme', initials: 'A', color: '#123456' };
    await act(async () => { r = create(<BrandCard brand={brand as never} width={120} onPress={() => {}} />); });
    expect(label(r)).toBe('Visit Acme, 2 followers');
  });

  it('TagRow: one post', async () => {
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<TagRow tag={{ tag: 'y2k', postCount: 1 }} onPress={() => {}} />); });
    expect(label(r)).toBe('#y2k, 1 post');
  });
});
