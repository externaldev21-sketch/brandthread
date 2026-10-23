import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  availability: 'available',
  provider: { id: 'test', listLive: vi.fn(), listUpcoming: vi.fn(), setReminder: vi.fn() },
}));
// Deliberately fail if the directory tries to use a navigation-screen context.
vi.mock('@react-navigation/native', () => ({
  useFocusEffect: () => { throw new Error('No navigation context'); },
  useNavigation: () => { throw new Error('No navigation context'); },
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: null }) }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: {} }) }));
vi.mock('@/lib/live/liveProvider', () => ({ getLiveStreamProvider: () => state.provider }));
vi.mock('@/lib/live/useLiveAvailability', () => ({ useLiveAvailability: () => state.availability }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/ui/ThemedRefreshControl', () => ({ ThemedRefreshControl: () => null }));
vi.mock('@/components/live/LiveOverlays', () => ({ LiveHostAvatar: () => null }));
vi.mock('@/components/live/LiveAvatarRing', () => ({ LIVE_RED: '#f00' }));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
  FlatList: (props: { data: unknown[]; ListEmptyComponent: React.ReactNode }) =>
    React.createElement('FlatList', props, props.data.length ? null : props.ListEmptyComponent),
  StyleSheet: { create: (v: unknown) => v, absoluteFill: {} },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
import { LiveShowsGrid } from '@/components/live/LiveShowsGrid';

describe('LIVE directory without a navigation screen', () => {
  let tree: ReactTestRenderer | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    state.availability = 'available';
    state.provider.id = `test-${Math.random()}`;
    state.provider.listLive.mockReset().mockResolvedValue([]);
    state.provider.listUpcoming.mockReset().mockResolvedValue([]);
  });
  afterEach(async () => {
    if (tree) await act(async () => tree!.unmount());
    tree = undefined;
    vi.useRealTimers();
  });
  const render = async (active: boolean) => {
    await act(async () => {
      tree = create(<LiveShowsGrid active={active} onOpenShow={() => {}} />);
    });
  };
  const text = () => tree!.root.findAllByType('Text' as never).map(node => node.props.children).join(' ');
  it('loads and renders the quiet empty state without navigation hooks', async () => {
    await render(true);
    expect(state.provider.listLive).toHaveBeenCalledTimes(1);
    expect(text()).toContain("No one's live right now");
  });
  it('loads on activation and stops polling when inactive', async () => {
    await render(false);
    expect(state.provider.listLive).not.toHaveBeenCalled();
    await act(async () => tree!.update(<LiveShowsGrid active onOpenShow={() => {}} />));
    expect(state.provider.listLive).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(state.provider.listLive).toHaveBeenCalledTimes(2);
    await act(async () => tree!.update(<LiveShowsGrid active={false} onOpenShow={() => {}} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(state.provider.listLive).toHaveBeenCalledTimes(2);
  });
  it.each([404, 502])('renders a retry state rather than crashing on HTTP %s', async status => {
    state.provider.listLive.mockRejectedValue(new Error(`HTTP ${status}`));
    await render(true);
    expect(text()).toContain("Couldn't load live shows");
    expect(text()).toContain('Try again');
  });
  it('does not apply a late response after deactivation', async () => {
    let resolve!: (value: unknown[]) => void;
    state.provider.listLive.mockImplementation(() => new Promise(r => { resolve = r; }));
    await render(true);
    await act(async () => tree!.update(<LiveShowsGrid active={false} onOpenShow={() => {}} />));
    await act(async () => resolve([]));
    expect(tree!.root.findAllByProps({ testID: 'live-grid-empty' })).toHaveLength(0);
  });
  it('renders the existing unavailable notice when streaming is not configured', async () => {
    state.availability = 'unavailable';
    await render(true);
    expect(tree!.root.findAllByProps({ testID: 'live-grid-unavailable' })).toHaveLength(1);
    expect(state.provider.listLive).not.toHaveBeenCalled();
  });
});
