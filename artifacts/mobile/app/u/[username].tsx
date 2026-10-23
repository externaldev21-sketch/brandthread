/**
 * Public profile route — resolves a username to a buyer or seller profile
 * and renders the appropriate view.
 *
 * Route: /u/[username]  (maps to https://brandthread.app/u/{username})
 *
 * Resolution flow:
 * 1. Normalize the username param (lowercase, strip invalid chars).
 * 2. Fetch GET /api/v1/public/profiles/:username — returns safe public DTO.
 * 3. Once auth is ready, navigate internally to buyer-other-profile or
 *    seller-profile using the opaque users.id alias. Signed-out visitors never
 *    reach this screen: AuthGate (app/_layout.tsx) sends them to the
 *    welcome/sign-in flow and resumes this link after sign-in.
 *
 * Never exposes Clerk IDs in the browser URL.
 *
 * Handles: loading, not-found, offline/retry, auth-loading wait.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { hapticLight } from '@/lib/haptics';
import {
  FONT, FS, SP, COMP,
} from '@/lib/theme';
import { normalizeUsername } from '@/lib/shareProfile';
import { SkeletonBlock } from '@/components/layout';
import { radius } from '@/constants/radii';

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
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 15_000) : null;
  let res: Response;
  try {
    res = await fetch(
      `${apiBase}/api/v1/public/profiles/${encodeURIComponent(username)}`,
      { headers: { Accept: 'application/json' }, signal: controller?.signal },
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
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

// ─── Root component ───────────────────────────────────────────────────────────

export default function PublicProfileRoute() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const params = useLocalSearchParams<{ username?: string }>();

  const rawUsername = Array.isArray(params.username)
    ? params.username[0]
    : params.username;
  const username = normalizeUsername(rawUsername);

  const { isLoaded: authLoaded } = useAuth();

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
  }, [state, authLoaded, router]);

  // ── Loading: waiting for resolver or auth readiness ───────────────────────
  // Show spinner while either the fetch or Clerk initialisation is in-flight.
  const isWaiting =
    state.kind === 'loading' ||
    state.kind === 'ready';

  if (isWaiting) {
    // Skeleton in the profile shell's shape (hero, avatar, name) — the fetch
    // itself is time-boxed, so this always resolves to data or an error.
    return (
      <View style={styles.root} accessibilityLabel="Loading profile" accessible>
        <ScreenHeader title="Profile" onBack={() => goBackOr(router)} />
        <SkeletonBlock width="100%" height={260} radius={0} />
        <View style={styles.skeletonIdentity}>
          <SkeletonBlock width={84} height={84} radius={42} />
          <View style={styles.skeletonLines}>
            <SkeletonBlock width="70%" height={24} />
            <SkeletonBlock width="40%" height={14} />
          </View>
        </View>
        <Text style={styles.loadingText}>Loading profile…</Text>
      </View>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (state.kind === 'not_found') {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Profile" onBack={() => { hapticLight(); goBackOr(router); }} />
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
  return (
    <View style={styles.root}>
      <ScreenHeader title="Profile" onBack={() => { hapticLight(); goBackOr(router); }} />
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

// ─── Styles ───────────────────────────────────────────────────────────────────
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
    borderRadius: radius.md,
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
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.text,
    minHeight: COMP.buttonHSm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },

  skeletonIdentity: { flexDirection: 'row', alignItems: 'center', gap: SP.md, padding: SP.md },
  skeletonLines: { flex: 1, gap: SP.sm },
  });
}
