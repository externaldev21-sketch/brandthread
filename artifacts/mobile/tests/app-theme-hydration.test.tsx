import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const me = vi.fn();
  const updateProfile = vi.fn();
  return {
    getItem: vi.fn(),
    setItem: vi.fn(),
    me,
    updateProfile,
    api: { auth: { me, updateProfile } },
  };
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: mocks.getItem,
    setItem: mocks.setItem,
  },
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'theme-user' }) }));
vi.mock('@/lib/api', () => ({
  useApi: () => mocks.api,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'native' } }));

import { AppThemeProvider, useAppTheme } from '@/contexts/AppThemeContext';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function ThemeProbe(_props: { themeId: string; isHydrated: boolean }) {
  return null;
}

function Probe() {
  const { theme, isHydrated } = useAppTheme();
  return <ThemeProbe themeId={theme.id} isHydrated={isHydrated} />;
}

function probe(renderer: ReactTestRenderer) {
  return renderer.root.findByType(ThemeProbe).props as {
    themeId: string;
    isHydrated: boolean;
  };
}

describe('app theme hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setItem.mockResolvedValue(undefined);
    mocks.updateProfile.mockResolvedValue({});
  });

  it('applies the saved theme before the server profile request settles', async () => {
    const profile = deferred<{ appThemeId: string }>();
    mocks.getItem.mockResolvedValue('leopard-red');
    mocks.me.mockReturnValue(profile.promise);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AppThemeProvider><Probe /></AppThemeProvider>);
    });

    expect(mocks.getItem).toHaveBeenCalledWith('@brandthread/app-theme:v1:theme-user');
    expect(mocks.me).toHaveBeenCalledOnce();
    expect(probe(renderer)).toEqual({ themeId: 'leopard-red', isHydrated: true });

    await act(async () => {
      profile.resolve({ appThemeId: 'maroon' });
      await profile.promise;
    });

    expect(probe(renderer)).toEqual({ themeId: 'maroon', isHydrated: true });
    expect(mocks.setItem).toHaveBeenCalledWith('@brandthread/app-theme:v1:theme-user', 'maroon');
  });

  it('keeps the saved theme when the background server request fails', async () => {
    mocks.getItem.mockResolvedValue('maroon');
    mocks.me.mockRejectedValue(new Error('offline'));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AppThemeProvider><Probe /></AppThemeProvider>);
    });

    expect(probe(renderer)).toEqual({ themeId: 'maroon', isHydrated: true });
  });
});