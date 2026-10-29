/**
 * AccountSwitcherSheet, mounted: lists only accounts actually signed in on
 * this device (never sample accounts, preview included), opens straight on
 * "Add account" when there is nothing to switch to, and hands a row tap to
 * the shared covered switch (QuickAccountSwitchContext.switchAccount).
 *
 * BottomSheet/ListRow/Icon are swapped for plain hosts so the test reads the
 * sheet's own decisions, not the reanimated sheet primitive.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Session = { id: string; status: string; user: { id: string; username: string; firstName?: string; imageUrl?: string } };

const state = vi.hoisted(() => ({
  preview: false,
  sessions: [] as Session[],
  activeSessionId: null as string | null,
  setActive: vi.fn(async () => {}),
  switchAccount: vi.fn(async (request: { activate: () => Promise<void> }) => { await request.activate(); return 'switched'; }),
  accountTypes: {} as Record<string, { accountType: 'buyer' | 'seller' | null; username: string | null; avatarUrl: string | null; displayName: string | null }>,
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ sessionId: state.activeSessionId }),
  useSessionList: () => ({ isLoaded: true, sessions: state.sessions, setActive: state.setActive }),
  useClerk: () => ({ signOut: async () => {} }),
}));
vi.mock('@/lib/devPreview', () => ({
  isBuyerDevPreview: () => false,
  isSellerDevPreview: () => state.preview,
}));
vi.mock('@/contexts/RoleContext', () => ({ useRole: () => ({ role: 'seller', setRole: async () => {} }) }));
vi.mock('@/contexts/QuickAccountSwitchContext', () => ({
  useQuickAccountSwitch: () => ({ quickSwitch: () => {}, switchAccount: state.switchAccount }),
}));
vi.mock('@/hooks/useApi', () => ({
  useApi: () => ({ auth: { accountTypes: async () => ({ accountTypes: state.accountTypes }) } }),
}));
vi.mock('@/hooks/useLinkedProfiles', () => ({
  useLinkedProfiles: () => ({ data: null, loading: false, activateProfile: async () => {} }),
}));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#000' }) }));
vi.mock('@/lib/haptics', () => ({ haptics: { light: () => {}, selection: () => {} } }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/ui/BottomSheet', () => ({
  BottomSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? <>{children}</> : null),
}));
vi.mock('@/components/ui', () => ({
  ListRow: (props: { testID?: string; title: string; subtitle?: string; onPress?: () => void }) => (
    <row testID={props.testID} title={props.title} subtitle={props.subtitle} onPress={props.onPress} />
  ),
}));

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX { interface IntrinsicElements { row: Record<string, unknown> } }
}

import { AccountSwitcherSheet } from '@/components/AccountSwitcherSheet';

function session(id: string, userId: string, username: string): Session {
  return { id, status: 'active', user: { id: userId, username } };
}

async function mount(onClose = vi.fn()) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<AccountSwitcherSheet visible onClose={onClose} />); });
  return { tree, onClose };
}

const rows = (tree: ReactTestRenderer) => tree.root.findAll((n) => (n.type as unknown) === 'row').map((n) => n.props.testID as string);
const titles = (tree: ReactTestRenderer) => tree.root.findAll((n) => (n.type as unknown) === 'row').map((n) => n.props.title as string);

beforeEach(() => {
  state.preview = false;
  state.sessions = [];
  state.activeSessionId = null;
  state.accountTypes = {};
  state.setActive.mockClear();
  state.switchAccount.mockClear();
});

describe('AccountSwitcherSheet', () => {
  it('preview (no real session): no sample accounts, opens straight on Add account', async () => {
    state.preview = true;
    const { tree, onClose } = await mount();
    expect(rows(tree)).toEqual(['account-switcher-log-into-existing', 'account-switcher-create-new']);
    expect(titles(tree).join(' ')).not.toMatch(/@ava|@atelier\.noire|Your store|Your account/);
    // Nothing behind the Add account view: Back closes instead of showing an empty list.
    const back = tree.root.find((n) => n.props.accessibilityLabel === 'Back');
    await act(async () => { back.props.onPress(); });
    expect(onClose).toHaveBeenCalled();
  });

  it('one signed-in account: opens straight on Add account; Back shows just that real account', async () => {
    state.sessions = [session('sess_a', 'user_a', 'maya')];
    state.activeSessionId = 'sess_a';
    const { tree } = await mount();
    expect(rows(tree)).toEqual(['account-switcher-log-into-existing', 'account-switcher-create-new']);
    const back = tree.root.find((n) => n.props.accessibilityLabel === 'Back');
    await act(async () => { back.props.onPress(); });
    expect(rows(tree)).toEqual(['account-switcher-row-sess_a', 'account-switcher-add-account']);
    expect(titles(tree)[0]).toBe('@maya');
  });

  it('two signed-in accounts: lists exactly those, and a tap goes through the covered switch', async () => {
    state.sessions = [session('sess_a', 'user_a', 'maya'), session('sess_b', 'user_b', 'studio.b')];
    state.activeSessionId = 'sess_a';
    state.accountTypes = {
      user_a: { accountType: 'buyer', username: 'maya', avatarUrl: null, displayName: 'Maya' },
      user_b: { accountType: 'seller', username: 'studio.b', avatarUrl: null, displayName: 'Studio B' },
    };
    const { tree, onClose } = await mount();
    expect(rows(tree)).toEqual(['account-switcher-row-sess_a', 'account-switcher-row-sess_b', 'account-switcher-add-account']);
    const other = tree.root.find((n) => n.props.testID === 'account-switcher-row-sess_b');
    await act(async () => { await other.props.onPress(); });
    expect(onClose).toHaveBeenCalled();
    expect(state.switchAccount).toHaveBeenCalledTimes(1);
    expect(state.switchAccount.mock.calls[0][0]).toMatchObject({ userId: 'user_b', kind: 'seller', handle: '@studio.b' });
    expect(state.setActive).toHaveBeenCalledWith({ session: 'sess_b' });
  });
});
