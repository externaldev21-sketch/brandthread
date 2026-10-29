/**
 * Audit regression: after a "Save video" settles, the sheet hides its
 * progress bar with a 450ms timer. That timer was never cleared, so closing
 * the feed page (or the account-switch remount) within that window left a
 * timer that set state on an unmounted sheet.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/ui/BottomSheet', () => {
  const R = require('react') as typeof import('react');
  return { Sheet: ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children) };
});
vi.mock('@/components/ShareContactPicker', () => ({ ShareContactPicker: () => null }));
vi.mock('@/services/socialService', () => ({
  createOrGetConversation: vi.fn(), getAcceptedFriends: vi.fn(async () => []),
  getConversations: vi.fn(async () => []), sendMessage: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ useApi: () => ({ interactionSettings: {}, remix: {}, posts: {} }) }));
vi.mock('@/hooks/useSignInGate', () => ({ useSignInGate: () => ({ requireSignIn: () => true }) }));
vi.mock('@/lib/mediaLibraryCompat', () => ({
  getMediaLibrary: () => null, mediaLibraryUnavailableMessage: () => 'Saving is unavailable.',
}));
vi.mock('expo-linking', () => ({ createURL: () => 'brandthread://post' }));

const { ThreadShareSheet } = await import('../ThreadShareSheet');
// Warm the module saveVideo imports lazily, so the test can flush it.
await import('expo-file-system');

afterEach(() => { vi.useRealTimers(); });

describe('ThreadShareSheet — save progress timer', () => {
  it('leaves no pending timer behind when unmounted right after a save settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onFeedback = vi.fn();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <ThreadShareSheet
          visible postId="demo-1" creator="Maya" caption="hi" mediaUri="https://cdn.example/v.mp4" isVideo
          onClose={() => {}} onReport={() => {}} onNotInterested={() => {}} onFeedback={onFeedback}
        />,
      );
    });
    const save = r.root.find((n) => (n.type as unknown) === 'Pressable' && n.props.accessibilityLabel === 'Save video');
    await act(async () => {
      save.props.onPress();
      // saveVideo awaits a dynamic import; let it run to its finally.
      for (let i = 0; i < 50 && onFeedback.mock.calls.length === 0; i++) await new Promise((res) => setImmediate(res));
      await new Promise((res) => setImmediate(res));
    });
    expect(onFeedback).toHaveBeenCalledWith('Saving is unavailable.', 'error');
    act(() => { r.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
  });
});
