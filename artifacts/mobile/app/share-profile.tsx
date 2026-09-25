/**
 * Share Profile — dedicated screen for sharing the authenticated user's
 * canonical Brandthread profile URL.
 *
 * Canonical URL: https://brandthread.app/u/{normalizedUsername}
 *
 * Behaviour:
 * - Loads the authenticated user's real username from the API.
 * - Builds the canonical URL (never guesses or falls back to display names).
 * - Auto-copies the URL exactly once per page open, idempotently.
 * - Shows a scannable QR code (dark on white, adequate quiet zone).
 * - Copy Link button copies again with feedback.
 * - Share Profile button uses React Native Share.share() with platform-safe payload.
 * - Missing / invalid username shows a clear state with a link to edit-profile.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Share,
  ScrollView, ActivityIndicator, Platform, AccessibilityInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useAuth, useUser } from '@clerk/expo';
import { FONT, FS, SP, RADIUS, COMP, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { Header } from '@/components/layout';
import { useApi } from '@/lib/api';
import { buildCanonicalProfileUrl, normalizeUsername } from '@/lib/shareProfile';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResolvedProfile {
  username: string | null;
  displayName: string | null;
  accountType: 'buyer' | 'seller' | null;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ShareProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { user } = useUser();
  const { isLoaded: authLoaded } = useAuth();

  const [profile, setProfile] = useState<ResolvedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoCopied, setAutoCopied] = useState(false);

  // Guard: auto-copy fires exactly once per mount, not on every render/account change.
  const autoCopyFiredRef = useRef(false);
  const mountedAccountRef = useRef<string | null>(null);

  // Load profile from API (not from Clerk metadata — we need the DB username).
  const loadProfile = useCallback(async () => {
    if (!authLoaded || !user?.id) return;
    const currentUserId = user.id;
    setError(false);
    setLoading(true);
    try {
      const data = await api.auth.me();
      // Guard against account switch during load.
      if (mountedAccountRef.current !== currentUserId) return;
      setProfile({
        username: data.username ?? null,
        displayName: data.displayName ?? data.name ?? null,
        accountType: data.accountType ?? null,
      });
    } catch {
      if (mountedAccountRef.current === currentUserId) setError(true);
    } finally {
      if (mountedAccountRef.current === currentUserId) setLoading(false);
    }
  }, [api, authLoaded, user?.id]);

  // On mount: record which account this page was opened for.
  useEffect(() => {
    mountedAccountRef.current = user?.id ?? null;
    autoCopyFiredRef.current = false;
    setProfile(null);
    setCopied(false);
    setAutoCopied(false);
    loadProfile();
  }, [user?.id, loadProfile]);

  // Auto-copy exactly once after a valid URL is ready.
  const canonicalUrl = buildCanonicalProfileUrl(profile?.username);
  useEffect(() => {
    if (!canonicalUrl || autoCopyFiredRef.current) return;
    autoCopyFiredRef.current = true;
    setAutoCopied(false);
    void (async () => {
      try {
        if (Platform.OS === 'web') {
          if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(canonicalUrl);
          }
        } else {
          await Clipboard.setStringAsync(canonicalUrl);
        }
        setAutoCopied(true);
        // Announce to screen readers.
        AccessibilityInfo.announceForAccessibility('Profile link copied to clipboard');
        setTimeout(() => setAutoCopied(false), 3000);
      } catch {
        // Clipboard unavailable — don't show error for auto-copy.
      }
    })();
  }, [canonicalUrl]);

  const handleCopy = useCallback(async () => {
    if (!canonicalUrl) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      if (Platform.OS === 'web') {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(canonicalUrl);
        }
      } else {
        await Clipboard.setStringAsync(canonicalUrl);
      }
      setCopied(true);
      AccessibilityInfo.announceForAccessibility('Profile link copied to clipboard');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard unavailable on this device — no-op.
    }
  }, [canonicalUrl]);

  const handleShare = useCallback(async () => {
    if (!canonicalUrl || !profile) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const name = profile.displayName || 'me';
    const message = `Find ${name} on Brandthread: ${canonicalUrl}`;
    try {
      await Share.share(
        Platform.OS === 'ios'
          ? { message, url: canonicalUrl }
          : { message },
        { dialogTitle: 'Share Profile' },
      );
    } catch {
      // Dismissed.
    }
  }, [canonicalUrl, profile]);

  const handleEditProfile = useCallback(() => {
    const route = profile?.accountType === 'seller' ? '/edit-profile' : '/(buyer)/edit-profile';
    router.push(route as never);
  }, [profile?.accountType, router]);

  const normalizedUsername = normalizeUsername(profile?.username);

  // ── Render helpers ──
  const statusMsg = autoCopied ? 'Link copied' : copied ? 'Link copied' : null;

  return (
    <View style={styles.root}>
      <Header title="Share Profile" />

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + SP.xxl }]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {loading ? (
          <View style={styles.centeredState}>
            <ActivityIndicator color={theme.text} />
            <Text style={styles.loadingText}>Loading profile…</Text>
          </View>
        ) : error ? (
          <View style={styles.centeredState}>
            <Feather name="wifi-off" size={40} color={theme.muted} />
            <Text style={styles.errorTitle}>Couldn't load profile</Text>
            <Text style={styles.errorDesc}>Check your connection and try again.</Text>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: theme.accent }]}
              onPress={loadProfile}
              accessibilityRole="button"
              accessibilityLabel="Retry loading profile"
            >
              <Text style={[styles.actionBtnText, { color: theme.accent }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !normalizedUsername ? (
          /* ── No username state ── */
          <View style={styles.centeredState}>
            <View style={styles.noUserIcon}>
              <Feather name="user-x" size={36} color={theme.muted} />
            </View>
            <Text style={styles.noUserTitle}>No username set</Text>
            <Text style={styles.noUserDesc}>
              A username is required to create your shareable profile link. It must be 3–30 characters and contain only letters, numbers, and underscores.
            </Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
              onPress={handleEditProfile}
              accessibilityRole="button"
              accessibilityLabel="Set username in profile settings"
            >
              <Feather name="edit-3" size={ICON.sm} color={theme.onAccent} />
              <Text style={[styles.primaryBtnText, { color: theme.onAccent }]}>Set Username</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* ── Valid URL state ── */
          <>
            {/* Auto-copy status */}
            <View
              style={styles.statusBanner}
              accessibilityLiveRegion="polite"
              accessibilityLabel={statusMsg ? statusMsg : undefined}
            >
              {statusMsg ? (
                <>
                  <Feather name="check-circle" size={ICON.sm} color={theme.success} />
                  <Text style={[styles.statusText, { color: theme.success }]}>{statusMsg}</Text>
                </>
              ) : null}
            </View>

            {/* QR Card */}
            <View style={styles.qrCard} accessibilityRole="image" accessibilityLabel={`QR code for ${canonicalUrl}`}>
              {/* White quiet zone + dark foreground */}
              <View style={styles.qrWrapper}>
                <QRCode
                  value={canonicalUrl!}
                  size={220}
                  backgroundColor="#FFFFFF"
                  color="#0A0A0B"
                  quietZone={16}
                />
              </View>

              {/* Canonical URL — selectable, wrapping */}
              <Text
                style={styles.urlText}
                selectable
                accessibilityLabel={`Profile URL: ${canonicalUrl}`}
              >
                {canonicalUrl}
              </Text>

              {/* Handle */}
              <Text style={styles.handleText} numberOfLines={1}>
                @{normalizedUsername}
              </Text>
            </View>

            {/* Copy Link button */}
            <TouchableOpacity
              style={[
                styles.copyBtn,
                { backgroundColor: (copied || autoCopied) ? theme.success : theme.accent },
              ]}
              onPress={handleCopy}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={(copied || autoCopied) ? 'Link copied' : 'Copy profile link'}
              accessibilityHint="Copies the profile URL to your clipboard"
            >
              <Feather
                name={(copied || autoCopied) ? 'check' : 'copy'}
                size={ICON.sm}
                color={theme.onAccent}
              />
              <Text style={[styles.copyBtnText, { color: theme.onAccent }]}>
                {(copied || autoCopied) ? 'Link Copied!' : 'Copy Link'}
              </Text>
            </TouchableOpacity>

            {/* Share Profile button */}
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={handleShare}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Share profile"
              accessibilityHint="Opens the system share sheet to share your profile link"
            >
              <Feather name="share-2" size={ICON.sm} color={theme.text} />
              <Text style={styles.shareBtnText}>Share Profile</Text>
            </TouchableOpacity>

            {/* Hint */}
            <Text style={styles.hint}>
              Anyone with this link can view your public profile on Brandthread.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Theme-aware factory (re-derived per render via useMemo) so every color reacts
