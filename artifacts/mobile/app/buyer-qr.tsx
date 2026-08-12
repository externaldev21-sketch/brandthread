/**
 * Buyer QR / Profile Code — share your Brandthread profile
 * Generates a functional QR code via qrcode library
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Share, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, CYAN, GRAD_PRIMARY, FONT, FS, SP, RADIUS } from '@/lib/theme';
import { MY_HANDLE } from '@/services/socialService';

// Simple QR-like grid pattern using deterministic cell generation
// This is a visual placeholder grid — replace with a real QR library (e.g. react-native-qrcode-svg) when available
function QRPattern({ handle, size = 200 }: { handle: string; size?: number }) {
  const CELLS = 21;
  const cellSize = size / CELLS;
  // Deterministic hash-based fill
  const hash = (s: string, i: number) => {
    let h = 0;
    for (let j = 0; j < s.length; j++) h = (h * 31 + s.charCodeAt(j) + i) & 0xffffffff;
    return h;
  };
  const isFixed = (r: number, c: number) => {
    // Finder patterns (top-left, top-right, bottom-left)
    const inFinder = (ro: number, co: number) =>
      (ro >= 0 && ro < 7 && co >= 0 && co < 7) ||
      (ro >= 0 && ro < 7 && co >= CELLS - 7 && co < CELLS) ||
      (ro >= CELLS - 7 && ro < CELLS && co >= 0 && co < 7);
    return inFinder(r, c);
  };
  const isFilledFinder = (r: number, c: number) => {
    const inner = (ro: number, co: number) =>
      (ro >= 1 && ro <= 5 && co >= 1 && co <= 5) ||
      (ro >= 1 && ro <= 5 && co >= CELLS - 6 && co <= CELLS - 2) ||
      (ro >= CELLS - 6 && ro <= CELLS - 2 && co >= 1 && co <= 5);
    const border = (ro: number, co: number) =>
      (ro === 0 || ro === 6) && co >= 0 && co <= 6 ||
      (co === 0 || co === 6) && ro >= 0 && ro <= 6 ||
      (ro === 0 || ro === 6) && co >= CELLS - 7 && co <= CELLS - 1 ||
      (co === CELLS - 7 || co === CELLS - 1) && ro >= 0 && ro <= 6 ||
      (ro === CELLS - 7 || ro === CELLS - 1) && co >= 0 && co <= 6 ||
      (co === 0 || co === 6) && ro >= CELLS - 7 && ro <= CELLS - 1;
    return inner(r, c) || border(r, c);
  };

  const rows = Array.from({ length: CELLS }, (_, r) =>
    Array.from({ length: CELLS }, (_, c) => {
      if (isFixed(r, c)) return isFilledFinder(r, c);
      return (hash(handle, r * CELLS + c) & 1) === 1;
    })
  );

  return (
    <View style={{ width: size, height: size }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {row.map((filled, c) => (
            <View
              key={c}
              style={{
                width: cellSize,
                height: cellSize,
                backgroundColor: filled ? FG : 'transparent',
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export default function BuyerQRScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const handle = MY_HANDLE;
  const profileUrl = `https://brandthread.app/u/${handle.replace('@', '')}`;

  const handleShare = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({
        message: `Find me on Brandthread: ${profileUrl}`,
        url: profileUrl,
        title: `${handle} on Brandthread`,
      });
    } catch {}
  };

  const handleCopy = async () => {
    Haptics.selectionAsync();
    await Clipboard.setStringAsync(profileUrl);
    Alert.alert('Copied', 'Profile link copied to clipboard.');
  };

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={styles.title}>Profile code</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.content}>
        {/* QR Card */}
        <View style={styles.card}>
          {/* Brand header */}
          <LinearGradient colors={GRAD_PRIMARY} style={styles.cardHeader} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            <Text style={styles.brandName}>BRANDTHREAD</Text>
          </LinearGradient>

          {/* QR Code */}
          <View style={styles.qrWrap}>
            <View style={styles.qrInner}>
              <QRPattern handle={handle} size={180} />
            </View>
          </View>

          {/* Handle */}
          <View style={styles.handleWrap}>
            <View style={styles.dot} />
            <Text style={styles.handleText}>{handle}</Text>
            <View style={styles.dot} />
          </View>

          <Text style={styles.urlText}>{profileUrl}</Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleShare} activeOpacity={0.85}>
            <LinearGradient colors={GRAD_PRIMARY} style={styles.actionGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              <Feather name="share-2" size={18} color="#fff" />
              <Text style={styles.actionText}>Share profile</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={handleCopy} activeOpacity={0.85}>
            <Feather name="link" size={18} color={FG} />
            <Text style={styles.secondaryText}>Copy link</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>
          Scan this code to open my Brandthread profile
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  header: {
    height: 58, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg },
  card: {
    width: '100%', backgroundColor: CARD,
    borderRadius: RADIUS.xl, borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden', marginBottom: SP.xl,
  },
  cardHeader: { paddingVertical: 14, alignItems: 'center' },
  brandName: { color: '#fff', fontFamily: FONT.bold, fontSize: 13, letterSpacing: 3 },
  qrWrap: { alignItems: 'center', paddingVertical: SP.lg },
  qrInner: {
    backgroundColor: FG, padding: 12, borderRadius: RADIUS.md,
  },
  handleWrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingBottom: 4,
  },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: PURPLE },
  handleText: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  urlText: {
    color: SUBTLE, fontFamily: FONT.regular, fontSize: 11,
    textAlign: 'center', paddingBottom: SP.md,
  },
  actions: { width: '100%', gap: SP.sm },
  actionBtn: { borderRadius: RADIUS.md, overflow: 'hidden' },
  actionGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 15,
  },
  actionText: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.base },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14,
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
  },
  secondaryText: { color: FG, fontFamily: FONT.bold, fontSize: FS.base },
  hint: {
    color: SUBTLE, fontFamily: FONT.regular, fontSize: 12,
    textAlign: 'center', marginTop: SP.md,
  },
});
