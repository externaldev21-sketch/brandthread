/**
 * QA-0040: a signed-in seller must never be told to sign in on AI credits,
 * and the fresh preview seller sees a fresh account's real starting point
 * (0 credits, how to get more) without any protected API call.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => {
  const React = require('react') as typeof import('react');
  const el = (name: string) => {
    function C(props: Record<string, unknown>) { return React.createElement(name, props, props.children as React.ReactNode); }
    C.displayName = name;
    return C;
  };
  return {
    el,
    auth: { isLoaded: true, isSignedIn: true },
    preview: { seller: false, demo: false },
    api: { aiCredits: { get: vi.fn(), history: vi.fn() } },
  };
});

vi.mock('react-native', () => ({
  ActivityIndicator: h.el('ActivityIndicator'), Pressable: h.el('Pressable'), Text: h.el('Text'), View: h.el('View'),
  Alert: { alert: vi.fn() }, Platform: { OS: 'web' }, StyleSheet: { create: (s: unknown) => s },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn(), setParams: vi.fn() }), useLocalSearchParams: () => ({}) }));
vi.mock('@clerk/expo', () => ({ useAuth: () => h.auth }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: new Proxy({}, { get: () => '#000' }) }) }));
vi.mock('@/lib/api', () => ({ useApi: () => h.api }));
vi.mock('@/lib/theme', () => ({ FONT: {}, FS: {}, RADIUS: {}, SP: {} }));
vi.mock('@/components/BrandthreadUI', () => ({ BrandthreadScreen: h.el('BrandthreadScreen') }));
vi.mock('@/components/ScreenHeader', () => ({ ScreenHeader: h.el('ScreenHeader') }));
vi.mock('@/components/ui/Button', () => ({ Button: h.el('Button') }));
vi.mock('@/components/ui', () => ({ SkeletonBlock: h.el('SkeletonBlock') }));
vi.mock('@/components/ui/RetryRow', () => ({ RetryRow: h.el('RetryRow') }));
vi.mock('@/constants/typography', () => ({ tabularType: () => ({}), TABULAR_NUMS: {} }));
vi.mock('@/lib/navigation/goBackOr', () => ({ goBackOr: vi.fn() }));
vi.mock('@/lib/devPreview', () => ({
  isPreviewDemoMode: () => h.preview.demo, isBuyerDevPreview: () => false, isSellerDevPreview: () => h.preview.seller,
}));
vi.mock('@/lib/revenueCat', () => ({ useRevenueCat: () => ({ available: false, creditPackPrices: vi.fn(), purchaseCreditPack: vi.fn() }) }));
vi.mock('@/hooks/useAiCredits', () => ({ invalidateAiCredits: vi.fn() }));

import AiCreditsScreen from '@/app/ai-credits';

let tree: ReactTestRenderer | undefined;
const texts = () => tree!.root.findAllByType('Text' as never).map((t) => String(([] as unknown[]).concat(t.props.children).join('')));

afterEach(() => { act(() => tree?.unmount()); tree = undefined; vi.clearAllMocks(); });

describe('AI credits access (QA-0040)', () => {
  it('shows a signed-in seller their balance', async () => {
    Object.assign(h.auth, { isLoaded: true, isSignedIn: true });
    Object.assign(h.preview, { seller: false, demo: false });
    h.api.aiCredits.get.mockResolvedValue({ balance: 0, monthlyAllowance: 0, packs: [], tools: [], unlimited: false, purchase: { stripe: false } });
    h.api.aiCredits.history.mockResolvedValue({ entries: [], nextCursor: null });
    await act(async () => { tree = create(<AiCreditsScreen />); });
    expect(texts()).toContain('Available credits');
    expect(texts().join(' ')).not.toMatch(/Sign in/);
  });

  it('keeps loading (never "Sign in") while the session is still loading', async () => {
    Object.assign(h.auth, { isLoaded: false, isSignedIn: undefined });
    await act(async () => { tree = create(<AiCreditsScreen />); });
    expect(texts().join(' ')).not.toMatch(/Sign in/);
    expect(tree!.root.findAllByType('SkeletonBlock' as never).length).toBeGreaterThan(0);
  });

  it('shows the fresh preview seller 0 credits and plans, calling no API', async () => {
    Object.assign(h.auth, { isLoaded: true, isSignedIn: false });
    Object.assign(h.preview, { seller: true, demo: false });
    await act(async () => { tree = create(<AiCreditsScreen />); });
    expect(texts()).toEqual(expect.arrayContaining(['Available credits', '0']));
    expect(tree!.root.findAllByType('Button' as never).map((b) => b.props.label)).toContain('See plans');
    expect(h.api.aiCredits.get).not.toHaveBeenCalled();
  });
});
