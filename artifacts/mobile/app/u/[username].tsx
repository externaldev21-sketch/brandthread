/**
 * Public profile route — resolves a username to a buyer or seller profile
 * and renders the appropriate view.
 *
 * Route: /u/[username]  (maps to https://brandthread.app/u/{username})
 *
 * Resolution flow:
 * 1. Normalize the username param (lowercase, strip invalid chars).
 * 2. Fetch GET /api/v1/public/profiles/:username — returns safe public DTO.
 * 3a. If visitor is signed in (auth ready + isSignedIn): navigate internally to
 *     buyer-other-profile or seller-profile using the opaque users.id alias.
 * 3b. If visitor is signed out (auth ready + !isSignedIn): stay on /u/{username}
 *     and render a polished public profile landing page from safe DTO fields only.
 *     No posts, no social graph, no private IDs, no seller commerce data.
 *
 * Never exposes Clerk IDs in the browser URL.
 *
 * Handles: loading, not-found, offline/retry, auth-loading wait.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Image,
  ScrollView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { hapticLight } from '@/lib/haptics';
import {
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import { normalizeUsername } from '@/lib/shareProfile';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { ResponsiveContainer } from '@/components/layout';
import { CONTENT_MAX_WIDTH } from '@/lib/theme';

// ─── Public profile DTO (mirrors GET /api/v1/public/profiles/:username) ──────

export interface PublicProfileDto {
  /**
   * Opaque internal alias for this account.
   * The server may return users.id (DB UUID) or users.clerkId here — callers
   * pass it directly to downstream profile screens; it is never placed in the
   * browser URL.
   */
  id: string;
  username: string;
  accountType: 'buyer' | 'seller';
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  verified: boolean;
}

// ─── Fetcher — no auth required ──────────────────────────────────────────────

const PROD_ORIGIN = 'https://brandthread.app';

