import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockUser: { imageUrl?: string } | null = { imageUrl: 'https://img.example/me.png' };
vi.mock('@clerk/expo', () => ({ useUser: () => ({ user: mockUser }) }));
vi.mock('@/components/ui/BottomSheet', () => ({
  Sheet: ({ children, visible, primaryAction, ...rest }: any) =>
    visible ? React.createElement('Sheet', { ...rest, primaryAction }, children) : null,
}));
vi.mock('@/components/CachedImage', () => ({ CachedImage: (p: any) => React.createElement('CachedImage', p) }));

const { RepostEducationSheet } = await import('../components/RepostEducationSheet');

const texts = (t: ReactTestRenderer) =>
  t.root.findAll((n) => typeof n.props.children === 'string').map((n) => n.props.children as string);

describe('RepostEducationSheet', () => {
  it('renders the reference hierarchy with the real avatar', async () => {
    const onClose = vi.fn();
    let t!: ReactTestRenderer;
    await act(async () => { t = create(<RepostEducationSheet visible onClose={onClose} />); });
    const all = texts(t);
    expect(all).toContain('You reposted');
    expect(all).toContain('Introduce this post to others by reposting');
    expect(all).toContain('It will appear on your profile');
    expect(all).toContain('Use the Repost button to repost or remove repost at any time');
    expect(all).toContain('Only mutual friends can see your profile on a repost.');
    const img = t.root.find((n) => n.props.testID === 'repost-education-avatar' && n.props.source);
    expect(img.props.source.uri).toBe('https://img.example/me.png');
    const sheet = t.root.find((n) => n.props.testID === 'repost-education-sheet' && n.props.primaryAction);
    expect(sheet.props.primaryAction.label).toBe('OK');
    sheet.props.primaryAction.onPress();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('falls back to a neutral icon with no avatar and renders nothing when hidden', async () => {
    mockUser = null;
    let t!: ReactTestRenderer;
    await act(async () => { t = create(<RepostEducationSheet visible onClose={() => {}} />); });
    expect(t.root.findAll((n) => n.props.testID === 'repost-education-avatar-fallback').length).toBeGreaterThan(0);
    await act(async () => { t.update(<RepostEducationSheet visible={false} onClose={() => {}} />); });
    expect(t.toJSON()).toBeNull();
  });
});
