/**
 * The web paint surface removes its pointer listeners when `enabled` turns
 * false (e.g. a panel opens or the tool changes mid-stroke). The pointerup
 * for the finger/pen already down then never reaches the model, so the
 * in-progress stroke or pinch was left open forever. Tearing down with
 * active pointers must cancel the model's gesture.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A View whose ref is the host node, so createNodeMock's fake DOM element is
// what the surface attaches its pointer listeners to (as on react-native-web).
vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: React.forwardRef((props: Record<string, unknown>, ref: unknown) => React.createElement('View', { ...props, ref })),
    StyleSheet: { absoluteFill: {} },
  };
});

import PaintSurface from '../PaintSurface.web';

function fakeElement() {
  const listeners: Record<string, (e: unknown) => void> = {};
  return {
    listeners,
    style: {} as Record<string, string>,
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    removeEventListener: (type: string) => { delete listeners[type]; },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: () => {},
  };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('PaintSurface.web teardown', () => {
  it('cancels the open gesture when disabled while a pointer is down', () => {
    const model = { down: vi.fn(), move: vi.fn(), up: vi.fn(), cancel: vi.fn(), tick: vi.fn() };
    const el = fakeElement();
    let r!: ReactTestRenderer;
    act(() => { r = create(<PaintSurface model={model as never} enabled />, { createNodeMock: () => el }); });

    act(() => {
      el.listeners.pointerdown({ button: 0, pointerId: 1, clientX: 5, clientY: 5, pointerType: 'touch', pressure: 0.5, timeStamp: 1, preventDefault: () => {} });
    });
    expect(model.down).toHaveBeenCalledTimes(1);

    act(() => { r.update(<PaintSurface model={model as never} enabled={false} />); });
    expect(model.cancel).toHaveBeenCalledTimes(1);
  });

  it('does not cancel when nothing is down', () => {
    const model = { down: vi.fn(), move: vi.fn(), up: vi.fn(), cancel: vi.fn(), tick: vi.fn() };
    const el = fakeElement();
    let r!: ReactTestRenderer;
    act(() => { r = create(<PaintSurface model={model as never} enabled />, { createNodeMock: () => el }); });
    act(() => { r.update(<PaintSurface model={model as never} enabled={false} />); });
    expect(model.cancel).not.toHaveBeenCalled();
  });
});
