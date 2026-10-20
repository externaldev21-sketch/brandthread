import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({
  hide: vi.fn(),
  theme: vi.fn(),
  firstLaunch: vi.fn(),
  completions: [] as ((done: boolean) => void)[],
  mounts: 0,
  unmounts: 0,
}));
vi.mock('expo-splash-screen', () => ({ hideAsync: h.hide }));
vi.mock('@/contexts/AppThemeContext', () => ({
  DEFAULT_THEME: { id: 'dark' },
  peekPersistedTheme: h.theme,
}));
vi.mock('@/lib/introSplash', () => ({ consumeFirstLaunch: h.firstLaunch }));
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn() }));
vi.mock('@/components/branding/BrandthreadLogo', () => ({
  default: () => React.createElement('BrandLogo'),
}));
vi.mock('react-native-reanimated', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  withTiming: (to: number, _config?: unknown, completed?: (done: boolean) => void) => {
    if (completed) h.completions.push(completed);
    return to;
  },
}));

import AppIntroSplash from '@/components/splash/AppIntroSplash';

function App() {
  useEffect(() => {
    h.mounts++;
    return () => { h.unmounts++; };
  }, []);
  return <>{'Underlying app'}</>;
}

let tree: ReactTestRenderer;
const render = (ready: boolean) => <AppIntroSplash ready={ready}><App /></AppIntroSplash>;

describe('minimal native launch handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.completions.length = 0;
    h.mounts = 0;
    h.unmounts = 0;
    h.hide.mockResolvedValue(undefined);
    h.firstLaunch.mockResolvedValue(true);
    h.theme.mockResolvedValue({ id: 'dark' });
  });
  afterEach(() => { act(() => tree?.unmount()); });

  it('holds the real logo until ready, then removes only the overlay without remounting the app', async () => {
    await act(async () => { tree = create(render(false)); });
    expect(h.hide).toHaveBeenCalledTimes(1);
    // The original two transparent trail marks remain alongside the main logo.
    expect(tree.root.findAllByType('BrandLogo' as never)).toHaveLength(3);
    expect(h.completions).toHaveLength(0);
    expect(h.mounts).toBe(1);

    await act(async () => { tree.update(render(true)); });
    expect(h.completions).toHaveLength(1);
    act(() => { h.completions[0](true); });
    expect(tree.root.findAllByType('BrandLogo' as never)).toHaveLength(0);
    expect(h.mounts).toBe(1);
    expect(h.unmounts).toBe(0);
  });

  it('already paints an opaque full-size logo before the native splash is hidden', async () => {
    let restoreTheme!: (value: { id: string }) => void;
    h.theme.mockImplementationOnce(() => new Promise((resolve) => { restoreTheme = resolve; }));
    await act(async () => { tree = create(render(false)); });
    expect(h.hide).not.toHaveBeenCalled();
    const logo = tree.root.findAllByType('BrandLogo' as never).at(-1)!;
    let styledParent = logo.parent;
    while (styledParent && !styledParent.props.style) styledParent = styledParent.parent;
    expect(styledParent?.props.style).toMatchObject({ opacity: 1, transform: [{ scale: 1 }] });
    await act(async () => { restoreTheme({ id: 'dark' }); });
    expect(h.hide).toHaveBeenCalledTimes(1);
    expect(h.completions).toHaveLength(0);
  });
});
