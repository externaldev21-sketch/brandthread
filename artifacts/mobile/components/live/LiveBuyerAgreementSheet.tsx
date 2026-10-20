/**
 * First show only: the buyer agreement, 1:1 with Whatnot's "Welcome to
 * your first show!" sheet (https://mobbin.com/flows/ed55f754-472f-46f8-914b-ce7cb7345c7b,
 * frame 5) — title, one muted line, four check rows, a full-width
 * "I agree" pill and a quiet "Go back" under it. Whatnot's auction line
 * ("Bids are binding") becomes the Buy now equivalent; the protection line
 * points at the same Purchase protection the Terms describe.
 *
 * Accepted once per device (AsyncStorage); "Go back" leaves the show.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SheetRise } from '@/components/motion/SheetRise';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, MEDIA, SP } from '@/lib/theme';
import { hapticSuccessAction } from '@/lib/haptics';

export const LIVE_BUYER_AGREEMENT_KEY = 'bt:live-buyer-agreement:v1';

export async function hasAcceptedLiveBuyerAgreement(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(LIVE_BUYER_AGREEMENT_KEY)) === 'accepted'; } catch { return false; }
}

export async function acceptLiveBuyerAgreement(): Promise<void> {
  try { await AsyncStorage.setItem(LIVE_BUYER_AGREEMENT_KEY, 'accepted'); } catch { /* best effort */ }
}

export function LiveBuyerAgreementSheet({ visible, onAgree, onGoBack }: {
  visible: boolean;
  onAgree: () => void;
  onGoBack: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const link = { color: theme.text, textDecorationLine: 'underline' as const };
  const rows: React.ReactNode[] = [
    'Buy now takes you straight to checkout for that item',
    'Keep a valid payment method on file so your orders go through',
    'Purchase protection covers orders that don’t arrive as described',
    <Text key="terms">
      You agree to our{' '}
      <Text style={link} onPress={() => router.push('/community-guidelines' as never)}>community guidelines</Text>
      {' '}and{' '}
      <Text style={link} onPress={() => router.push('/terms' as never)}>terms</Text>
    </Text>,
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onGoBack}>
      <View style={styles.backdrop} />
      <SheetRise
        style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.borderSubtle, paddingBottom: insets.bottom + SP.md }]}
        testID="live-buyer-agreement"
      >
        <Text style={[styles.title, { color: theme.text }]}>Before you watch</Text>
        <Text style={[styles.sub, { color: theme.muted }]}>Before you get started please review the buyer agreement:</Text>
        <View style={styles.rows}>
          {rows.map((row, i) => (
            <View key={i} style={styles.row}>
              <View style={[styles.check, { backgroundColor: theme.cardElevated, borderColor: theme.borderSubtle }]}>
                <Feather name="check" size={18} color={theme.text} />
              </View>
              <Text style={[styles.rowText, { color: theme.text }]}>{row}</Text>
            </View>
          ))}
        </View>
        <Pressable
          onPress={() => { hapticSuccessAction(); onAgree(); }}
          style={[styles.agree, { backgroundColor: theme.text }]}
          accessibilityRole="button"
          testID="live-agreement-agree"
        >
          <Text style={[styles.agreeText, { color: theme.background }]}>I agree</Text>
        </Pressable>
        <Pressable onPress={onGoBack} style={styles.back} accessibilityRole="button" testID="live-agreement-back">
          <Text style={[styles.backText, { color: theme.muted }]}>Go back</Text>
        </Pressable>
      </SheetRise>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: MEDIA.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20, paddingTop: 24,
  },
  title: { fontFamily: FONT.bold, fontSize: FS.xl, lineHeight: 28 },
  sub: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 20, marginTop: 6 },
  rows: { marginTop: 20, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  check: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, fontFamily: FONT.semibold, fontSize: FS.base, lineHeight: 20 },
  agree: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  agreeText: { fontFamily: FONT.bold, fontSize: FS.md },
  back: { alignItems: 'center', paddingVertical: 14 },
  backText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
