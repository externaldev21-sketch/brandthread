import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  anchorFromEvent, closeContextMenu, getMenuState, menuItemsFromButtons, openContextMenu,
  openPullDownMenu, placePullDown, previewAspectRatio, resetMenus, subscribeMenus,
} from '../contextMenu';

const win = { width: 390, height: 844, top: 47, bottom: 34 };

describe('menuItemsFromButtons', () => {
  it('converts Alert-style buttons and drops Cancel', () => {
    const del = vi.fn();
    const items = menuItemsFromButtons([
      { text: 'Share', onPress: () => {} },
      false,
      null,
      { text: 'Delete', style: 'destructive', onPress: del },
      { text: 'Cancel', style: 'cancel' },
      { text: 'cancel' },
    ], { Share: 'share' });
    expect(items.map((i) => [i.label, i.destructive, i.icon])).toEqual([
      ['Share', false, 'share'],
      ['Delete', true, undefined],
    ]);
    items[1].onPress?.();
    expect(del).toHaveBeenCalled();
  });
});

describe('anchorFromEvent', () => {
  it('reads pageX/pageY and rejects anything else', () => {
    expect(anchorFromEvent({ nativeEvent: { pageX: 350, pageY: 60 } })).toEqual({ x: 350, y: 60 });
    expect(anchorFromEvent(undefined)).toBeNull();
    expect(anchorFromEvent({ nativeEvent: { pageX: Number.NaN, pageY: 2 } })).toBeNull();
    expect(anchorFromEvent({})).toBeNull();
  });
});

describe('placePullDown', () => {
  const menu = { width: 250, height: 176 };
  it('drops below a right-side button with trailing edges aligned', () => {
    const p = placePullDown({ x: 360, y: 70 }, menu, win);
    expect(p.origin).toBe('right');
    expect(p.left + menu.width).toBeLessThanOrEqual(win.width - 8);
    expect(p.top).toBe(92);
  });
  it('aligns leading edge for a left-side button', () => {
    const p = placePullDown({ x: 30, y: 70 }, menu, win);
    expect(p.origin).toBe('left');
    expect(p.left).toBe(8);
  });
  it('flips above when there is no room below', () => {
    const p = placePullDown({ x: 360, y: 790 }, menu, win);
    expect(p.top + menu.height).toBeLessThanOrEqual(790);
  });
  it('defaults to the top-right header slot without an anchor', () => {
    const p = placePullDown(null, menu, win);
    expect(p.top).toBeGreaterThan(win.top);
    expect(p.origin).toBe('right');
  });
});

describe('previewAspectRatio', () => {
  it('clamps to Instagram card shapes', () => {
    expect(previewAspectRatio(undefined)).toBeCloseTo(0.8);
    expect(previewAspectRatio(0.3)).toBeCloseTo(0.8);
    expect(previewAspectRatio(1)).toBe(1);
    expect(previewAspectRatio(4)).toBe(1.91);
  });
});

describe('menu bus', () => {
  afterEach(() => resetMenus());

  it('does nothing without a host so callers can fall back', () => {
    expect(openContextMenu({ preview: {}, items: [{ label: 'Share' }] })).toBe(false);
    expect(openPullDownMenu(null, [{ label: 'Share' }])).toBe(false);
  });

  it('opens and closes with a mounted host', () => {
    const seen: Array<string | null> = [];
    const off = subscribeMenus((s) => seen.push(s.context ? 'context' : s.pullDown ? 'pulldown' : null));
    expect(openContextMenu({ preview: { title: 'Tee' }, items: [{ label: 'Save' }] })).toBe(true);
    expect(getMenuState().context?.items).toHaveLength(1);
    closeContextMenu();
    expect(openPullDownMenu({ nativeEvent: { pageX: 360, pageY: 60 } }, [{ label: 'Report', destructive: true }])).toBe(true);
    expect(getMenuState().pullDown?.anchor).toEqual({ x: 360, y: 60 });
    expect(openContextMenu({ preview: {}, items: [] })).toBe(false);
    off();
    expect(seen).toContain('context');
    expect(seen).toContain('pulldown');
  });
});
