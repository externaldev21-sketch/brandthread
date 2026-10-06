import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { NavigationContext } from 'expo-router/react-navigation';
import { useFocusedAnimationLoop } from '../lib/useFocusedAnimationLoop';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('focused loading animation lifecycle', () => {
  it('stops imperatively on blur, restarts on focus, and removes listeners on unmount', async () => {
    const listeners = new Map<string, () => void>();
    const removeFocus = vi.fn(), removeBlur = vi.fn();
    const navigation = {
      isFocused: () => true,
      addListener: (event: string, listener: () => void) => {
        listeners.set(event, listener);
        return event === 'focus' ? removeFocus : removeBlur;
      },
    };
    const loops: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
    const factory = vi.fn(() => {
      const loop = { start: vi.fn(), stop: vi.fn(), reset: vi.fn() };
      loops.push(loop);
      return loop;
    });
    function Screen() { useFocusedAnimationLoop(factory, []); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<NavigationContext.Provider value={navigation as any}><Screen /></NavigationContext.Provider>);
    });
    expect(loops[0].start).toHaveBeenCalledOnce();
    listeners.get('blur')!();
    expect(loops[0].stop).toHaveBeenCalledOnce();
    listeners.get('focus')!();
    listeners.get('focus')!();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(loops[1].start).toHaveBeenCalledOnce();
    await act(async () => renderer.unmount());
    expect(loops[1].stop).toHaveBeenCalledOnce();
    expect(removeFocus).toHaveBeenCalledOnce();
    expect(removeBlur).toHaveBeenCalledOnce();
  });

  it('keeps boot loading functional outside navigation and stops on unmount', async () => {
    const loop = { start: vi.fn(), stop: vi.fn(), reset: vi.fn() };
    function Boot() { useFocusedAnimationLoop(() => loop, []); return null; }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Boot />); });
    expect(loop.start).toHaveBeenCalledOnce();
    await act(async () => renderer.unmount());
    expect(loop.stop).toHaveBeenCalledOnce();
  });
});
