import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'ios' as 'ios' | 'android' | 'web' }));
vi.mock('react-native', () => ({ Platform: platform }));

import { MODAL_DISMISS_GUARD_MS, useAfterModalDismiss } from '../hooks/useAfterModalDismiss';
import { useScrollToEndOnContentChange } from '../hooks/useScrollToEndOnContentChange';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type DismissApi = ReturnType<typeof useAfterModalDismiss>;

function DismissProbe({ visible, onApi }: { visible: boolean; onApi: (api: DismissApi) => void }) {
  onApi(useAfterModalDismiss(visible));
  return null;
}

describe('useAfterModalDismiss', () => {
  let renderer: ReactTestRenderer | null = null;
  let api!: DismissApi;
  const onApi = (next: DismissApi) => { api = next; };

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    vi.useRealTimers();
    platform.OS = 'ios';
  });

  function mount(visible: boolean) {
    act(() => { renderer = create(<DismissProbe visible={visible} onApi={onApi} />); });
  }
  function setVisible(visible: boolean) {
    act(() => renderer!.update(<DismissProbe visible={visible} onApi={onApi} />));
  }

  it('iOS: waits for onDismiss, not for the hide commit', () => {
    platform.OS = 'ios';
    const work = vi.fn();
    mount(true);
    api.runAfterDismiss(work);
    setVisible(false);
    expect(work).not.toHaveBeenCalled();
    act(() => api.onDismiss());
    expect(work).toHaveBeenCalledTimes(1);
    // The guard must not run it a second time.
    act(() => { vi.advanceTimersByTime(MODAL_DISMISS_GUARD_MS * 2); });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('iOS: the guard runs queued work if onDismiss never arrives', () => {
    platform.OS = 'ios';
    const work = vi.fn();
    mount(true);
    api.runAfterDismiss(work);
    setVisible(false);
    act(() => { vi.advanceTimersByTime(MODAL_DISMISS_GUARD_MS); });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('Android: runs right after the hide commits (no onDismiss there)', () => {
    platform.OS = 'android';
    const work = vi.fn();
    mount(true);
    api.runAfterDismiss(work);
    expect(work).not.toHaveBeenCalled();
    setVisible(false);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('runs immediately when the modal is already closed', () => {
    const work = vi.fn();
    mount(false);
    api.runAfterDismiss(work);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('drops queued work on unmount', () => {
    const work = vi.fn();
    mount(true);
    api.runAfterDismiss(work);
    act(() => renderer!.unmount());
    renderer = null;
    vi.advanceTimersByTime(MODAL_DISMISS_GUARD_MS * 2);
    expect(work).not.toHaveBeenCalled();
  });
});

type ScrollApi = ReturnType<typeof useScrollToEndOnContentChange>;

function ScrollProbe({ list, onApi }: { list: { scrollToEnd: (o?: { animated?: boolean }) => void }; onApi: (api: ScrollApi) => void }) {
  const ref = React.useRef(list);
  onApi(useScrollToEndOnContentChange(ref));
  return null;
}

describe('useScrollToEndOnContentChange', () => {
  let renderer: ReactTestRenderer | null = null;
  let api!: ScrollApi;
  let frames: Array<() => void> = [];
  const scrollToEnd = vi.fn();

  beforeEach(() => {
    frames = [];
    scrollToEnd.mockReset();
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames[id - 1] = () => {}; });
    act(() => { renderer = create(<ScrollProbe list={{ scrollToEnd }} onApi={(next) => { api = next; }} />); });
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    vi.unstubAllGlobals();
  });

  const flushFrames = () => { while (frames.length) frames.splice(0, frames.length).forEach((cb) => cb()); };

  it('does nothing on content changes nobody asked to follow', () => {
    api.onContentSizeChange();
    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('scrolls once the new content has a size, exactly once', () => {
    api.requestScrollToEnd();
    expect(scrollToEnd).not.toHaveBeenCalled();
    api.onContentSizeChange();
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
    api.onContentSizeChange();
    flushFrames();
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
  });

  it('falls back after layout when the content height did not change', () => {
    api.requestScrollToEnd(false);
    flushFrames();
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  });

  it('a user drag cancels a pending request', () => {
    api.requestScrollToEnd();
    api.cancelScrollToEnd();
    api.onContentSizeChange();
    flushFrames();
    expect(scrollToEnd).not.toHaveBeenCalled();
  });
});
