/**
 * MediaViewer's swipe-down-to-close used to call onClose() without resetting
 * the drag transform (only the X button did), so the next photo opened still
 * shifted down and dimmed. Its PanResponder is created once, so it must also
 * call the CURRENT onClose, not the first render's.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Gesture = { dy: number };
type Config = {
  onPanResponderMove: (e: unknown, g: Gesture) => void;
  onPanResponderRelease: (e: unknown, g: Gesture) => void;
};
let config: Config | null = null;

vi.mock('react-native', async () => {
  const shim = await vi.importActual<Record<string, unknown>>('../../../tests/shims/react-native');
  return {
    ...shim,
    Share: { share: vi.fn() },
    // Like useRef(PanResponder.create(...)): only the FIRST render's responder is ever used.
    PanResponder: { create: (c: Config) => { config ??= c; return { panHandlers: {} }; } },
  };
});
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/lib/mediaLibraryAdapter', () => ({ saveImageToMediaLibrary: vi.fn() }));
vi.mock('@/lib/mediaLibraryCompat', () => ({ mediaLibraryUnavailableMessage: () => '' }));
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 0 }));
vi.mock('@/lib/actionSheet', () => ({ showAlert: vi.fn() }));

import MediaViewer from '../MediaViewer';

function transform(renderer: ReactTestRenderer) {
  const image = renderer.root.find((n) => n.type === 'Image');
  const style = (image.props.style as Array<{ transform?: Array<Record<string, { value: number }>> }>)[1];
  const backdrop = renderer.root.find((n) => n.type === 'View' && Array.isArray(n.props.style) && n.props.style[1]?.opacity);
  return {
    translateY: style.transform![0].translateY.value,
    opacity: (backdrop.props.style[1].opacity as { value: number }).value,
  };
}

const noEvent = { nativeEvent: { touches: [] } };

describe('MediaViewer swipe-down close', () => {
  it('resets the drag and calls the current onClose', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<MediaViewer visible uri="https://x/a.jpg" onClose={first} />); });
    await act(async () => { renderer.update(<MediaViewer visible uri="https://x/a.jpg" onClose={latest} />); });

    act(() => { config!.onPanResponderMove(noEvent, { dy: 200 }); });
    expect(transform(renderer).translateY).toBe(200);
    expect(transform(renderer).opacity).toBeLessThan(1);

    act(() => { config!.onPanResponderRelease(noEvent, { dy: 200 }); });
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    // Reopening shows the photo in place, not still dragged down / dimmed.
    expect(transform(renderer)).toEqual({ translateY: 0, opacity: 1 });
  });
});
