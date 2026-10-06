import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-navigation/native', () => ({
  NavigationContext: require('react').createContext(null),
}));
import { NavigationContext } from '@react-navigation/native';
import { useFocusedAnimationLoop } from '../lib/useFocusedAnimationLoop';

function harness(focused: boolean) {
  const listeners = new Map<string, () => void>();
  const navigation = {
    isFocused: () => focused,
    addListener: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return () => { listeners.delete(event); };
    }),
  };
  const loops: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> }[] = [];
  const factory = vi.fn(() => {
    const loop = { start: vi.fn(), stop: vi.fn(), reset: vi.fn() };
    loops.push(loop);
    return loop;
  });
  function Probe() { useFocusedAnimationLoop(factory, [factory]); return null; }
  return { navigation, listeners, loops, factory, Probe };
}

describe('shared loaders release animation work on hidden screens', () => {
  it('stops immediately on blur and starts a fresh loop on focus', () => {
    const h = harness(true);
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(
      <NavigationContext.Provider value={h.navigation as never}><h.Probe /></NavigationContext.Provider>,
    ); });
    expect(h.loops[0].start).toHaveBeenCalledTimes(1);
    // Blur is imperative: it doesn't wait for a frozen screen to render.
    act(() => { h.listeners.get('blur')!(); });
    expect(h.loops[0].stop).toHaveBeenCalledTimes(1);
    act(() => { h.listeners.get('focus')!(); h.listeners.get('focus')!(); });
    expect(h.factory).toHaveBeenCalledTimes(2);
    expect(h.loops[1].start).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
    expect(h.loops[1].stop).toHaveBeenCalledTimes(1);
    expect(h.listeners.size).toBe(0);
  });

  it('never starts a loop for an initially hidden retained scene', () => {
    const h = harness(false);
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(
      <NavigationContext.Provider value={h.navigation as never}><h.Probe /></NavigationContext.Provider>,
    ); });
    expect(h.factory).not.toHaveBeenCalled();
    act(() => { h.listeners.get('focus')!(); });
    expect(h.loops[0].start).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it('still supports loading UI outside navigation and cleans up on unmount', () => {
    const h = harness(true);
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<h.Probe />); });
    expect(h.loops[0].start).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
    expect(h.loops[0].stop).toHaveBeenCalledTimes(1);
  });
});
