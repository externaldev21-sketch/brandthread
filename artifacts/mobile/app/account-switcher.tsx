/**
 * Account Switcher screen
 *
 * Shows every active Clerk session on this device, marks the current session,
 * and lets the user switch, add an existing account, or create a new one.
 */
import React, { useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, useSessionList } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { Header } from '@/components/layout';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON, SURFACE, ACCENT, CARD_ELEVATED,
} from '@/lib/theme';

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

  function handleBack() {
    Haptics.selectionAsync();
    goBackOr(router);
  }

  function handleAddExisting() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/sign-in?addAccount=1' as never);
  }

  function handleCreateNew() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/onboarding?addAccount=1' as never);
  }

  // Loading skeleton while Clerk hydrates
  if (!isLoaded && !authLoaded) {
    return (
      <View style={s.root}>
        <Header title="Accounts" onBack={handleBack} />

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
      </View>
    );
  }

  // Only show active sessions (status === 'active' means logged-in)
  const activeSessions = (sessions ?? []).filter((s) => s.status === 'active');

  return (
    <View style={s.root}>
      {/* ── Header ── */}
      <Header title="Accounts" onBack={handleBack} />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.scrollContent,
          { paddingBottom: insets.bottom + SP.xl },
        ]}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
      >
        {/* ── Session list ── */}
        {activeSessions.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Signed-in accounts</Text>
            <View style={s.card}>
              {activeSessions.map((session, index) => {
                const sessionUser = session.user;
                if (!sessionUser) return null;

                const isActive = session.id === activeSessionId;
                const isSwitching = switchingId === session.id;
                const displayName = getDisplayName(sessionUser);
                const email = getEmail(sessionUser);
                const imageUrl = sessionUser.imageUrl;
                const initials = getInitials(displayName);
                const isLast = index === activeSessions.length - 1;

                return (
                  <React.Fragment key={session.id}>
                    <TouchableOpacity
                      style={[s.sessionRow, isActive && s.sessionRowActive]}
                      onPress={() => handleSwitch(session.id)}
                      activeOpacity={isActive ? 1 : 0.75}
                      accessibilityRole="button"
                      accessibilityLabel={
                        isActive
                          ? `${displayName}, current account`
                          : `Switch to ${displayName}`
                      }
                      accessibilityState={{ selected: isActive }}
                      disabled={!!switchingId}
                    >
                      {/* Avatar */}
                      <View style={[s.avatarWrap, isActive && s.avatarWrapActive]}>
                        {imageUrl ? (
                          <Image
                            source={{ uri: imageUrl }}
                            style={s.avatarImage}
                            accessibilityLabel={`${displayName} avatar`}
                          />
                        ) : (
                          <View style={s.avatarFallback}>
                            <Text style={s.avatarInitials}>{initials}</Text>
                          </View>
                        )}
                        {isActive && (
                          <View style={s.activeDot} accessibilityLabel="Active" />
                        )}
                      </View>

                      {/* Name + email */}
                      <View style={s.sessionInfo}>
                        <Text style={s.sessionName} numberOfLines={1}>
                          {displayName}
                        </Text>
                        {!!email && (
                          <Text style={s.sessionEmail} numberOfLines={1}>
                            {email}
                          </Text>
                        )}
                      </View>

                      {/* Right: active badge OR spinner OR chevron */}
                      <View style={s.sessionRight}>
                        {isSwitching ? (
                          <ActivityIndicator size="small" color={MUTED} />
                        ) : isActive ? (
                          <View style={s.activeBadge}>
                            <Text style={s.activeBadgeText}>Current</Text>
                          </View>
                        ) : (
                          <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />
                        )}
                      </View>
                    </TouchableOpacity>

                    {!isLast && <View style={s.divider} />}
                  </React.Fragment>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Actions ── */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Add account</Text>
          <View style={s.card}>
            {/* Add existing account */}
            <TouchableOpacity
              style={s.actionRow}
              onPress={handleAddExisting}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Sign in to an existing account"
            >
              <View style={s.actionIconWrap}>
                <Feather name="log-in" size={18} color={FG} />
              </View>
              <View style={s.actionInfo}>
                <Text style={s.actionTitle}>Add existing account</Text>
                <Text style={s.actionSubtitle}>Sign in to another Brandthread account</Text>
              </View>
              <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />
            </TouchableOpacity>

            <View style={s.divider} />

            {/* Create new account */}
            <TouchableOpacity
              style={s.actionRow}
              onPress={handleCreateNew}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Create a new Brandthread account"
            >
              <View style={s.actionIconWrap}>
                <Feather name="plus-circle" size={18} color={FG} />
              </View>
              <View style={s.actionInfo}>
                <Text style={s.actionTitle}>Create new account</Text>
                <Text style={s.actionSubtitle}>Start a new brand on Brandthread</Text>
              </View>
              <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 46;
const ACTIVE_DOT  = 12;

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: SP.md, paddingTop: SP.lg },

  // Section
  section: { marginBottom: SP.lg },
  sectionLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: SP.sm,
    paddingHorizontal: 4,
  },

  // Card container
  card: {
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },

  // Session row
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: 14,
    gap: SP.sm,
  },
  sessionRowActive: {
    backgroundColor: CARD_ELEVATED,
  },

  // Avatar
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    position: 'relative',
  },
  avatarWrapActive: {
    // subtle ring for active account
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: FG,
  },
  activeDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: ACTIVE_DOT,
    height: ACTIVE_DOT,
    borderRadius: ACTIVE_DOT / 2,
    backgroundColor: '#10B981', // SUCCESS green — intentional semantic color
    borderWidth: 2,
    borderColor: CARD_ELEVATED,
  },

  // Session info
  sessionInfo: { flex: 1, gap: 2 },
  sessionName: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  sessionEmail: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },

  // Session right
  sessionRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 64,
  },
  activeBadge: {
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activeBadgeText: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    color: MUTED,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginHorizontal: SP.md,
  },

  // Action rows
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: 14,
    gap: SP.sm,
  },
  actionIconWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: RADIUS.sm,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionInfo: { flex: 1, gap: 2 },
  actionTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  actionSubtitle: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },

  // Loading skeleton
  skeletonContainer: {
    marginHorizontal: SP.md,
    marginTop: SP.lg,
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SP.md,
    gap: SP.sm,
  },
  skeletonAvatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: SURFACE,
  },
  skeletonText: { flex: 1, gap: 8 },
  skeletonLine: {
    height: 12,
    borderRadius: RADIUS.xs,
    backgroundColor: SURFACE,
    width: '60%',
  },
  skeletonLineShort: { width: '40%' },
});