async function fetchPublicProfile(username: string): Promise<PublicProfileDto> {
  const apiBase =
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    (process.env.EXPO_PUBLIC_DOMAIN
      ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
      : PROD_ORIGIN);
  const res = await fetch(
    `${apiBase}/api/v1/public/profiles/${encodeURIComponent(username)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(text || `HTTP ${res.status}`), {
      status: res.status,
    });
  }
  return res.json() as Promise<PublicProfileDto>;
}

// ─── Screen state ─────────────────────────────────────────────────────────────

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'not_found'; username: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; profile: PublicProfileDto };

// ─── Avatar helpers ───────────────────────────────────────────────────────────

function getInitials(displayName: string | null, username: string): string {
  const name = displayName?.trim() || username;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// ─── Public landing (signed-out) ─────────────────────────────────────────────

function PublicProfileLanding({
  profile,
  insets,
  onSignIn,
  onJoin,
}: {
  profile: PublicProfileDto;
  insets: { top: number; bottom: number };
  onSignIn: () => void;
  onJoin: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const initials = getInitials(profile.displayName, profile.username);
  const displayName = profile.displayName || `@${profile.username}`;
  const accountLabel =
    profile.accountType === 'seller' ? 'Seller on Brandthread' : 'On Brandthread';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.landingContent,
        { paddingTop: insets.top + SP.lg, paddingBottom: insets.bottom + SP.xxl },
      ]}
      showsVerticalScrollIndicator={false}
      accessible
    >
      <ResponsiveContainer maxWidth={CONTENT_MAX_WIDTH} style={{ paddingHorizontal: 0, alignItems: 'center' }}>
      {/* Brandthread wordmark */}
      <View style={styles.logoRow}>
        <BrandthreadLogo size={28} />
        <Text style={styles.logoText} accessibilityRole="text">
          Brandthread
        </Text>
      </View>

      {/* Avatar */}
      <View style={styles.avatarContainer}>
        {profile.avatarUrl ? (
          <Image
            source={{ uri: profile.avatarUrl }}
            style={styles.avatarImage}
            accessible
            accessibilityLabel={`${displayName}'s profile photo`}
          />
        ) : (
          <View
            style={styles.avatarPlaceholder}
            accessible
            accessibilityLabel={`${displayName}'s profile photo`}
          >
            <Text style={styles.avatarInitials} accessibilityElementsHidden>
              {initials}
            </Text>
          </View>
        )}
        {profile.verified && (
          <View style={styles.verifiedBadge} accessibilityLabel="Verified">
            <Feather name="check" size={10} color={theme.background} />
          </View>
        )}
      </View>

      {/* Name + handle */}
      <Text
        style={styles.displayName}
        accessibilityRole="header"
        numberOfLines={2}
      >
        {displayName}
      </Text>
      <View style={styles.handleRow}>
        <Text style={styles.handle} accessibilityRole="text">
          @{profile.username}
        </Text>
        {profile.verified && (
          <View style={styles.verifiedInline} accessibilityLabel="Verified account">
            <Feather name="check-circle" size={ICON.xs} color={theme.success} />
            <Text style={styles.verifiedText}>Verified</Text>
          </View>
        )}
      </View>

      {/* Account type label */}
      <View style={styles.accountTypePill}>
        <Feather
          name={profile.accountType === 'seller' ? 'shopping-bag' : 'user'}
          size={ICON.xs}
          color={theme.muted}
        />
        <Text style={styles.accountTypeText}>{accountLabel}</Text>
      </View>

      {/* Bio (optional) */}
      {!!profile.bio && (
        <Text
          style={styles.bio}
          accessibilityRole="text"
          numberOfLines={5}
        >
          {profile.bio}
        </Text>
      )}

      {/* Divider */}
      <View style={styles.divider} />

      {/* CTA block */}
      <View style={styles.ctaBlock}>
        <Text style={styles.ctaLabel}>
          View {displayName}'s full profile on Brandthread
        </Text>

        {/* Primary: Open / Join */}
        <PressableScale
          style={styles.primaryBtn}
          onPress={() => { hapticLight(); onJoin(); }}
          accessibilityRole="button"
          accessibilityLabel="Join Brandthread to view this profile"
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Join Brandthread</Text>
        </PressableScale>

        {/* Secondary: Sign in */}
        <PressableScale
          style={styles.secondaryBtn}
          onPress={() => { hapticLight(); onSignIn(); }}
          accessibilityRole="button"
          accessibilityLabel="Sign in to Brandthread"
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryBtnText}>Sign in</Text>
        </PressableScale>
      </View>

      {/* Fine print */}
      <Text style={styles.finePrint} accessibilityRole="text">
        Brandthread · Fashion &amp; Commerce
      </Text>
      </ResponsiveContainer>
    </ScrollView>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function PublicProfileRoute() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ username?: string }>();

  const rawUsername = Array.isArray(params.username)
    ? params.username[0]
    : params.username;
  const username = normalizeUsername(rawUsername);

  const { isLoaded: authLoaded, isSignedIn } = useAuth();

  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const mountRef = useRef(true);

  // ── Fetch public profile (no auth required) ──────────────────────────────
  const load = useCallback(async () => {
    if (!username) {
      setState({ kind: 'not_found', username: rawUsername ?? '' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const profile = await fetchPublicProfile(username);
      if (!mountRef.current) return;
      setState({ kind: 'ready', profile });
    } catch (err: unknown) {
      if (!mountRef.current) return;
      const status = (err as { status?: number })?.status ?? 0;
      if (status === 404) {
        setState({ kind: 'not_found', username });
      } else {
        setState({
          kind: 'error',
          message: 'Check your connection and try again.',
        });
      }
    }
  }, [username, rawUsername]);

  useEffect(() => {
    mountRef.current = true;
    load();
    return () => {
      mountRef.current = false;
    };
  }, [load]);

  // ── Navigate authenticated visitors to the full internal profile ─────────
  // Wait for BOTH resolver and auth to be ready before navigating.
  useEffect(() => {
    if (state.kind !== 'ready') return;
    // Don't act until Clerk has resolved the auth state.
    if (!authLoaded) return;
    // Signed-out visitors stay on this route and see the landing page.
    if (!isSignedIn) return;

    const { profile } = state;
    if (profile.accountType === 'seller') {
      // sellerId param is the opaque DB id — not a Clerk ID, never in the URL.
      router.replace(
        `/seller-profile?sellerId=${encodeURIComponent(profile.id)}&isOwner=false` as never,
      );
    } else {
      // Pass initials so buyer-other-profile never renders a blank/'?' avatar
      // while its own profile fetch is still in flight (avoids a second visible
      // loading flash on top of this route's own loading state).
      const initials = getInitials(profile.displayName, profile.username);
      router.replace(
        `/buyer-other-profile?userId=${encodeURIComponent(profile.id)}&name=${encodeURIComponent(
          profile.displayName ?? profile.username,
        )}&handle=${encodeURIComponent('@' + profile.username)}&initials=${encodeURIComponent(initials)}` as never,
      );
    }
  }, [state, authLoaded, isSignedIn, router]);

  // ── Loading: waiting for resolver or auth readiness ───────────────────────
  // Show spinner while either the fetch or Clerk initialisation is in-flight.
  const isWaiting =
    state.kind === 'loading' ||
    (state.kind === 'ready' && (!authLoaded || isSignedIn));

  if (isWaiting) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.center}>
          <ActivityIndicator color={theme.text} size="large" />
          <Text style={styles.loadingText}>Loading profile…</Text>
        </View>
      </View>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (state.kind === 'not_found') {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <PressableScale
            style={styles.backBtn}
            onPress={() => { hapticLight(); router.back(); }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Feather name="arrow-left" size={ICON.md} color={theme.text} />
          </PressableScale>
        </View>
        <View style={styles.center}>
          <View style={styles.iconBox}>
            <Feather name="user-x" size={40} color={theme.muted} />
          </View>
          <Text style={styles.notFoundTitle}>Profile not found</Text>
          <Text style={styles.notFoundDesc}>
            {state.username
              ? `@${state.username} doesn't exist or is unavailable.`
              : 'This profile could not be found.'}
          </Text>
          <PressableScale
            style={styles.homeBtn}
            onPress={() => { hapticLight(); router.replace('/' as never); }}
            accessibilityRole="button"
            accessibilityLabel="Go to Brandthread home"
          >
            <Text style={styles.homeBtnText}>Go to Brandthread</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  // ── Error / retry ─────────────────────────────────────────────────────────
  if (state.kind === 'error') {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <PressableScale
            style={styles.backBtn}
            onPress={() => { hapticLight(); router.back(); }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Feather name="arrow-left" size={ICON.md} color={theme.text} />
          </PressableScale>
        </View>
        <View style={styles.center}>
          <Feather name="wifi-off" size={40} color={theme.muted} />
          <Text style={styles.notFoundTitle}>Couldn't load this profile</Text>
          <Text style={styles.notFoundDesc}>{state.message}</Text>
          <PressableScale
            style={styles.retryBtn}
            onPress={() => { hapticLight(); load(); }}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  // ── Signed-out public landing ─────────────────────────────────────────────
  // state.kind === 'ready' && authLoaded && !isSignedIn
  return (
    <PublicProfileLanding
      profile={state.profile}
      insets={{ top: insets.top, bottom: insets.bottom }}
      onSignIn={() => router.push('/sign-in' as never)}
      onJoin={() => router.push('/onboarding' as never)}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 88;

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },

  // ── Shared chrome ──────────────────────────────────────────────────────────
  header: {
    height: COMP.headerH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backBtn: {
    width: COMP.iconBtn,
    height: COMP.iconBtn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xl,
    gap: SP.md,
  },
  loadingText: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: theme.muted,
    marginTop: SP.sm,
  },
  iconBox: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundTitle: {
    fontFamily: FONT.bold,
    fontSize: FS.lg,
    color: theme.text,
    textAlign: 'center',
  },
  notFoundDesc: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: theme.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  homeBtn: {
    marginTop: SP.sm,
    paddingHorizontal: SP.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
    minHeight: COMP.buttonHSm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
  retryBtn: {
    marginTop: SP.sm,
    paddingHorizontal: SP.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: theme.text,
    minHeight: COMP.buttonHSm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },

  // ── Public landing layout ──────────────────────────────────────────────────
  landingContent: {
    alignItems: 'center',
    paddingHorizontal: SP.xl,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginBottom: SP.xxl,
  },
  logoText: {
    fontFamily: FONT.bold,
    fontSize: FS.base,
    color: theme.text,
    letterSpacing: 0.2,
  },

  // Avatar
  avatarContainer: {
    position: 'relative',
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    marginBottom: SP.lg,
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: theme.card,
  },
  avatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: theme.cardElevated,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    color: theme.text,
    letterSpacing: 1,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.success,
    borderWidth: 2,
    borderColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Name / handle
  displayName: {
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    color: theme.text,
    textAlign: 'center',
    lineHeight: 30,
    maxWidth: 280,
  },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginTop: SP.xs,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  handle: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: theme.muted,
  },
  verifiedInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  verifiedText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: theme.success,
  },

  // Account type pill
  accountTypePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    marginTop: SP.md,
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs + 2,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  accountTypeText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: theme.muted,
  },

  // Bio
  bio: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: theme.muted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: SP.md,
    maxWidth: 300,
  },

  // Divider
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: theme.borderSubtle,
    marginVertical: SP.xl,
  },

  // CTA block
  ctaBlock: {
    width: '100%',
    alignItems: 'center',
    gap: SP.md,
  },
  ctaLabel: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: theme.muted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
    marginBottom: SP.xs,
  },
  primaryBtn: {
    width: '100%',
    height: COMP.buttonH,
    borderRadius: RADIUS.pill,
    backgroundColor: theme.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: theme.background,
  },
  secondaryBtn: {
    width: '100%',
    height: COMP.buttonH,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: theme.text,
  },

  // Fine print
  finePrint: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: theme.subtle,
    marginTop: SP.xl,
    textAlign: 'center',
  },
  });
}
