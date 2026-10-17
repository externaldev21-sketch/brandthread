/**
 * Share Store — seller shareable storefront link + QR code.
 *
 * Loads the logged-in seller's username (and, when they have none, their own
 * storefront from GET /api/store) to build a real link. Never falls back to a
 * guessable value such as the brand name — that could open someone else's
 * profile. With no usable link, copy/share are disabled with a clear reason.
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
import { useApi, API_BASE_URL } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SHARE_ORIGIN } from '@/lib/shareLinks';
import { resolveShareStoreLink } from '@/lib/storefrontUrl';

export default function ShareStoreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api    = useApi();
  const colors = useColors();

  const [copied,    setCopied]    = useState(false);
  const [profile,   setProfile]   = useState<{ username?: string | null; brandName?: string | null; displayName?: string | null } | null>(null);
  const [storefront, setStorefront] = useState<{ slug?: string | null; status?: string | null; title?: string | null } | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await api.seller.getProfile();
        if (cancelled) return;
        setProfile(p as any);
        if (!(p as any)?.username) {
          // No username: the seller's own storefront slug is the only safe link.
          const sf = await api.store.get().catch(() => null);
          if (!cancelled) setStorefront(sf);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  const brandName = profile?.brandName ?? profile?.displayName ?? storefront?.title ?? 'My Store';
  const link = resolveShareStoreLink({
    username: profile?.username,
    storefront,
    apiBaseUrl: API_BASE_URL,
    shareOrigin: SHARE_ORIGIN,
  });
  const storeUrl  = link.url;
  const handleStr = link.url ? link.label : '';
  const unavailableReason = loadError
    ? "Couldn't load your store link. Check your connection and try again."
    : link.url === null ? link.reason : null;

  async function copyLink() {
    if (!storeUrl) { Alert.alert('No store link yet', unavailableReason ?? ''); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(storeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function shareLink() {
    if (!storeUrl) { Alert.alert('No store link yet', unavailableReason ?? ''); return; }
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
    <View style={[s.root, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Share Store" />

      {/* Content */}
      <View style={s.body}>
        {/* QR Card */}
        <View style={[s.qrCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Store badge */}
          <View style={s.storeBadge}>
            <View style={[s.storeLogoBox, { borderColor: colors.border }]}>
              <BrandthreadLogo size={28} />
            </View>
            <View>
              {loading ? (
                <ActivityIndicator color={colors.accentForeground} size="small" />
              ) : (
                <>
                  <Text style={[s.storeName, { color: colors.foreground }]} numberOfLines={1}>{brandName}</Text>
                  <Text style={[s.storeHandle, { color: colors.mutedForeground }]}>{handleStr}</Text>
                </>
              )}
            </View>
          </View>

          {/* QR code */}
          {storeUrl ? (
            <View style={s.qrWrapper}>
              <QRCode
                value={storeUrl}
                size={200}
                backgroundColor="#FFFFFF"
                // theme-exempt: QR foreground must be a physically dark, high-contrast
                // color to stay scannable — it isn't a themed surface.
                color="#0A0A0B"
              />
            </View>
          ) : null}

          {/* URL label (or why there's no link yet) */}
          {!loading && (
            <Text style={[s.urlLabel, { color: colors.mutedForeground }]} numberOfLines={storeUrl ? 1 : 3}>
              {storeUrl ?? unavailableReason}
            </Text>
          )}
        </View>

        {/* Copy link button */}
        <TouchableOpacity
          style={[s.copyBtn, { backgroundColor: copied ? colors.success : colors.primary, opacity: storeUrl ? 1 : 0.5 }]}
          activeOpacity={0.85}
          onPress={copyLink}
          disabled={!storeUrl}
        >
          <Feather name={copied ? 'check' : 'copy'} size={17} color={colors.primaryForeground} />
          <Text style={[s.copyBtnText, { color: colors.primaryForeground }]}>{copied ? 'Link copied' : 'Copy link'}</Text>
        </TouchableOpacity>

        {/* Share button */}
        <TouchableOpacity style={[s.shareBtn, { borderColor: colors.border, opacity: storeUrl ? 1 : 0.5 }]} activeOpacity={0.8} onPress={shareLink} disabled={!storeUrl}>
          <Feather name="share-2" size={17} color={colors.foreground} />
          <Text style={[s.shareBtnText, { color: colors.foreground }]}>Share via…</Text>
        </TouchableOpacity>

        {/* Hint */}
        <Text style={[s.hint, { color: colors.mutedForeground }]}>
          Add this QR code to packaging, social bios, or pop-up event materials.
          Buyers scan it and land directly on your Brandthread storefront.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1 },

  body:        { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 36 },

  qrCard:      { width: '100%', borderRadius: 24, borderWidth: 1, alignItems: 'center', padding: 28, marginBottom: 20 },
  storeBadge:  { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28, alignSelf: 'flex-start' },
  storeLogoBox:{ width: 42, height: 42, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  storeName:   { fontSize: 15, fontFamily: 'Inter_700Bold', maxWidth: 180 },
  storeHandle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },

  qrWrapper:   { padding: 16, backgroundColor: '#FFFFFF', borderRadius: 16, marginBottom: 20 },
  urlLabel:    { fontSize: 12, fontFamily: 'Inter_500Medium', textAlign: 'center' },

  copyBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', borderRadius: 16, paddingVertical: 16, marginBottom: 12 },
  copyBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },

  shareBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', borderRadius: 16, borderWidth: 1, paddingVertical: 16, marginBottom: 24 },
  shareBtnText:{ fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  hint:        { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18, paddingHorizontal: 16 },
});
