import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FONT } from '@/lib/theme';

// Note: the previous "Collaborators" block (a fake local-only collaborator
// code that never persisted or verified anything server-side) has been
// removed — there is no real backing API for it in this codebase (§11a).
// Re-add it once a real invite/collaborator API exists.
export default function SecurityScreen() {
  const colors = useColors();
  const router = useRouter();

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function viewActivityLog() {
    haptic();
    router.push('/login-activity' as any);
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Security" />

      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>User activity logs</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>Monitor and review user activities</Text>
          </View>
          <TouchableOpacity onPress={viewActivityLog} activeOpacity={0.7} style={[styles.viewBtn, { borderColor: colors.border }]}>
            <Text style={[styles.viewBtnText, { color: colors.foreground }]}>View</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: FONT.semibold, marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  rowBetween: { flexDirection: 'row', alignItems: 'center' },
  viewBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  viewBtnText: { fontSize: 13, fontFamily: FONT.medium },
  divider: { height: 8 },
  collabRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  collabName: { fontSize: 14, fontFamily: FONT.medium, flexShrink: 1 },
  codeBox: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  codeText: { fontSize: 13, fontFamily: FONT.medium, letterSpacing: 1 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  actionBtnText: { fontSize: 13, fontFamily: FONT.medium },
  iconBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  footerNote: { paddingHorizontal: 20, paddingVertical: 16 },
  footerText: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 18 },
});
