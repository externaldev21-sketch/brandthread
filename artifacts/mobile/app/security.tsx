import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { useColors } from '@/hooks/useColors';

import { ScreenHeader } from '@/components/ScreenHeader';

import { Button } from '@/components/ui/Button';

import { useRouter } from 'expo-router';

import { FONT } from '@/lib/theme';

// Note: the previous "Collaborators" block (a fake local-only collaborator
// code that never persisted or verified anything server-side) has been
// removed — there is no real backing API for it in this codebase (§11a).
// Re-add it once a real invite/collaborator API exists.
export default function SecurityScreen() {
  const colors = useColors();
  const router = useRouter();

  function viewActivityLog() {
    router.push('/login-activity' as any);
  }

  const accountRows: Array<{ title: string; subtitle?: string; label: string; route: string }> = [
    { title: 'Password', label: 'Change', route: '/change-password' },
    { title: 'Email address', label: 'Change', route: '/change-email' },
    { title: 'Two-factor authentication', subtitle: 'App and backup codes', label: 'Manage', route: '/login-methods' },
    { title: 'Download my data', label: 'Open', route: '/seller-data-export' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Security" />

      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={[styles.sectionTitle, styles.titleOnly, { color: colors.foreground }]}>Login activity</Text>
          </View>
          <Button label="View" variant="secondary" size="small" style={styles.rowBtn} onPress={viewActivityLog} />
        </View>
      </View>

      {accountRows.map((row) => (
        <View key={row.route} style={styles.section}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.sectionTitle, !row.subtitle && styles.titleOnly, { color: colors.foreground }]}>{row.title}</Text>
              {row.subtitle ? <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>{row.subtitle}</Text> : null}
            </View>
            <Button
              label={row.label}
              variant="secondary"
              size="small"
              style={styles.rowBtn}
              onPress={() => router.push(row.route as any)}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  // A row without a subtitle centers its title on the button.
  titleOnly: { marginBottom: 0 },
  sectionTitle: { fontSize: 15, fontFamily: FONT.semibold, marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  rowBetween: { flexDirection: 'row', alignItems: 'center' },
  rowBtn: { width: 128 },
  divider: { height: 8 },
  collabRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  collabName: { fontSize: 15, fontFamily: FONT.medium, flexShrink: 1 },
  codeBox: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  codeText: { fontSize: 13, fontFamily: FONT.medium },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  actionBtnText: { fontSize: 13, fontFamily: FONT.medium },
  iconBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  footerNote: { paddingHorizontal: 20, paddingVertical: 16 },
  footerText: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 18 },
});
