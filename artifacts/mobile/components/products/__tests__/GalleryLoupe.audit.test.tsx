/** A press-and-hold in progress when the photo unmounts must not fire later. */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hapticLight = vi.fn();
vi.mock('@/lib/haptics', () => ({ hapticLight: () => hapticLight() }));

import { useGalleryLoupe } from '../GalleryLoupe';

let handlers: ReturnType<typeof useGalleryLoupe>['touchHandlers'];
function Harness() {
  handlers = useGalleryLoupe({ enabled: true }).touchHandlers;
  return null;
}

afterEach(() => { vi.useRealTimers(); });

describe('useGalleryLoupe', () => {
  it('cancels the pending hold timer on unmount', () => {
    vi.useFakeTimers();
    let r!: ReactTestRenderer;
    act(() => { r = create(<Harness />); });
    const touch = { pageX: 50, pageY: 60, locationX: 10, locationY: 20 };
    act(() => { handlers.onTouchStart({ nativeEvent: { ...touch, touches: [touch] }, currentTarget: null } as never); });
    expect(vi.getTimerCount()).toBe(1);
    act(() => { r.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    expect(hapticLight).not.toHaveBeenCalled();
  });
});
