import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import QRCode from 'react-native-qrcode-svg';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BG, CARD, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, ON_DARK,
  PURPLE, PURPLE_DIM, GRAD_PRIMARY,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { getMyProfile } from '@/services/socialService';
import type { BuyerSocialProfile } from '@/services/socialTypes';

export default function BuyerQRCode() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [profile, setProfile] = useState<BuyerSocialProfile | null>(null);

  useEffect(() => {
    getMyProfile().then(setProfile);
  }, []);

  const handle = profile?.username ? `@${profile.username}` : '@yourusername';
  const qrValue = `https://brandthread.app/u/${profile?.username ?? 'me'}`;

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
    <View style={[s.page, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>QR Code</Text>
        <TouchableOpacity style={s.iconBtn} onPress={handleShare}>
          <Feather name="share-2" size={21} color={FG} />
        </TouchableOpacity>
      </View>

      <View style={s.body}>
        {/* Card */}
        <View style={s.card}>
          {/* Gradient top strip */}
          <LinearGradient colors={GRAD_PRIMARY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cardTop}>
            <Text style={s.cardBrand}>Brandthread</Text>
          </LinearGradient>

          {/* QR area */}
          <View style={s.qrWrap}>
            <View style={s.qrBg}>
              <QRCode
                value={qrValue}
                size={200}
                backgroundColor="transparent"
                color={ON_DARK}
                enableLinearGradient
                linearGradient={[...GRAD_PRIMARY]}
              />
            </View>
          </View>

          {/* Handle */}
          <View style={s.handleRow}>
            <LinearGradient colors={GRAD_PRIMARY} style={s.handleBadge}>
              <Text style={s.handleText}>{handle}</Text>
            </LinearGradient>
          </View>

          {/* Hint */}
          <Text style={s.hint}>Point a camera at this code to visit my profile</Text>
        </View>

        {/* Share button */}
        <TouchableOpacity onPress={handleShare} activeOpacity={0.85} style={s.shareBtnWrap}>
          <LinearGradient colors={GRAD_PRIMARY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.shareBtn}>
            <Feather name="share-2" size={18} color={ON_DARK} />
            <Text style={s.shareBtnText}>Share QR Code</Text>
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

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },

  body: { flex: 1, padding: SP.md, alignItems: 'center' },

  card: { width: '100%', maxWidth: 320, backgroundColor: CARD, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginTop: SP.lg },
  cardTop: { paddingVertical: 12, alignItems: 'center' },
  cardBrand: { fontFamily: FONT.bold, fontSize: FS.md, color: ON_DARK, letterSpacing: 1.5 },

  qrWrap: { alignItems: 'center', paddingVertical: SP.xl },
  qrBg: { padding: 20, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER_ACTIVE },

  handleRow: { alignItems: 'center', marginBottom: SP.md },
  handleBadge: { paddingHorizontal: SP.lg, paddingVertical: 8, borderRadius: RADIUS.pill },
  handleText: { fontFamily: FONT.bold, fontSize: FS.base, color: ON_DARK },

  hint: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, textAlign: 'center', paddingHorizontal: SP.lg, paddingBottom: SP.lg },

  shareBtnWrap: { marginTop: SP.lg, width: '100%', maxWidth: 320 },
  shareBtn: { height: 50, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: SP.sm },
  shareBtnText: { fontFamily: FONT.bold, fontSize: FS.base, color: ON_DARK },

  infoCard: { width: '100%', maxWidth: 320, backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginTop: SP.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 14, gap: SP.sm },
  infoLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED, width: 60 },
  infoValue: { flex: 1, fontFamily: FONT.regular, fontSize: FS.sm, color: FG, textAlign: 'right' },
  divider: { height: 1, backgroundColor: BORDER, marginLeft: SP.md },
});
