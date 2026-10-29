/**
 * Account Switcher — bottom sheet
 *
 * Replaces the old full-screen `app/account-switcher.tsx` push route (which
 * read as a broken, near-empty page whenever a device only had one active
 * Clerk session: just the two "Add account" rows, a boxed-square back
 * button, and a lot of blank space). Tapping @username on either profile
 * now opens this sheet instead — same solid `BottomSheet` primitive every
 * other sheet in the app uses (grabber, dismiss by tap-outside/swipe/X).
 *
 * Layout/interaction reference: Instagram's "Switching accounts" flow — a
 * list of every signed-in account (avatar, @handle, a check on the current
 * one, tap to switch instantly) with a single "Add account" row below it
 * that opens a small follow-up sheet ("Log into existing account" / "Create
 * new account").
 *
 * Multi-account: any mix of buyer/seller accounts, up to MAX_ACCOUNTS (8) on
 * one device. Every row (not just the active one) shows its real Buyer/Seller
 * label, sourced from the server (Clerk's own session/user object carries no
 * such signal) via GET /auth/account-types. Any signed-in row can be logged
 * out individually (Clerk's per-session signOut) without touching the rest.
 *
 * Only accounts the person actually signed into on this device are listed
 * (plus the other profile of the same login, which they created) — never
 * sample accounts, not even in preview. With nothing to switch to (a single
 * account, or preview's no session at all) the sheet opens straight on the
 * "Add account" view instead of a list with nowhere to go.
 *
 * Switching runs through QuickAccountSwitchContext's `switchAccount`, the
 * same covered transition as the tab bar hold (lib/accountSwitchTransition.ts).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, View, Text, StyleSheet, Pressable } from 'react-native';

import { Icon } from '@/components/ui/Icon';

import { useRouter } from 'expo-router';

import { useAuth, useClerk, useSessionList } from '@clerk/expo';

import { haptics } from '@/lib/haptics';

import { BottomSheet } from '@/components/ui/BottomSheet';

import { ListRow } from '@/components/ui';

import { useColors } from '@/hooks/useColors';

import { useApi } from '@/hooks/useApi';

import { SPACING } from '@/constants/spacing';

import { TYPE_SCALE } from '@/constants/typography';

import { FONT } from '@/lib/theme';

import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';

import { useRole } from '@/contexts/RoleContext';

import { useQuickAccountSwitch } from '@/contexts/QuickAccountSwitchContext';

import { MAX_ACCOUNTS_MESSAGE, getHandle, getDisplayName, resolveAccountTypeLabel, isAtAccountCap } from '@/lib/accountSwitcherHelpers';

import { useLinkedProfiles } from '@/hooks/useLinkedProfiles';

import { addProfileLabel, otherRole, profilesMissingFromDevice } from '@/lib/linkedProfiles';

export interface AccountSwitcherSheetProps {
  visible: boolean;
  onClose: () => void;
}

interface AccountRow {
  id: string;
  displayName: string;
  handle: string;
  imageUri?: string | null;
  accountType: 'Buyer' | 'Seller';
  current: boolean;
}

export function AccountSwitcherSheet({ visible, onClose }: AccountSwitcherSheetProps) {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const { sessionId: activeSessionId } = useAuth();
  const { isLoaded: sessionsLoaded, sessions, setActive } = useSessionList();
  const clerk = useClerk();
  const { role } = useRole();
  const { switchAccount } = useQuickAccountSwitch();
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [loggingOutId, setLoggingOutId] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  // Back from an Add account view the sheet opened on by itself.
  const [listRequested, setListRequested] = useState(false);
  const [serverInfo, setServerInfo] = useState<Record<string, {
    accountType: 'buyer' | 'seller' | null;
    username: string | null;
    avatarUrl: string | null;
    displayName: string | null;
  }>>({});

  const isPreview = isBuyerDevPreview() || isSellerDevPreview();

  // The tab bar's Profile hold opens this sheet while the finger is still
  // down, and on web lifting it arrives as a click on whichever row now sits
  // under it ("Create new account" lands right over the Profile tab). Rows
  // act only on a press that started after the sheet opened. Native never
  // turns a release into a press on a view the touch didn't start on.
  const pressArmed = useRef(Platform.OS !== 'web');
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible || typeof window === 'undefined') return;
    pressArmed.current = false;
    const arm = () => { pressArmed.current = true; };
    window.addEventListener('pointerdown', arm, true);
    window.addEventListener('keydown', arm, true);
    return () => {
      window.removeEventListener('pointerdown', arm, true);
      window.removeEventListener('keydown', arm, true);
    };
  }, [visible]);
  const armed = <A extends unknown[]>(handler: (...args: A) => void) => (...args: A) => {
    if (pressArmed.current) handler(...args);
  };
  // The buyer/seller profile of this same login, even when it isn't signed
  // in on this device yet (one login = one buyer + one seller).
  const linked = useLinkedProfiles({ enabled: visible });

  // "Only real sessions on this device" — Clerk's session list is itself
  // device/client-scoped; filtering to active just drops any session Clerk
  // has already ended (e.g. a token that expired elsewhere).
  const activeSessions = (sessions ?? []).filter((session) => session.status === 'active' && session.user);

  useEffect(() => {
    if (isPreview || activeSessions.length === 0) return;
    const ids = activeSessions.map((session) => session.user!.id);
    let cancelled = false;
    api.auth.accountTypes(ids).then((res) => {
      if (!cancelled) setServerInfo(res.accountTypes);
    }).catch(() => {
      // Falls back to Clerk-only data (role label defaults to Buyer below) —
      // never blocks the switcher from opening over a network hiccup.
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview, activeSessions.map((s) => s.id).join(',')]);

  // Real signed-in sessions only (preview has none).
  const accounts: AccountRow[] = activeSessions.map((session) => {
    const sessionUser = session.user!;
    const isActive = session.id === activeSessionId;
    const info = serverInfo[sessionUser.id];
    return {
      id: session.id,
      displayName: getDisplayName(sessionUser, info?.displayName),
      handle: getHandle(sessionUser, info?.username),
      imageUri: info?.avatarUrl ?? sessionUser.imageUrl,
      accountType: resolveAccountTypeLabel(isActive, role, info?.accountType),
      current: isActive,
    };
  });

  const sameLoginNotOnDevice = isPreview ? [] : profilesMissingFromDevice(linked.data?.profiles, activeSessions);
  const nothingToSwitchTo = (isPreview || sessionsLoaded)
    && !accounts.some((account) => !account.current)
    && sameLoginNotOnDevice.length === 0;
  const addAccountView = showAddAccount || (nothingToSwitchTo && !listRequested);
  const hasList = accounts.length > 0 || sameLoginNotOnDevice.length > 0;
  const currentLinkedRole = linked.data?.profiles.find((p) => p.isCurrent)?.role ?? (role === 'seller' ? 'seller' : 'buyer');
  const addRole = otherRole(currentLinkedRole);
  const canAddSameLogin = !!linked.data?.canAdd[addRole];

  async function handleSwitchSameLogin(clerkId: string) {
    if (switchingId || loggingOutId) return;
    haptics.light();
    const profile = sameLoginNotOnDevice.find((p) => p.clerkId === clerkId);
    setSwitchingId(clerkId);
    handleClose();
    const result = await switchAccount({
      activate: () => linked.activateProfile(clerkId),
      userId: clerkId,
      kind: profile?.role ?? null,
      handle: profile?.username ? `@${profile.username}` : (profile?.displayName ?? ''),
      avatarUri: profile?.avatarUrl ?? null,
    });
    setSwitchingId(null);
    if (result === 'failed') Alert.alert("Couldn't switch accounts. Try again.");
  }

  function handleAddSameLogin() {
    haptics.light();
    handleClose();
    router.push(`/account-type-settings?add=${addRole}` as never);
  }
  const atCap = !isPreview && isAtAccountCap(activeSessions.length);

  async function handleSwitch(account: AccountRow) {
    if (account.current || switchingId || loggingOutId || !setActive) return;
    const userId = activeSessions.find((session) => session.id === account.id)?.user?.id ?? null;
    setSwitchingId(account.id);
    handleClose();
    // Lands on the account's own home behind the switch cover, revealed only
    // once its caches are scoped and its home has painted.
    await switchAccount({
      activate: () => setActive({ session: account.id }),
      userId,
      kind: userId ? serverInfo[userId]?.accountType ?? null : null,
      handle: account.handle,
      avatarUri: account.imageUri ?? null,
    });
    setSwitchingId(null);
  }

  async function handleLogOut(account: AccountRow) {
    if (isPreview || switchingId || loggingOutId) return;
    Alert.alert(
      `Sign out @${account.handle.replace(/^@/, '')}?`,
      account.current
        ? "You'll stay signed in to your other accounts."
        : undefined,
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Sign out', style: 'destructive',
          onPress: async () => {
            setLoggingOutId(account.id);
            try {
              // Ends just this one session — the documented way to sign a
              // single account out of a multi-session device without
              // touching any other signed-in session.
              await clerk.signOut({ sessionId: account.id });
            } catch {
              Alert.alert("Couldn't log out", 'Try again.');
            } finally {
              setLoggingOutId(null);
            }
          },
        },
      ],
    );
  }

  function handleAddAccountPress() {
    if (atCap) {
      Alert.alert('Account limit reached', MAX_ACCOUNTS_MESSAGE);
      return;
    }
    setShowAddAccount(true);
  }

  function handleLogIntoExisting() {
    handleClose();
    router.push('/sign-in?addAccount=1' as never);
  }

  function handleCreateNew() {
    handleClose();
    // Starts the real signup flow at step 1 (the Buyer/Seller choice) with a
    // fresh draft — see app/onboarding.tsx's addAccount handling, fixed
    // alongside this sheet so a stale device-wide pending-flow value can no
    // longer skip that first question or carry over the signed-in account's
    // own role.
    router.push('/onboarding?addAccount=1' as never);
  }

  const s = styles(colors);

  function handleClose() {
    // Always closes back to the account list — never leaves a reopen sitting
    // on the "Add account" sub-view.
    setShowAddAccount(false);
    setListRequested(false);
    onClose();
  }

  function handleAddAccountBack() {
    if (!hasList) {
      // Opened straight on Add account with no list behind it (preview).
      handleClose();
      return;
    }
    setShowAddAccount(false);
    setListRequested(true);
  }

  // One BottomSheet (one Modal); the sub-view swaps its content instead of
  // stacking a second sheet — two sibling BottomSheets (each its own Modal)
  // fought each other on web: opening the second while the first's `visible`
  // flipped false raced its close animation and dropped both.
  return (
    <BottomSheet visible={visible} onClose={handleClose} testID="account-switcher-sheet">
      {addAccountView ? (
        <>
          <View style={s.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={handleAddAccountBack}
            >
              <Icon name="chevron-left" size={22} color={colors.mutedForeground} />
            </Pressable>
            <Text style={s.headerTitle}>Add account</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={handleClose}
            >
              <Icon name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <View style={s.list}>
            {canAddSameLogin && (
              <ListRow
                icon={addRole === 'seller' ? 'shopping-bag' : 'shopping-cart'}
                title={addProfileLabel(addRole)}
                subtitle="Same login, no new email or password"
                onPress={armed(handleAddSameLogin)}
                testID="account-switcher-add-same-login"
              />
            )}
            <ListRow
              icon="log-in"
              title="Log into existing account"
              onPress={armed(handleLogIntoExisting)}
              testID="account-switcher-log-into-existing"
            />
            <ListRow
              icon="user-plus"
              title="Create new account"
              onPress={armed(handleCreateNew)}
              testID="account-switcher-create-new"
            />
          </View>
        </>
      ) : (
        <>
          <View style={s.header}>
            <Text style={s.headerTitle}>Switch account</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={handleClose}
            >
              <Icon name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={s.list}>
            {accounts.map((account) => (
              <ListRow
                key={account.id}
                avatar={{ uri: account.imageUri, name: account.displayName }}
                title={account.handle}
                subtitle={account.accountType}
                disabled={!!switchingId || !!loggingOutId}
                onPress={account.current ? undefined : armed(() => { void handleSwitch(account); })}
                testID={`account-switcher-row-${account.id}`}
                right={
                  <View style={s.rowRight}>
                    {switchingId === account.id || loggingOutId === account.id ? (
                      <Icon name="loader" size={18} color={colors.mutedForeground} />
                    ) : (
                      <>
                        {account.current && (
                          <View style={[s.checkBadge, { backgroundColor: colors.primary }]}>
                            <Icon name="check" size={13} color={colors.primaryForeground} />
                          </View>
                        )}
                        {!isPreview && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Sign out ${account.handle}`}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            disabled={!!switchingId || !!loggingOutId}
                            onPress={armed(() => { void handleLogOut(account); })}
                            style={s.logOutBtn}
                          >
                            <Icon name="log-out" size={16} color={colors.mutedForeground} />
                          </Pressable>
                        )}
                      </>
                    )}
                  </View>
                }
              />
            ))}
            {sameLoginNotOnDevice.map((profile) => (
              <ListRow
                key={profile.clerkId}
                avatar={{ uri: profile.avatarUrl, name: profile.displayName ?? profile.username ?? '' }}
                title={profile.username ? `@${profile.username}` : (profile.displayName ?? '')}
                subtitle={profile.role === 'seller' ? 'Seller' : 'Buyer'}
                disabled={!!switchingId || !!loggingOutId}
                onPress={armed(() => { void handleSwitchSameLogin(profile.clerkId); })}
                testID={`account-switcher-row-${profile.clerkId}`}
                right={switchingId === profile.clerkId
                  ? <Icon name="loader" size={18} color={colors.mutedForeground} />
                  : undefined}
              />
            ))}
          </View>

          <View style={s.divider} />

          <ListRow
            icon="plus-circle"
            title="Add account"
            subtitle={atCap ? MAX_ACCOUNTS_MESSAGE : undefined}
            disabled={atCap}
            onPress={armed(handleAddAccountPress)}
            testID="account-switcher-add-account"
          />
        </>
      )}
    </BottomSheet>
  );
}

function styles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm,
    },
    headerTitle: { ...TYPE_SCALE.title2, fontFamily: FONT.semibold, color: colors.foreground },
    list: { paddingHorizontal: SPACING.md },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: SPACING.xs },
    rowRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    checkBadge: {
      width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    },
    logOutBtn: { padding: 2 },
  });
}
