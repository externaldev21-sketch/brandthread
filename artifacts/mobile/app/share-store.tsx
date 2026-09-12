/**
 * Share Store — seller shareable storefront link + QR code.
 *
 * Dynamically loads the logged-in seller's username and brand name from the API
 * to construct a real storefront URL. Falls back to demo values if offline.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Share, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';

const BASE_URL = 'https://brandthread.app/store';

export default function ShareStoreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api    = useApi();
  const colors = useColors();

  const [copied,    setCopied]    = useState(false);
  const [profile,   setProfile]   = useState<{ username?: string | null; brandName?: string | null; displayName?: string | null } | null>(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    (api as any).seller?.getProfile?.()
      ?.then((p: any) => setProfile(p))
      ?.catch(() => {})
      ?.finally(() => setLoading(false));
  }, []);

  // Construct the shareable URL — use username if set, fall back to encoded brand name
  const handle    = profile?.username ?? null;
  const brandName = profile?.brandName ?? profile?.displayName ?? 'My Store';
  const storeSlug = handle
    ? handle
    : brandName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const storeUrl  = `${BASE_URL}/${storeSlug}`;
  const handleStr = `@${handle ?? storeSlug}`;

  async function copyLink() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(storeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function shareLink() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({
        message: `Shop ${brandName} on Brandthread: ${storeUrl}`,
        url:     storeUrl,
      });
    } catch {
      // dismissed
    }
  }

  return (
    <View style={[s.root, { backgroundColor: 'transparent', paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Share Store</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Content */}
      <View style={s.body}>
        {/* QR Card */}
        <View style={s.qrCard}>
          {/* Store badge */}
          <View style={s.storeBadge}>
            <View style={s.storeLogoBox}>
              <BrandthreadLogo size={28} />
            </View>
            <View>
              {loading ? (
                <ActivityIndicator color={colors.accentForeground} size="small" />
              ) : (
                <>
                  <Text style={s.storeName} numberOfLines={1}>{brandName}</Text>
                  <Text style={s.storeHandle}>{handleStr}</Text>
                </>
              )}
            </View>
          </View>

          {/* QR code */}
          <View style={s.qrWrapper}>
            <QRCode
              value={storeUrl}
              size={200}
              backgroundColor="#FFFFFF"
              color="#07070F"
            />
          </View>

          {/* URL label */}
          <Text style={s.urlLabel} numberOfLines={1}>{storeUrl}</Text>
        </View>

        {/* Copy link button */}
        <TouchableOpacity
          style={[s.copyBtn, { backgroundColor: copied ? '#22C55E' : colors.primary }]}
          activeOpacity={0.85}
          onPress={copyLink}
        >
          <Feather name={copied ? 'check' : 'copy'} size={17} color="#07070F" />
          <Text style={s.copyBtnText}>{copied ? 'Link Copied!' : 'Copy Link'}</Text>
        </TouchableOpacity>

        {/* Share button */}
        <TouchableOpacity style={s.shareBtn} activeOpacity={0.8} onPress={shareLink}>
          <Feather name="share-2" size={17} color={colors.foreground} />
          <Text style={s.shareBtnText}>Share via…</Text>
        </TouchableOpacity>

        {/* Hint */}
        <Text style={s.hint}>
          Add this QR code to packaging, social bios, or pop-up event materials.
          Buyers scan it and land directly on your Brandthread storefront.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn:     { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },

  body:        { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 36 },

  qrCard:      { width: '100%', borderRadius: 24, borderWidth: 1, alignItems: 'center', padding: 28, marginBottom: 20 },
  storeBadge:  { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28, alignSelf: 'flex-start' },
  storeLogoBox:{ width: 42, height: 42, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  storeName:   { fontSize: 15, fontFamily: 'Inter_700Bold', maxWidth: 180 },
  storeHandle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },

  qrWrapper:   { padding: 16, backgroundColor: '#FFFFFF', borderRadius: 16, marginBottom: 20 },
  urlLabel:    { fontSize: 12, fontFamily: 'Inter_500Medium', textAlign: 'center' },

  copyBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', borderRadius: 16, paddingVertical: 16, marginBottom: 12 },
  copyBtnDone: {},
  copyBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#07070F' },

  shareBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', borderRadius: 16, borderWidth: 1, paddingVertical: 16, marginBottom: 24 },
  shareBtnText:{ fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  hint:        { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18, paddingHorizontal: 16 },
});
