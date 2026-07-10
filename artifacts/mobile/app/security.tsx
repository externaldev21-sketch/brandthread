import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export default function SecurityScreen() {
  const colors = useColors();
  const [code, setCode] = useState('3711');

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function generateNewCode() {
    haptic();
    const next = String(Math.floor(1000 + Math.random() * 9000));
    setCode(next);
  }

  function deleteCode() {
    haptic();
    Alert.alert('Delete collaborator code', 'Are you sure you want to delete this collaborator code?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => setCode('') },
    ]);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Security" />

      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>User activity logs</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>Monitor and review user activities</Text>
          </View>
          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.viewBtn, { borderColor: colors.border }]}>
            <Text style={[styles.viewBtnText, { color: colors.foreground }]}>View</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Collaborators</Text>
        <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground, marginBottom: 16 }]}>
          Give designers, developers, and marketers access to this store. Collaborators don't count toward your staff limit. Learn more about{' '}
          <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>collaborators</Text>.
        </Text>

        <View style={styles.collabRow}>
          <Text style={[styles.collabName, { color: colors.foreground }]} numberOfLines={1}>Galleria Desires</Text>
          {code.length > 0 ? (
            <View style={[styles.codeBox, { borderColor: colors.border }]}>
              <Feather name="clipboard" size={14} color={colors.mutedForeground} />
              <Text style={[styles.codeText, { color: colors.foreground }]}>{code}</Text>
            </View>
          ) : (
            <View style={[styles.codeBox, { borderColor: colors.border }]}>
              <Text style={[styles.codeText, { color: colors.mutedForeground }]}>No code</Text>
            </View>
          )}
          <TouchableOpacity onPress={generateNewCode} activeOpacity={0.7} style={[styles.actionBtn, { borderColor: colors.border }]}>
            <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Generate new code</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={deleteCode} activeOpacity={0.7} style={[styles.iconBtn, { borderColor: colors.border }]}>
            <Feather name="trash-2" size={16} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.footerNote, { backgroundColor: colors.secondary }]}>
        <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
          Share this code to allow someone to send you a collaborator request for this store. You'll still need to review and approve this request from{' '}
          <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>Users</Text>.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  viewBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  viewBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  divider: { height: 10 },
  collabRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  collabName: { fontSize: 14, fontFamily: 'Inter_500Medium', flexShrink: 1, minWidth: 90 },
  codeBox: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  codeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  actionBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  actionBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  iconBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  footerNote: { paddingHorizontal: 20, paddingVertical: 16 },
  footerText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
});
