import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, RED, OVERLAY,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { requestDeactivation } from '@/lib/accountService';

type ConfirmModal = 'deactivate' | null;

function ConfirmationModal({
  type,
  onConfirm,
  onClose,
}: {
  type: ConfirmModal;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');
  const expected = 'DEACTIVATE';
  const valid = input.trim().toUpperCase() === expected;

  if (!type) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={m.backdrop}>
        <View style={[m.sheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={m.iconCircle}>
            <Feather name="pause-circle" size={28} color={RED} />
          </View>
          <Text style={m.title}>Deactivate Account?</Text>
          <Text style={m.desc}>
            Your deactivation request will be saved on this device. You will be signed out now. Sign back in at any time to reactivate.
          </Text>
          <Text style={m.typeHint}>Type <Text style={{ color: RED }}>{expected}</Text> to confirm</Text>
          <TextInput
            style={m.input}
            value={input}
            onChangeText={setInput}
            placeholder={expected}
            placeholderTextColor={SUBTLE}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <View style={m.btnRow}>
            <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
              <Text style={m.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[m.confirmBtn, !valid && m.confirmBtnDisabled]}
              onPress={valid ? onConfirm : undefined}
              activeOpacity={valid ? 0.7 : 1}
            >
              <Text style={m.confirmText}>Deactivate</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function BuyerAccountControl() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();
  const [confirmType, setConfirmType] = useState<ConfirmModal>(null);

  async function handleConfirm() {
    setConfirmType(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    // Persist the deactivation flag locally; sign back in to reactivate.
    await requestDeactivation();
    try { await signOut(); } catch {}
    router.replace('/welcome' as never);
  }

  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Account Control</Text>
        <View style={s.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
        <Text style={s.intro}>
          Manage what happens to your Brandthread account. These actions affect your data and access.
        </Text>

        {/* Deactivate */}
        <Text style={s.groupLabel}>Temporary</Text>
        <View style={s.card}>
          <View style={s.optionRow}>
            <View style={s.optionIconWrap}>
              <Feather name="pause-circle" size={22} color={MUTED} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.optionTitle}>Deactivate account</Text>
              <Text style={s.optionDesc}>
                Sign out and hide your profile while away. Sign back in at any time to reactivate — your data stays intact.
              </Text>
              <View style={s.bulletList}>
                {['Request saved locally on this device', 'Reactivate anytime by signing in', 'Your data stays intact', 'Server-side enforcement pending backend'].map(b => (
                  <View key={b} style={s.bullet}>
                    <Feather name="check" size={12} color={MUTED} />
                    <Text style={s.bulletText}>{b}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setConfirmType('deactivate'); }}
            activeOpacity={0.7}
          >
            <Feather name="pause-circle" size={16} color={MUTED} />
            <Text style={s.actionBtnText}>Deactivate account</Text>
          </TouchableOpacity>
        </View>

        {/* Account deletion — requires contacting support */}
        <View style={s.infoNote}>
          <Feather name="info" size={16} color={PURPLE} />
          <View style={{ flex: 1 }}>
            <Text style={s.infoTitle}>Want to delete your account?</Text>
            <Text style={s.infoDesc}>
              Account deletion requires server-side processing. Contact support@brandthread.com and our team will permanently remove your data.
            </Text>
          </View>
        </View>

        {/* Download data first */}
        <View style={s.downloadNote}>
          <Feather name="download" size={16} color={PURPLE} />
          <View style={{ flex: 1 }}>
            <Text style={s.downloadTitle}>Download your data first</Text>
            <Text style={s.downloadDesc}>Get a copy of everything before you go.</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/buyer-download-data' as never)}>
            <Text style={s.downloadLink}>Download</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <ConfirmationModal type={confirmType} onConfirm={handleConfirm} onClose={() => setConfirmType(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  intro: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 18, marginBottom: SP.md },
  groupLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SP.sm },
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginBottom: SP.sm },
  optionRow: { flexDirection: 'row', gap: 14, padding: SP.md },
  optionIconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: FG, marginBottom: 4 },
  optionDesc: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, lineHeight: 17 },
  bulletList: { marginTop: 10, gap: 6 },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bulletText: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: SP.md, paddingVertical: 14, borderTopWidth: 1, borderTopColor: BORDER },
  actionBtnText: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  infoNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: SP.md, backgroundColor: 'rgba(139,92,246,0.08)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(139,92,246,0.2)', marginTop: SP.sm, marginBottom: SP.sm },
  infoTitle: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG, marginBottom: 2 },
  infoDesc: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, lineHeight: 17 },
  downloadNote: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SP.md, backgroundColor: 'rgba(139,92,246,0.08)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(139,92,246,0.2)', marginTop: SP.sm },
  downloadTitle: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
  downloadDesc: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
  downloadLink: { fontFamily: FONT.semibold, fontSize: FS.sm, color: PURPLE },
});

const m = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: OVERLAY, alignItems: 'center', justifyContent: 'center', padding: SP.lg },
  sheet: { backgroundColor: CARD, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: BORDER, padding: SP.lg, width: '100%', maxWidth: 360 },
  iconCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: RED + '22', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: SP.md },
  title: { fontFamily: FONT.bold, fontSize: FS.md, color: FG, textAlign: 'center', marginBottom: SP.sm },
  desc: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', lineHeight: 20, marginBottom: SP.md },
  typeHint: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED, marginBottom: SP.xs },
  input: { height: 44, backgroundColor: BG, borderRadius: RADIUS.md, borderWidth: 1, borderColor: RED + '40', paddingHorizontal: SP.md, color: FG, fontFamily: FONT.medium, fontSize: FS.base, marginBottom: SP.md, letterSpacing: 2 },
  btnRow: { flexDirection: 'row', gap: SP.sm },
  cancelBtn: { flex: 1, height: 44, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  confirmBtn: { flex: 1, height: 44, borderRadius: RADIUS.md, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  confirmBtnDisabled: { opacity: 0.35 },
  confirmText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: '#FFF' },
});
