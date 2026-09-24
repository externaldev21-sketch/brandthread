import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import QRCode from 'react-native-qrcode-svg';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { getMyProfile } from '@/services/socialService';
import type { BuyerSocialProfile } from '@/services/socialTypes';
import { Header } from '@/components/layout';

export default function BuyerQRCode() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const GRAD_PRIMARY = theme.primaryGradient;
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [profile, setProfile] = useState<BuyerSocialProfile | null>(null);

  useEffect(() => {
    getMyProfile().then(setProfile);
  }, []);

  const handle = profile?.username ? `@${profile.username}` : null;
  const canonicalUrl = profile?.username
    ? `https://brandthread.app/u/${profile.username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')}`
    : null;
  // Legacy alias — used by existing Share call below; keep for compatibility.
  const qrValue = canonicalUrl ?? 'https://brandthread.app';

  async function handleShare() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
      <Header
        title="QR Code"
        actions={[{ icon: 'share-2', onPress: handleShare, accessibilityLabel: 'Share' }]}
      />

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
              <Feather name="user-x" size={40} color={MUTED} />
              <Text style={[s.hint, { marginTop: 8, marginBottom: 0 }]}>Set a username to generate your QR code</Text>
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

          {/* Hint */}
          <Text style={s.hint}>Point a camera at this code to visit my profile</Text>
        </View>

        {/* Share button */}
        <TouchableOpacity onPress={handleShare} activeOpacity={0.85} style={s.shareBtnWrap}>
          <LinearGradient colors={GRAD_PRIMARY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.shareBtn}>
            <Feather name="share-2" size={18} color={theme.onAccent} />
            <Text style={[s.shareBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Share QR Code</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Info rows */}
        <View style={s.infoCard}>
          <View style={s.infoRow}>
            <Feather name="user" size={17} color={PURPLE} />
            <Text style={s.infoLabel}>Profile</Text>
            <Text style={s.infoValue}>{profile?.name ?? 'Your Name'}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.infoRow}>
            <Feather name="link" size={17} color={PURPLE} />
            <Text style={s.infoLabel}>Link</Text>
            <Text style={s.infoValue} numberOfLines={1}>{qrValue}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },

  body: { flex: 1, padding: SP.md, alignItems: 'center' },

  card: { width: '100%', maxWidth: 320, backgroundColor: CARD, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginTop: SP.lg },
  cardTop: { paddingVertical: 12, alignItems: 'center' },
  cardBrand: { fontFamily: FONT.bold, fontSize: FS.md, color: ON_DARK, letterSpacing: 1.5 },

  qrWrap: { alignItems: 'center', paddingVertical: SP.xl },
  qrBg: { padding: 20, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.accent },

  handleRow: { alignItems: 'center', marginBottom: SP.md },
  handleBadge: { paddingHorizontal: SP.lg, paddingVertical: 8, borderRadius: RADIUS.pill },
  handleText: { fontFamily: FONT.bold, fontSize: FS.base, color: ON_DARK },

  hint: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, textAlign: 'center', paddingHorizontal: SP.lg, paddingBottom: SP.lg },

  shareBtnWrap: { marginTop: SP.lg, width: '100%', maxWidth: 320 },
  shareBtn: { height: 50, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: SP.sm },
  shareBtnText: { fontFamily: FONT.bold, fontSize: FS.base },

  infoCard: { width: '100%', maxWidth: 320, backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginTop: SP.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 14, gap: SP.sm },
  infoLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED, width: 60 },
  infoValue: { flex: 1, fontFamily: FONT.regular, fontSize: FS.sm, color: FG, textAlign: 'right' },
  divider: { height: 1, backgroundColor: BORDER, marginLeft: SP.md },
});
