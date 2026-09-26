/**
 * Account Switcher screen
 *
 * Shows every active Clerk session on this device, marks the current session,
 * and lets the user switch, add an existing account, or create a new one.
 *
 * Layout reference: Shopify's "Switch account" list (avatar + email + check
 * on the active row, "Add account" as its own row) — a Mobbin screen cited in
 * docs/polish/screens/buyer-settings-rebuild.md.
 */
import React, { useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, useSessionList } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionHeader } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { Card, ListRow } from '@/components/ui';
import { SPACING } from '@/constants/spacing';
import { TYPE_SCALE } from '@/constants/typography';
import { FONT } from '@/lib/theme';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function getDisplayName(sessionUser: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
}): string {
  const parts = [sessionUser.firstName, sessionUser.lastName].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (sessionUser.username) return sessionUser.username;
  return sessionUser.primaryEmailAddress?.emailAddress ?? 'Unknown account';
}

function getEmail(sessionUser: {
  primaryEmailAddress?: { emailAddress: string } | null;
}): string {
  return sessionUser.primaryEmailAddress?.emailAddress ?? '';
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function AccountSwitcherScreen() {
  const colors = useColors();
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded: authLoaded, sessionId: activeSessionId } = useAuth();
  const { sessions, isLoaded, setActive } = useSessionList();
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  async function handleSwitch(targetSessionId: string) {
    if (!setActive || targetSessionId === activeSessionId || switchingId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSwitchingId(targetSessionId);
    try {
      await setActive({ session: targetSessionId });
      // AuthGate will re-route once Clerk propagates the new session.
      router.replace('/' as never);
    } catch {
      setSwitchingId(null);
    }
  }

  function handleAddExisting() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/sign-in?addAccount=1' as never);
  }

  function handleCreateNew() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/onboarding?addAccount=1' as never);
  }

  const loading = !isLoaded && !authLoaded;

  // Only show active sessions (status === 'active' means logged-in)
  const activeSessions = (sessions ?? []).filter((session) => session.status === 'active');

  return (
    <View style={s.root}>
      <ScreenHeader title="Accounts" variant="push" onBack={() => goBackOr(router)} />

      {loading ? (
        <View style={s.skeletonContainer}>
          {[0, 1].map((i) => (
            <View key={i} style={s.skeletonRow}>
              <View style={s.skeletonAvatar} />
              <View style={s.skeletonText}>
                <View style={s.skeletonLine} />
                <View style={[s.skeletonLine, s.skeletonLineShort]} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + SPACING.xl }]}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical={false}
        >
          {/* ── Session list ── */}
          {activeSessions.length > 0 && (
            <View style={s.section}>
              <SectionHeader title="SIGNED-IN ACCOUNTS" />
              <Card style={s.card}>
                {activeSessions.map((session, index) => {
                  const sessionUser = session.user;
                  if (!sessionUser) return null;

                  const isActive = session.id === activeSessionId;
                  const isSwitching = switchingId === session.id;
                  const displayName = getDisplayName(sessionUser);
                  const email = getEmail(sessionUser);

                  return (
                    <React.Fragment key={session.id}>
                      <ListRow
                        avatar={{ uri: sessionUser.imageUrl, name: displayName }}
                        title={displayName}
                        subtitle={email || undefined}
                        disabled={!!switchingId}
                        onPress={isActive ? undefined : () => handleSwitch(session.id)}
                        testID={`account-switcher-session-${session.id}`}
                        right={
                          isSwitching ? (
                            <ActivityIndicator size="small" color={colors.mutedForeground} />
                          ) : isActive ? (
                            <View style={s.activeBadge}>
                              <Text style={s.activeBadgeText}>Current</Text>
                            </View>
                          ) : (
                            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                          )
                        }
                      />
                      {index < activeSessions.length - 1 && <View style={s.divider} />}
                    </React.Fragment>
                  );
                })}
              </Card>
            </View>
          )}

          {/* ── Actions ── */}
          <View style={s.section}>
            <SectionHeader title="ADD ACCOUNT" />
            <Card style={s.card}>
              <ListRow
                icon="log-in"
                title="Add existing account"
                subtitle="Sign in to another Brandthread account"
                chevron
                onPress={handleAddExisting}
              />
              <View style={s.divider} />
              <ListRow
                icon="plus-circle"
                title="Create new account"
                subtitle="Start a new brand on Brandthread"
                chevron
                onPress={handleCreateNew}
              />
            </Card>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 46;

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },

    scrollContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md },

    section: { marginBottom: SPACING.xl - 2 },

    card: { padding: 0, paddingHorizontal: SPACING.md },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

    activeBadge: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    activeBadgeText: {
      ...TYPE_SCALE.caption,
      fontFamily: FONT.semibold,
      color: colors.mutedForeground,
    },

    // Loading skeleton
    skeletonContainer: {
      marginHorizontal: SPACING.md,
      marginTop: SPACING.md,
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    skeletonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    skeletonAvatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      backgroundColor: colors.muted,
    },
    skeletonText: { flex: 1, gap: 8 },
    skeletonLine: {
      height: 12,
      borderRadius: 4,
      backgroundColor: colors.muted,
      width: '60%',
    },
    skeletonLineShort: { width: '40%' },
  });
}
