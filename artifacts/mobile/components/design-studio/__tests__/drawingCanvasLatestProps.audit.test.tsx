/**
 * Both freehand surfaces must commit a stroke with the tool / colour that is
 * current WHEN the stroke ends — the host (app/design-canvas.tsx) keeps them
 * mounted across tool and colour changes.
 *
 * Before the fix:
 *  - SvgDrawingCanvas built its PanResponder once (useRef) and closed over
 *    the first render's props, so after switching brush → eraser (or picking
 *    a new colour) every stroke was still saved with the original tool/colour.
 *  - SkiaDrawingCanvas memoized its pan gesture without `tool` (and the
 *    callbacks) in the deps, so brush → eraser alone kept committing brush
 *    strokes.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── PanResponder capture (SVG surface) ─────────────────────────────────────
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    PanResponder: {
      // The handlers the View actually receives carry their own config, so the
      // test drives the responder that is really attached (not just the
      // latest one created).
      create: (cfg: Record<string, (...args: any[]) => any>) => ({ panHandlers: { __cfg: cfg } }),
    },
  };
});

// ─── Gesture capture (Skia surface) ─────────────────────────────────────────
let skiaPan: Record<string, (...args: any[]) => any> = {};
vi.mock('react-native-gesture-handler', () => {
  const React = require('react');
  return {
    Gesture: {
      Pan: () => {
        const handlers: Record<string, (...args: any[]) => any> = {};
        skiaPan = handlers;
        const chain: any = new Proxy({}, {
          get: (_t, key: string) => (fn: any) => {
            if (key === 'onStart' || key === 'onUpdate' || key === 'onEnd') handlers[key] = fn;
            return chain;
          },
        });
        return chain;
      },
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  };
});
vi.mock('@shopify/react-native-skia', () => {
  const path = { moveTo: () => {}, lineTo: () => {} };
  return {
    Canvas: () => null, Path: () => null, Group: () => null,
    Skia: { Path: { Make: () => path, MakeFromSVGString: () => path } },
    useCanvasRef: () => ({ current: null }),
    ColorType: { RGBA_8888: 4 }, AlphaType: { Unpremul: 3 },
  };
});

import SvgDrawingCanvas from '../SvgDrawingCanvas';
import SkiaDrawingCanvas from '../SkiaDrawingCanvas';

const base = { width: 200, height: 200, paths: [], brushKind: 'ink' as const, size: 6, opacity: 1 };

describe('SvgDrawingCanvas uses the current props for each stroke', () => {
  it('commits with the tool and colour in effect when the stroke ends', () => {
    const first = vi.fn();
    const second = vi.fn();
    let r!: ReturnType<typeof create>;
    act(() => { r = create(<SvgDrawingCanvas {...base} color="#FF0000" tool="brush" onStrokeEnd={first} />); });
    act(() => { r.update(<SvgDrawingCanvas {...base} color="#0000FF" tool="eraser" onStrokeEnd={second} />); });

    const panConfig = r.root.findByProps({ testID: 'svg-drawing-canvas' }).props.__cfg;
    act(() => {
      panConfig!.onPanResponderGrant({ nativeEvent: { locationX: 10, locationY: 10 } });
      panConfig!.onPanResponderMove({ nativeEvent: { locationX: 40, locationY: 40 } });
      panConfig!.onPanResponderRelease();
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0][0]).toMatchObject({ color: 'erase', tool: 'eraser' });
  });
});

describe('SkiaDrawingCanvas uses the current tool for each stroke', () => {
  it('commits an eraser stroke after switching brush → eraser', () => {
    const onStrokeEnd = vi.fn();
    let r!: ReturnType<typeof create>;
    act(() => { r = create(<SkiaDrawingCanvas {...base} color="#FF0000" tool="brush" onStrokeEnd={onStrokeEnd} />); });
    act(() => { r.update(<SkiaDrawingCanvas {...base} color="#FF0000" tool="eraser" onStrokeEnd={onStrokeEnd} />); });

    act(() => {
      skiaPan.onStart({ x: 10, y: 10 });
      skiaPan.onUpdate({ x: 40, y: 40 });
      skiaPan.onEnd();
    });

    expect(onStrokeEnd).toHaveBeenCalledTimes(1);
    expect(onStrokeEnd.mock.calls[0][0]).toMatchObject({ color: 'erase', tool: 'eraser' });
  });
});
