import React, { createContext, useContext } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const platform = vi.hoisted(() => ({ OS: 'web' }));
vi.mock('react-native', () => ({ Platform: platform, View: 'SceneView' }));
import { RetainedScene } from '@/components/RetainedScene';

const Value = createContext(0);
let frames: Array<() => void>;
let rendered: number[];
let focused: boolean;
let hidden: boolean;
let parentFocused: boolean;
let tree: ReactTestRenderer | undefined;
const listeners = new Set<() => void>();
const navigation = {
  isFocused: () => focused,
  getParent: () => ({ isFocused: () => parentFocused }),
  addListener: (_event: string, listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
function Child() { rendered.push(useContext(Value)); return null; }
const scene = (value: number) => <Value.Provider value={value}><RetainedScene navigation={navigation}><Child /></RetainedScene></Value.Provider>;
async function frame() { await act(async () => { frames.shift()?.(); }); }
describe('retained scenes', () => {
  beforeEach(() => {
    platform.OS = 'web'; frames = []; rendered = []; focused = true; hidden = true; parentFocused = true;
    listeners.clear();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('getComputedStyle', () => ({ display: hidden ? 'none' : 'flex', visibility: 'visible' }));
  });
  afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals(); });
  const mount = async () => { await act(async () => {
    tree = create(scene(0), { createNodeMock: () => ({ parentElement: null }) });
  }); };
  const blur = async () => { await act(async () => { focused = false; listeners.forEach(fn => fn()); }); };
  it('suspends hidden web updates and resumes with current context on focus', async () => {
    await mount(); await blur(); await frame();
    const before = rendered.length;
    await act(async () => tree!.update(scene(1)));
    expect(rendered).toHaveLength(before);
    await act(async () => { focused = true; listeners.forEach(fn => fn()); });
    expect(rendered.at(-1)).toBe(1);
  });
  it('never freezes a still-visible transparent-modal background', async () => {
    hidden = false;
    await mount(); await blur();
    for (let i = 0; i < 8; i++) await frame();
    await act(async () => tree!.update(scene(2)));
    expect(rendered.at(-1)).toBe(2);
  });
  it('does not hide opaque z-ordered web tabs and trigger a measurement storm on resume', async () => {
    hidden = false;
    const render = (value: number) => <Value.Provider value={value}><RetainedScene navigation={navigation} opaque><Child /></RetainedScene></Value.Provider>;
    await act(async () => { tree = create(render(0)); });
    await blur(); await frame();
    await act(async () => { tree!.update(render(4)); });
    expect(rendered.at(-1)).toBe(4);
    expect(frames).toHaveLength(0);
  });
  it('leaves native scene rendering to native-stack/screens transition coordination', async () => {
    platform.OS = 'ios';
    await mount(); await blur();
    await act(async () => tree!.update(scene(3)));
    expect(rendered.at(-1)).toBe(3);
    expect(frames).toHaveLength(0);
  });
  it('keeps the selected opaque tab visible when its parent opens a transparent modal', async () => {
    hidden = false; parentFocused = false;
    const render = (value: number) => <Value.Provider value={value}><RetainedScene navigation={navigation} opaque><Child /></RetainedScene></Value.Provider>;
    await act(async () => { tree = create(render(0)); });
    await blur(); await frame();
    await act(async () => { tree!.update(render(7)); });
    expect(rendered.at(-1)).toBe(7);
  });
});
