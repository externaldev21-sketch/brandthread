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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ScrollView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import {
  BG, CARD, BORDER, BORDER_SUBTLE, FG, MUTED, SUBTLE, FONT, FS, SP, RADIUS, COMP, ICON,
  SUCCESS, SURFACE, CARD_ELEVATED,
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
  const initials = getInitials(profile.displayName, profile.username);
  const displayName = profile.displayName || `@${profile.username}`;
  const accountLabel =
    profile.accountType === 'seller' ? 'Seller on Brandthread' : 'Member on Brandthread';

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
            <Feather name="check" size={10} color={BG} />
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
            <Feather name="check-circle" size={ICON.xs} color={SUCCESS} />
            <Text style={styles.verifiedText}>Verified</Text>
          </View>
        )}
      </View>

      {/* Account type label */}
      <View style={styles.accountTypePill}>
        <Feather
          name={profile.accountType === 'seller' ? 'shopping-bag' : 'user'}
          size={ICON.xs}
          color={MUTED}
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
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={onJoin}
          accessibilityRole="button"
          accessibilityLabel="Join Brandthread to view this profile"
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Join Brandthread</Text>
        </TouchableOpacity>

        {/* Secondary: Sign in */}
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={onSignIn}
          accessibilityRole="button"
          accessibilityLabel="Sign in to Brandthread"
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryBtnText}>Sign in</Text>
        </TouchableOpacity>
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
          message: 'Could not load this profile. Check your connection.',
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
      router.replace(
        `/buyer-other-profile?userId=${encodeURIComponent(profile.id)}&name=${encodeURIComponent(
          profile.displayName ?? profile.username,
        )}&handle=${encodeURIComponent('@' + profile.username)}` as never,
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
          <ActivityIndicator color={FG} size="large" />
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
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <View style={styles.iconBox}>
            <Feather name="user-x" size={40} color={MUTED} />
          </View>
          <Text style={styles.notFoundTitle}>Profile not found</Text>
          <Text style={styles.notFoundDesc}>
            {state.username
              ? `@${state.username} doesn't exist or is unavailable.`
              : 'This profile could not be found.'}
          </Text>
          <TouchableOpacity
            style={styles.homeBtn}
            onPress={() => router.replace('/' as never)}
            accessibilityRole="button"
            accessibilityLabel="Go to Brandthread home"
          >
            <Text style={styles.homeBtnText}>Go to Brandthread</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Error / retry ─────────────────────────────────────────────────────────
  if (state.kind === 'error') {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <Feather name="wifi-off" size={40} color={MUTED} />
          <Text style={styles.notFoundTitle}>Something went wrong</Text>
          <Text style={styles.notFoundDesc}>{state.message}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={load}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // ── Shared chrome ──────────────────────────────────────────────────────────
  header: {
    height: COMP.headerH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
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
    color: MUTED,
    marginTop: SP.sm,
  },
  iconBox: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundTitle: {
    fontFamily: FONT.bold,
    fontSize: FS.lg,
    color: FG,
    textAlign: 'center',
  },
  notFoundDesc: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 20,
  },
  homeBtn: {
    marginTop: SP.sm,
    paddingHorizontal: SP.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    minHeight: COMP.buttonHSm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
  retryBtn: {
    marginTop: SP.sm,
    paddingHorizontal: SP.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: FG,
    minHeight: COMP.buttonHSm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },

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
    color: FG,
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
    backgroundColor: CARD,
  },
  avatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: CARD_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    color: FG,
    letterSpacing: 1,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: SUCCESS,
    borderWidth: 2,
    borderColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Name / handle
  displayName: {
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    color: FG,
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
    color: MUTED,
  },
  verifiedInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  verifiedText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: SUCCESS,
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
    borderColor: BORDER,
    backgroundColor: SURFACE,
  },
  accountTypeText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: MUTED,
  },

  // Bio
  bio: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: SP.md,
    maxWidth: 300,
  },

  // Divider
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: BORDER_SUBTLE,
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
    color: MUTED,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
    marginBottom: SP.xs,
  },
  primaryBtn: {
    width: '100%',
    height: COMP.buttonH,
    borderRadius: RADIUS.pill,
    backgroundColor: FG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: BG,
  },
  secondaryBtn: {
    width: '100%',
    height: COMP.buttonH,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
  },

  // Fine print
  finePrint: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
    marginTop: SP.xl,
    textAlign: 'center',
  },
});
