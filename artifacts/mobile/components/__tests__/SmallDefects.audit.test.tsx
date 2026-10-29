import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = {
  accent: '#fff', accentLight: '#eee', accentDim: '#333', secondaryDim: '#222', onAccent: '#000', text: '#fff',
  background: '#000', border: '#111', cardElevated: '#222', error: '#f00', primaryGradient: ['#fff', '#eee'],
};
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme }), getOnAccentTextStyle: () => ({}) }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ elevated: '#111', border: '#222', foreground: '#fff', success: '#0f0' }) }));

const mentionSearch = vi.fn();
vi.mock('@/lib/api', () => ({ useApi: () => api }));
const api = { social: { mentionSearch } };

vi.mock('@/components/share-cards/CoppedShareCard', () => ({ CoppedShareCard: () => null }));
vi.mock('@/lib/shareCard', () => ({
  captureCardAtNaturalSize: vi.fn(), captureShareCard: vi.fn(), saveCardImageToLibrary: vi.fn(),
  shareCardToInstagramStories: vi.fn(), triggerWebImageDownload: vi.fn(),
}));
vi.mock('@/components/share-cards/ShareCardFrame', () => ({ CARD_PREVIEW_HEIGHT: 400, CARD_PREVIEW_WIDTH: 300 }));
vi.mock('@/lib/haptics', () => ({
  haptic: () => {}, haptics: {}, hapticLight: () => {}, hapticSuccess: () => {}, hapticError: () => {}, hapticSelection: () => {},
}));

import { UndoToastProvider, useUndoToast } from '../BrandthreadUI';
import { MentionSuggestionsBar } from '../MentionPickerSheet';
import { CoppedShareSheet } from '../CoppedShareSheet';

afterEach(() => { vi.useRealTimers(); });

function textOf(r: ReactTestRenderer): string { return JSON.stringify(r.toJSON()); }

describe('UndoToastProvider', () => {
  it('keeps a newer toast that was shown while an earlier undo was in flight', async () => {
    let api!: ReturnType<typeof useUndoToast>;
    function Grab() { api = useUndoToast(); return null; }
    let finishUndo: () => void = () => {};
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<UndoToastProvider><Grab /></UndoToastProvider>); });
    await act(async () => {
      api.showUndo({ message: 'Removed A', undo: () => new Promise<void>((res) => { finishUndo = res; }) });
    });
    const undoButton = r.root.find((n) => n.props.accessibilityLabel === 'Undo: Removed A' && typeof n.props.onPress === 'function');
    let pending!: Promise<void>;
    await act(async () => { pending = undoButton.props.onPress(); });
    await act(async () => { api.showUndo({ message: 'Removed B', undo: () => {} }); });
    await act(async () => { finishUndo(); await pending; });
    expect(textOf(r)).toContain('Removed B');
    act(() => { r.unmount(); });
  });
});

describe('MentionSuggestionsBar', () => {
  it('a read that finishes after the strip closed never shows up when it reopens', async () => {
    vi.useFakeTimers();
    const resolvers: Array<(rows: unknown[]) => void> = [];
    mentionSearch.mockImplementation(() => new Promise((res) => { resolvers.push(res); }));
    const props = { enabled: true, onPick: () => {} };
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<MentionSuggestionsBar query="ab" active {...props} />); });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(resolvers).toHaveLength(1);
    await act(async () => { r.update(<MentionSuggestionsBar query="ab" active={false} {...props} />); });
    await act(async () => {
      resolvers[0]([{ userId: 'u1', username: 'stale_ab', name: 'Stale', isFollowing: false, initials: 'S' }]);
    });
    await act(async () => { r.update(<MentionSuggestionsBar query="c" active {...props} />); });
    expect(textOf(r)).not.toContain('stale_ab');
    act(() => { r.unmount(); });
  });
});

describe('CoppedShareSheet', () => {
  it('clears its "Copied" reset timer on unmount', async () => {
    vi.useFakeTimers();
    let r!: ReactTestRenderer;
    const data = { url: 'https://brandthread.app/p/1' } as any;
    await act(async () => { r = create(<CoppedShareSheet visible data={data} onClose={() => {}} />); });
    const copy = r.root.find((n) => n.props.testID === 'copped-share-copy' && typeof n.props.onPress === 'function');
    await act(async () => { copy.props.onPress(); await vi.dynamicImportSettled(); for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
    // The 2s "Copied" reset timer is now pending (tile labels sit inside
    // PressableScale's render-prop children, which the shim does not render).
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => { r.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
  });
});
