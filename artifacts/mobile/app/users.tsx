import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export default function UsersScreen() {
  const colors = useColors();

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Users"
        rightElement={
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={haptic}
              activeOpacity={0.7}
              style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name="plus" size={17} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={haptic}
              activeOpacity={0.7}
              style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name="more-horizontal" size={17} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        }
      />

      <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.userRow, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.userName, { color: colors.foreground }]}>galleria desires</Text>
          <Text style={[styles.userEmail, { color: colors.mutedForeground }]}>galleriadesires@gmail.com</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: colors.success + '26' }]}>
          <Text style={[styles.statusText, { color: colors.success }]}>Active</Text>
        </View>
      </TouchableOpacity>

      <View style={[styles.body, { backgroundColor: colors.secondary }]}>
        <TouchableOpacity onPress={haptic} activeOpacity={0.7}>
          <Text style={[styles.learnMore, { color: colors.mutedForeground }]}>Learn more about users</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    gap: 12,
  },
  userName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  userEmail: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  statusPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  body: { flex: 1, alignItems: 'center', paddingTop: 24 },
  learnMore: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});
