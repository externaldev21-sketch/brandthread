/**
 * Swipe-left on a layer row reveals Lock / Duplicate / Delete, one row at a
 * time (openSwipeId is a single id, and tapping any row closes "the" open
 * one). Opening a second row used to leave the first row's actions visibly
 * open and untracked — tapping elsewhere then only closed the second.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { timing } = vi.hoisted(() => ({
  timing: vi.fn((value: { value: number }, cfg: { toValue: number }) => ({ start: () => { value.value = cfg.toValue; } })),
}));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<any>();
  class Value {
    value: number;
    constructor(v: number) { this.value = v; }
    setValue(v: number) { this.value = v; }
    stopAnimation(cb?: (v: number) => void) { cb?.(this.value); }
  }
  return {
    ...actual,
    PanResponder: { create: (cfg: unknown) => ({ panHandlers: { __cfg: cfg } }) },
    Animated: { ...actual.Animated, Value, timing },
  };
});
vi.mock('@/components/ui/Button', () => ({ Button: () => null }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

import LayersPanel from '../LayersPanel';

const layer = (id: string, order: number) => ({
  id, name: id, type: 'drawing', order, visible: true, locked: false, opacity: 1, blendMode: 'normal', data: {},
});

const noop = () => {};
const props = {
  layers: [layer('a', 2), layer('b', 1)] as never, selectedLayerId: null,
  onSelect: noop, onAddLayer: noop, onDuplicateLayer: noop, onDeleteLayer: noop, onRenameLayer: noop,
  onToggleVisible: noop, onToggleLocked: noop, onToggleAlphaLock: noop, onToggleClippingMask: noop,
  onSetOpacity: noop, onSetBlendMode: noop, onReorder: noop, onMergeDown: noop, onClose: noop,
  canvasBackgroundHex: '#fff', canvasBackgroundVisible: true, onToggleBackgroundVisible: noop,
};

function swipeOpen(r: ReactTestRenderer, id: string) {
  const cfg = r.root.findByProps({ testID: `layer-row-${id}` }).props.__cfg;
  act(() => {
    cfg.onPanResponderGrant();
    cfg.onPanResponderMove({}, { dx: -150, dy: 0 });
    cfg.onPanResponderRelease({}, { dx: -150, dy: 0 });
  });
}

describe('LayersPanel swipe rows', () => {
  it('closes the open row when another row is swiped open', () => {
    let r!: ReactTestRenderer;
    act(() => { r = create(<LayersPanel {...props} />); });
    swipeOpen(r, 'a');
    timing.mockClear();
    swipeOpen(r, 'b');

    const targets = timing.mock.calls.map(([, cfg]) => (cfg as { toValue: number }).toValue);
    // Row b opens (-168) AND row a is animated back to 0.
    expect(targets).toContain(-168);
    expect(targets).toContain(0);
  });
});
