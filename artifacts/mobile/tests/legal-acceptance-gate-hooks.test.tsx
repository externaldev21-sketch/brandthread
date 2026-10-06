/**
 * QA-0005 (P0): LegalAcceptanceGate called useIsWebShell() after
 * `if (!isSignedIn || !needsAgreement) return null`, so the render that flips
 * needsAgreement to true ran one more hook and React threw "Rendered more
 * hooks than during the previous render". Every new Sign in with Apple /
 * Google account without a recorded agreement hit it on first launch.
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
vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ isSignedIn: true, userId: 'user_apple_new', signOut: vi.fn(async () => {}) }),
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

describe('LegalAcceptanceGate hook order (QA-0005)', () => {
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

  it('shows the agreement for a new SSO account instead of crashing', async () => {
    me.mockResolvedValue({ termsVersion: null });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { tree = create(<LegalAcceptanceGate />); });
    await act(async () => { await Promise.resolve(); });
    expect(tree!.root.findAllByType('Modal' as never)).toHaveLength(1);
    const texts = tree!.root.findAllByType('Text' as never).map((t) => t.props.children);
    expect(texts).toContain('Before you continue');
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/more hooks/);
    errors.mockRestore();
  });

  it('renders nothing once the current terms are on file', async () => {
    me.mockResolvedValue({ termsVersion: 'current' });
    await act(async () => { tree = create(<LegalAcceptanceGate />); });
    await act(async () => { await Promise.resolve(); });
    expect(tree!.toJSON()).toBeNull();
  });
});
