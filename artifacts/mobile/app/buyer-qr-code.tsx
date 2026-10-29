import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share, Platform } from 'react-native';

import { Icon } from '@/components/ui/Icon';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';

import QRCode from 'react-native-qrcode-svg';
import { LinearGradient } from 'expo-linear-gradient';

import { BG, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK, FONT, FS, SP, RADIUS } from '@/lib/theme';

import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';

import { getMyProfile } from '@/services/socialService';

import type { BuyerSocialProfile } from '@/services/socialTypes';
import { ScreenHeader } from '@/components/ScreenHeader';

import { BRANDTHREAD_ORIGIN, buildCanonicalProfileUrl } from '@/lib/shareProfile';
import { radius } from '@/constants/radii';

import { Button } from '@/components/ui/Button';

import { PREVIEW_BUYER_IDENTITY, previewBuyerIdentity, profileShareUrl } from '@/lib/previewBuyerIdentity';
import { isBuyerDevPreview } from '@/lib/devPreview';

export default function BuyerQRCode() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const GRAD_PRIMARY = theme.primaryGradient;
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useUser();
  const [profile, setProfile] = useState<BuyerSocialProfile | null>(null);

  useEffect(() => {
    getMyProfile().then(setProfile);
  }, []);

  // Same identity the profile header shows (app/(buyer)/profile.tsx): the
  // local profile, then the account's Clerk username, then — only in the
  // signed-out dev preview, where the header reads @ava — the preview buyer.
  const preview = previewBuyerIdentity() ?? (isBuyerDevPreview() && !user?.id ? PREVIEW_BUYER_IDENTITY : null);
  const clerkName = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const username = profile?.username || user?.username || preview?.username || '';
  const displayName = profile?.name || clerkName || preview?.name || '';
  const canonicalUrl = buildCanonicalProfileUrl(username);
  const handle = canonicalUrl ? `@${username.replace(/^@/, '')}` : null;
  // Legacy alias — used by existing Share call below; keep for compatibility.
  const qrValue = canonicalUrl ?? BRANDTHREAD_ORIGIN;

  async function handleShare() {
    if (!canonicalUrl) return;
    try {
      await Share.share({
        message: `Find me on Brandthread! ${qrValue}`,
        title: 'My Brandthread Profile',
        ...(Platform.OS === 'ios' ? { url: qrValue } : {}),
      });
    } catch {}
  }

  return (
    <View style={s.page}>
      {/* Sharing is the "Share" button under the card, not a header icon too. */}
      <ScreenHeader title="QR code" />

      <View style={s.body}>
        {/* Card */}
        <View style={s.card}>
          {/* Gradient top strip */}
          <LinearGradient colors={GRAD_PRIMARY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cardTop}>
            <Text style={[s.cardBrand, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Brandthread</Text>
          </LinearGradient>

          {/* QR area — only rendered when we have a real canonical URL */}
          {canonicalUrl ? (
            <View style={s.qrWrap}>
              <View style={s.qrBg}>
                <QRCode
                  value={canonicalUrl}
                  size={200}
                  backgroundColor="transparent"
                  color={ON_DARK}
                  enableLinearGradient
                  linearGradient={[...GRAD_PRIMARY]}
                />
              </View>
            </View>
          ) : (
            <View style={[s.qrWrap, { alignItems: 'center', justifyContent: 'center' }]}>
              <Icon name="user-x" size={40} color={MUTED} />
              <Text style={[s.hint, { marginTop: SP.sm, marginBottom: 0 }]}>Set a username to generate your QR code</Text>
              <Button
                label="Set username"
                variant="secondary"
                size="small"
                onPress={() => router.push('/buyer-personal-details' as never)}
              />
            </View>
          )}

          {/* Handle */}
          {handle ? (
            <View style={s.handleRow}>
              <LinearGradient colors={GRAD_PRIMARY} style={s.handleBadge}>
                <Text style={[s.handleText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>{handle}</Text>
              </LinearGradient>
            </View>
          ) : null}

          {/* Hint — only once there is a code to point a camera at */}
          {canonicalUrl ? <Text style={s.hint}>Point a camera at this code to visit my profile</Text> : null}
        </View>

        {/* Share button */}
        <TouchableOpacity
          onPress={handleShare}
          activeOpacity={0.85}
          disabled={!canonicalUrl}
          accessibilityState={{ disabled: !canonicalUrl }}
          style={[s.shareBtnWrap, !canonicalUrl && { opacity: 0.4 }]}
        >
          <LinearGradient colors={GRAD_PRIMARY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.shareBtn}>
            <Icon name="share-2" size={18} color={theme.onAccent} />
            <Text style={[s.shareBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Share QR code</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Info rows — no placeholder name, and no bare-domain link before
            a username exists */}
        {displayName || canonicalUrl ? (
          <View style={s.infoCard}>
            {displayName ? (
              <View style={s.infoRow}>
                <Icon name="user" size={17} color={PURPLE} />
                <Text style={s.infoLabel}>Profile</Text>
                <Text style={s.infoValue}>{displayName}</Text>
              </View>
            ) : null}
            {displayName && canonicalUrl ? <View style={s.divider} /> : null}
            {canonicalUrl ? (
              <View style={s.infoRow}>
                <Icon name="link" size={17} color={PURPLE} />
                <Text style={s.infoLabel}>Link</Text>
                <Text style={s.infoValue} numberOfLines={2}>{qrValue}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },

  body: { flex: 1, padding: SP.md, alignItems: 'center' },

  card: { width: '100%', maxWidth: 320, backgroundColor: CARD, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginTop: SP.lg },
  cardTop: { paddingVertical: 12, alignItems: 'center' },
  cardBrand: { fontFamily: FONT.bold, fontSize: FS.md, color: ON_DARK },

  qrWrap: { alignItems: 'center', paddingVertical: SP.xl },
  qrBg: { padding: 20, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.accent },

  handleRow: { alignItems: 'center', marginBottom: SP.md },
  handleBadge: { paddingHorizontal: SP.lg, paddingVertical: SP.sm, borderRadius: RADIUS.pill },
  handleText: { fontFamily: FONT.bold, fontSize: FS.base, color: ON_DARK },

  hint: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, textAlign: 'center', paddingHorizontal: SP.lg, paddingBottom: SP.lg },

  shareBtnWrap: { marginTop: SP.lg, width: '100%', maxWidth: 320 },
  shareBtn: { height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: SP.sm },
  shareBtnText: { fontFamily: FONT.bold, fontSize: FS.base },

  infoCard: { width: '100%', maxWidth: 320, backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginTop: SP.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 14, gap: SP.sm },
  infoLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED, width: 60 },
  infoValue: { flex: 1, fontFamily: FONT.regular, fontSize: FS.sm, color: FG, textAlign: 'right' },
  divider: { height: 1, backgroundColor: BORDER, marginLeft: SP.md },
});