// to all 12 themes instead of a fixed static palette. The header/back-button
// styles that used to live here are unused now that the screen renders the
// shared <Header> component — removed rather than left as dead code.

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },

  body: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingTop: SP.lg,
    gap: SP.md,
  },

  // ── States ──
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SP.xxl,
    paddingHorizontal: SP.lg,
    gap: SP.md,
  },
  loadingText: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, marginTop: SP.sm },
  errorTitle: { fontFamily: FONT.bold, fontSize: FS.md, color: theme.text, textAlign: 'center' },
  errorDesc: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, textAlign: 'center', lineHeight: 19 },
  actionBtn: {
    marginTop: SP.sm,
    paddingHorizontal: SP.lg,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    minHeight: COMP.buttonHSm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm },

  noUserIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.sm,
  },
  noUserTitle: { fontFamily: FONT.bold, fontSize: FS.lg, color: theme.text, textAlign: 'center' },
  noUserDesc: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: theme.muted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    marginTop: SP.sm,
    paddingHorizontal: SP.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
    minHeight: COMP.buttonH,
    minWidth: 180,
  },
  primaryBtnText: { fontFamily: FONT.bold, fontSize: FS.base },

  // ── Status banner ──
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    minHeight: 24,
  },
  statusText: { fontFamily: FONT.semibold, fontSize: FS.sm },

  // ── QR card ──
  qrCard: {
    width: '100%',
    backgroundColor: theme.card,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    paddingVertical: SP.xl,
    paddingHorizontal: SP.lg,
    gap: SP.md,
  },
  qrWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: RADIUS.md,
    padding: 0,
    // The QRCode quietZone prop handles the internal padding.
  },
  urlText: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: theme.muted,
    textAlign: 'center',
    lineHeight: 20,
    flexShrink: 1,
  },
  handleText: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: theme.text,
    textAlign: 'center',
  },

  // ── Buttons ──
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    width: '100%',
    minHeight: COMP.buttonH,
    borderRadius: RADIUS.pill,
  },
  copyBtnText: { fontFamily: FONT.bold, fontSize: FS.base },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    width: '100%',
    minHeight: COMP.buttonH,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
  },
  shareBtnText: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },

  hint: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: theme.muted,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: SP.lg,
  },
});
