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
 * Preview mode (`?bt_preview=buyer|seller`, no real Clerk session) shows two
 * fixed demo accounts — @ava (Buyer) and @atelier.noire (Brand) — so the
 * switcher is fully explorable without a backend. Switching between them in
 * preview just flips the local preview role; there's no real second session
 * to activate.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, useSessionList } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ListRow } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { SPACING } from '@/constants/spacing';
import { TYPE_SCALE } from '@/constants/typography';
import { FONT } from '@/lib/theme';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { useRole } from '@/contexts/RoleContext';

export interface AccountSwitcherSheetProps {
  visible: boolean;
  onClose: () => void;
}

interface AccountRow {
  id: string;
  displayName: string;
  handle: string;
  imageUri?: string | null;
  accountType: 'Buyer' | 'Brand';
  current: boolean;
  /** Only ever populated for the two demo rows — see the file header note on
   *  why real cross-account unread counts aren't wired yet. */
  unreadCount?: number;
}

function getHandle(sessionUser: {
  username?: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
}): string {
  if (sessionUser.username) return `@${sessionUser.username}`;
  const email = sessionUser.primaryEmailAddress?.emailAddress;
  return email ? `@${email.split('@')[0]}` : '@you';
}

function getDisplayName(sessionUser: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}): string {
  const parts = [sessionUser.firstName, sessionUser.lastName].filter(Boolean);
  if (parts.length) return parts.join(' ');
  return sessionUser.username ?? 'Your account';
}

export function AccountSwitcherSheet({ visible, onClose }: AccountSwitcherSheetProps) {
  const colors = useColors();
  const router = useRouter();
  const { sessionId: activeSessionId } = useAuth();
  const { sessions, setActive } = useSessionList();
  const { role, setRole } = useRole();
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);

  const isPreview = isBuyerDevPreview() || isSellerDevPreview();

  const previewAccounts: AccountRow[] = [
    { id: 'preview-buyer', displayName: 'Ava', handle: '@ava', accountType: 'Buyer', current: role === 'buyer' },
    { id: 'preview-seller', displayName: 'Atelier Noire', handle: '@atelier.noire', accountType: 'Brand', current: role === 'seller' },
  ];

  const realAccounts: AccountRow[] = (sessions ?? [])
    .filter((session) => session.status === 'active' && session.user)
    .map((session) => {
      const sessionUser = session.user!;
      // No per-account role signal exists in Clerk's own session/user object
      // (role lives in this device's own RoleContext, per-user-scoped) — the
      // active session's row can read the live role; a different, inactive
      // session's account type isn't knowable without a dedicated backend
      // field, so it's labelled generically rather than guessed.
      const isActive = session.id === activeSessionId;
      return {
        id: session.id,
        displayName: getDisplayName(sessionUser),
        handle: getHandle(sessionUser),
        imageUri: sessionUser.imageUrl,
        accountType: isActive ? (role === 'seller' ? 'Brand' : 'Buyer') : 'Buyer',
        current: isActive,
      } as AccountRow;
    });

  const accounts = isPreview ? previewAccounts : realAccounts;

  async function handleSwitch(account: AccountRow) {
    if (account.current || switchingId) return;
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
      // AuthGate re-routes to the right buyer/seller shell once Clerk
      // propagates the new session; no manual navigation needed here.
    } catch {
      setSwitchingId(null);
    }
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

  return (
    <>
      <BottomSheet visible={visible && !showAddAccount} onClose={onClose} testID="account-switcher-sheet">
        <View style={s.header}>
          <Text style={s.headerTitle}>Switch account</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={onClose}
          >
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <View style={s.list}>
          {accounts.map((account) => (
            <ListRow
              key={account.id}
              avatar={{ uri: account.imageUri, name: account.displayName }}
              title={account.handle}
              subtitle={account.accountType}
              disabled={!!switchingId}
              onPress={account.current ? undefined : () => handleSwitch(account)}
              testID={`account-switcher-row-${account.id}`}
              right={
                switchingId === account.id ? (
                  <Feather name="loader" size={18} color={colors.mutedForeground} />
                ) : account.current ? (
                  <View style={[s.checkBadge, { backgroundColor: colors.primary }]}>
                    <Feather name="check" size={13} color={colors.primaryForeground} />
                  </View>
                ) : account.unreadCount ? (
                  <View style={s.unreadBadge}>
                    <Text style={s.unreadBadgeText}>{account.unreadCount > 9 ? '9+' : account.unreadCount}</Text>
                  </View>
                ) : null
              }
            />
          ))}
        </View>

        <View style={s.divider} />

        <ListRow
          icon="plus-circle"
          title="Add account"
          onPress={() => setShowAddAccount(true)}
          testID="account-switcher-add-account"
        />
      </BottomSheet>

      <BottomSheet visible={visible && showAddAccount} onClose={() => setShowAddAccount(false)} testID="account-switcher-add-account-sheet">
        <View style={s.header}>
          <Text style={s.headerTitle}>Add account</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setShowAddAccount(false)}
          >
            <Feather name="x" size={22} color={colors.mutedForeground} />
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
      </BottomSheet>
    </>
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
    checkBadge: {
      width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    },
    unreadBadge: {
      minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
    },
    unreadBadgeText: { ...TYPE_SCALE.caption, fontFamily: FONT.semibold, color: colors.accentForeground },
  });
}
