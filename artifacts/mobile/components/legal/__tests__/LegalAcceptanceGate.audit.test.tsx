/**
 * Audit: a slow GET /api/auth/me for the PREVIOUS account must not decide the
 * legal gate for the account signed in now. Before the fix, account A's late
 * "already agreed" answer cleared the gate for account B, who had not agreed.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent, me, acceptLegal } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
  me: vi.fn(),
  acceptLegal: vi.fn(async () => ({})),
}));

vi.mock('react-native', () => ({
  Modal: nativeComponent('Modal'),
  ScrollView: nativeComponent('ScrollView'),
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
const auth = vi.hoisted(() => ({ userId: 'user_a' }));
vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isSignedIn: true, userId: auth.userId, signOut: async () => {} }),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: { text: '#fff', muted: '#aaa', subtle: '#777', border: '#333', borderSubtle: '#222', background: '#000', card: '#111', error: '#f00' },
  }),
}));
const stableApi = { auth: { me, acceptLegal } };
vi.mock('@/lib/api', () => ({ useApi: () => stableApi }));
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 0 }));
vi.mock('@/components/BrandthreadUI', () => ({
  PressableScale: nativeComponent('PressableScale'),
  PrimaryButton: nativeComponent('PrimaryButton'),
}));
vi.mock('@/components/legal/LegalConsent', () => ({ LegalConsent: nativeComponent('LegalConsent') }));
vi.mock('@/lib/legalConsent', () => ({
  clearPendingConsent: vi.fn(async () => {}),
  hasAcceptedCurrentTerms: (v: string | null | undefined) => v === 'current',
  readPendingConsent: vi.fn(async () => null),
}));
vi.mock('@/content/legal', () => ({
  EFFECTIVE_DATE: 'Oct 1, 2026',
  LEGAL_DOCUMENTS: { terms: { title: 'Terms of Service', route: '/legal/terms' } },
  LEGAL_DOCUMENT_ORDER: ['terms'],
  LEGAL_VERSION: 'current',
}));
// useIsWebShell is a real hook (useWindowDimensions) in the app; any hook
// works here as long as it is counted on every render.
vi.mock('@/components/web/WebAppShell', () => ({
  useIsWebShell: () => React.useState(false)[0],
  WEB_SHELL_MAX_WIDTH: 480,
}));

import LegalAcceptanceGate from '@/components/legal/LegalAcceptanceGate';

let tree: ReactTestRenderer | undefined;

describe('LegalAcceptanceGate account switch (audit)', () => {
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

  it("ignores the previous account's late /me answer", async () => {
    let resolveA: (v: { termsVersion: string | null }) => void = () => {};
    me.mockImplementationOnce(() => new Promise((r) => { resolveA = r; }));      // account A: slow, already agreed
    me.mockImplementationOnce(async () => ({ termsVersion: null }));              // account B: never agreed
    auth.userId = 'user_a';
    await act(async () => { tree = create(<LegalAcceptanceGate />); });
    auth.userId = 'user_b';
    await act(async () => { tree!.update(<LegalAcceptanceGate />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(tree!.root.findAllByType('Modal' as never)).toHaveLength(1);
    // A's answer lands late.
    await act(async () => { resolveA({ termsVersion: 'current' }); await Promise.resolve(); await Promise.resolve(); });
    expect(tree!.root.findAllByType('Modal' as never)).toHaveLength(1);
  });
});
