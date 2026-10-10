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
 * Preview mode (`?bt_preview=buyer|seller`, no real Clerk session) shows two
 * fixed demo accounts — @ava (Buyer) and @atelier.noire (Brand) — so the
 * switcher is fully explorable without a backend. Switching between them in
 * preview just flips the local preview role; there's no real second session
 * to activate.
 */
import React, { useEffect, useState } from 'react';
import { Alert, View, Text, StyleSheet, Pressable } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { useAuth, useClerk, useSessionList } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ListRow } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/hooks/useApi';
import { SPACING } from '@/constants/spacing';
import { TYPE_SCALE } from '@/constants/typography';
import { FONT } from '@/lib/theme';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { useRole } from '@/contexts/RoleContext';
import {
  MAX_ACCOUNTS_MESSAGE, getHandle, getDisplayName, resolveAccountTypeLabel, isAtAccountCap,
} from '@/lib/accountSwitcherHelpers';

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
  const { sessions, setActive } = useSessionList();
  const clerk = useClerk();
  const { role, setRole } = useRole();
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [loggingOutId, setLoggingOutId] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [serverInfo, setServerInfo] = useState<Record<string, {
    accountType: 'buyer' | 'seller' | null;
    username: string | null;
    avatarUrl: string | null;
    displayName: string | null;
  }>>({});

  const isPreview = isBuyerDevPreview() || isSellerDevPreview();

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

  const previewAccounts: AccountRow[] = [
    { id: 'preview-buyer', displayName: 'Ava', handle: '@ava', accountType: 'Buyer', current: role === 'buyer' },
    { id: 'preview-seller', displayName: 'Atelier Noire', handle: '@atelier.noire', accountType: 'Seller', current: role === 'seller' },
  ];

  const realAccounts: AccountRow[] = activeSessions.map((session) => {
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

  const accounts = isPreview ? previewAccounts : realAccounts;
  const atCap = !isPreview && isAtAccountCap(activeSessions.length);

  async function handleSwitch(account: AccountRow) {
    if (account.current || switchingId || loggingOutId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isPreview) {
      // No real second session in preview — just flip the local role so the
      // rest of the app (buyer vs seller routing) follows immediately.
      await setRole(account.id === 'preview-seller' ? 'seller' : 'buyer');
      onClose();
      return;
    }
    if (!setActive) return;
    setSwitchingId(account.id);
    try {
      await setActive({ session: account.id });
      onClose();
      // AuthGate re-routes to the right buyer/seller shell (reading the
      // now-active account's own server-authoritative role) once Clerk
      // propagates the new session; no manual navigation needed here.
    } catch {
      setSwitchingId(null);
    }
  }

  async function handleLogOut(account: AccountRow) {
    if (isPreview || switchingId || loggingOutId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      `Log out @${account.handle.replace(/^@/, '')}?`,
      account.current
        ? "You'll stay logged into your other accounts."
        : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out', style: 'destructive',
          onPress: async () => {
            setLoggingOutId(account.id);
            try {
              // Ends just this one session — the documented way to sign a
              // single account out of a multi-session device without
              // touching any other signed-in session.
              await clerk.signOut({ sessionId: account.id });
            } catch {
              Alert.alert('Error', "Couldn't log out that account. Try again.");
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert('Account limit reached', MAX_ACCOUNTS_MESSAGE);
      return;
    }
    setShowAddAccount(true);
  }

  function handleLogIntoExisting() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowAddAccount(false);
    onClose();
    router.push('/sign-in?addAccount=1' as never);
  }

  function handleCreateNew() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowAddAccount(false);
    onClose();
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
    onClose();
  }

  // One BottomSheet (one Modal); the sub-view swaps its content instead of
  // stacking a second sheet — two sibling BottomSheets (each its own Modal)
  // fought each other on web: opening the second while the first's `visible`
  // flipped false raced its close animation and dropped both.
  return (
    <BottomSheet visible={visible} onClose={handleClose} testID="account-switcher-sheet">
      {showAddAccount ? (
        <>
          <View style={s.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => setShowAddAccount(false)}
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
            <ListRow
              icon="log-in"
              title="Log into existing account"
              onPress={handleLogIntoExisting}
              testID="account-switcher-log-into-existing"
            />
            <ListRow
              icon="user-plus"
              title="Create new account"
              onPress={handleCreateNew}
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
                onPress={account.current ? undefined : () => handleSwitch(account)}
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
                            accessibilityLabel={`Log out ${account.handle}`}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            disabled={!!switchingId || !!loggingOutId}
                            onPress={() => handleLogOut(account)}
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
          </View>

          <View style={s.divider} />

          <ListRow
            icon="plus-circle"
            title="Add account"
            subtitle={atCap ? MAX_ACCOUNTS_MESSAGE : undefined}
            disabled={atCap}
            onPress={handleAddAccountPress}
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
