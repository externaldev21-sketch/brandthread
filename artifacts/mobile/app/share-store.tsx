import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Share, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

const BG       = '#0D0E0D';
const CARD     = '#131713';
const BORDER   = '#232523';
const FG       = '#EAF2ED';
const MUTED    = '#6B7A6D';
const GREEN    = '#39FF88';
const GREEN_DIM = '#0D2B1A';

const STORE_URL = 'https://brandthread.store/vaultstudio';

export default function ShareStoreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(STORE_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function shareLink() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({ message: `Check out my store on Brandthread: ${STORE_URL}`, url: STORE_URL });
    } catch {
      // dismissed
    }
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Feather name="arrow-left" size={20} color={FG} />
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
              <Text style={s.storeName}>Brandthread</Text>
              <Text style={s.storeHandle}>@vaultstudio</Text>
            </View>
          </View>

          {/* QR code */}
          <View style={s.qrWrapper}>
            <QRCode
              value={STORE_URL}
              size={200}
              backgroundColor="#FFFFFF"
              color="#0D0E0D"
            />
          </View>

          {/* URL label */}
          <Text style={s.urlLabel}>{STORE_URL}</Text>
        </View>

        {/* Copy link button */}
        <TouchableOpacity
          style={[s.copyBtn, copied && s.copyBtnDone]}
          activeOpacity={0.85}
          onPress={copyLink}
        >
          <Feather name={copied ? 'check' : 'copy'} size={17} color={copied ? '#0A0B0A' : '#0A0B0A'} />
          <Text style={s.copyBtnText}>{copied ? 'Link Copied!' : 'Copy Link'}</Text>
        </TouchableOpacity>

        {/* Share button */}
        <TouchableOpacity style={s.shareBtn} activeOpacity={0.8} onPress={shareLink}>
          <Feather name="share-2" size={17} color={FG} />
          <Text style={s.shareBtnText}>Share via…</Text>
        </TouchableOpacity>

        {/* Hint */}
        <Text style={s.hint}>
          Scan the QR code or share the link to let customers find your store directly.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: BG },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn:       { width: 38, height: 38, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },

  body:          { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 36 },

  qrCard:        { width: '100%', backgroundColor: CARD, borderRadius: 24, borderWidth: 1, borderColor: BORDER, alignItems: 'center', padding: 28, marginBottom: 20 },

  storeBadge:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28, alignSelf: 'flex-start' },
  storeLogoBox:  { width: 42, height: 42, borderRadius: 12, backgroundColor: GREEN_DIM, borderWidth: 1, borderColor: GREEN + '44', alignItems: 'center', justifyContent: 'center' },
  storeName:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  storeHandle:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },

  qrWrapper:     { padding: 16, backgroundColor: '#FFFFFF', borderRadius: 16, marginBottom: 20 },

  urlLabel:      { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED, textAlign: 'center' },

  copyBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', backgroundColor: GREEN, borderRadius: 16, paddingVertical: 16, marginBottom: 12 },
  copyBtnDone:   { backgroundColor: '#22C55E' },
  copyBtnText:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },

  shareBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingVertical: 16, marginBottom: 24 },
  shareBtnText:  { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },

  hint:          { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', lineHeight: 18, paddingHorizontal: 16 },
});
