import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const visit = vi.hoisted(() => ({ focused: true }));
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (callback: () => void) =>
      useEffect(() => { if (visit.focused) callback(); }, [callback, visit.focused]),
  };
});
import { useProfilePostsDefault } from '../hooks/useProfilePostsDefault';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | undefined;
let currentTab: string;
let chooseTab: React.Dispatch<React.SetStateAction<'Posts' | 'Shop' | 'Tagged'>>;
function Profile({ identity }: { identity: string }) {
  const [tab, setTab] = useState<'Posts' | 'Shop' | 'Tagged'>('Posts');
  useProfilePostsDefault(setTab, identity);
  currentTab = tab;
  chooseTab = setTab;
  return <>{tab}</>;
}
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  visit.focused = true;
});

describe('Posts-first profile visits', () => {
  it('keeps an explicit Products selection through rerenders during the same visit', () => {
    act(() => { renderer = create(<Profile identity="seller-a" />); });
    expect(currentTab).toBe('Posts');
    act(() => chooseTab('Shop'));
    act(() => renderer!.update(<Profile identity="seller-a" />));
    expect(currentTab).toBe('Shop');
  });
  it('reopens a still-mounted profile on Posts after leaving it', () => {
    act(() => { renderer = create(<Profile identity="seller-a" />); });
    act(() => chooseTab('Shop'));
    visit.focused = false;
    act(() => renderer!.update(<Profile identity="seller-a" />));
    visit.focused = true;
    act(() => renderer!.update(<Profile identity="seller-a" />));
    expect(currentTab).toBe('Posts');
  });
  it('resets when a reused route changes profile or account', () => {
    act(() => { renderer = create(<Profile identity="buyer-a" />); });
    act(() => chooseTab('Tagged'));
    act(() => renderer!.update(<Profile identity="brandthread-official" />));
    expect(currentTab).toBe('Posts');
  });
  it.each(['app/seller-profile.tsx', 'app/buyer-other-profile.tsx',
    'app/(tabs)/profile.tsx', 'app/(buyer)/profile.tsx'])('applies the same visit default to %s', path => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    expect(source).toContain('useProfilePostsDefault(setActiveTab,');
    expect(source).not.toContain('tabPickedRef');
  });
  it.each(['app/seller-profile.tsx', 'app/(tabs)/profile.tsx'])('keeps Products second in %s', path => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    expect(source).toMatch(/\{ key: 'Posts', label: 'Posts', icon: 'grid' \},\s*\{ key: 'Shop', label: 'Products'/);
  });
});
