import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export default function CustomerEventsScreen() {
  const colors = useColors();
  const [search, setSearch] = useState('');

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Customer events"
        rightElement={
          <TouchableOpacity
            onPress={haptic}
            activeOpacity={0.7}
            style={[styles.moreBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="more-horizontal" size={18} color={colors.foreground} />
          </TouchableOpacity>
        }
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Pixels</Text>

          <View style={styles.searchRow}>
            <View style={[styles.searchBox, { backgroundColor: colors.secondary }]}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search pixels"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.searchInput, { color: colors.foreground }]}
              />
            </View>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.sortBtn, { borderColor: colors.border }]}>
              <Feather name="arrow-up" size={13} color={colors.mutedForeground} />
              <Feather name="arrow-down" size={13} color={colors.mutedForeground} style={{ marginLeft: -6 }} />
            </TouchableOpacity>
          </View>

          <View style={[styles.pixelCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.pixelHeader}>
              <View style={[styles.pixelIcon, { backgroundColor: '#0B0B0B' }]}>
                <Feather name="video" size={14} color="#FFFFFF" />
              </View>
              <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>Klaviyo: Email Marketing & SMS</Text>
              <TouchableOpacity onPress={haptic} activeOpacity={0.7}>
                <Feather name="more-horizontal" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <View style={styles.chipRow}>
              <View style={[styles.chip, { backgroundColor: colors.success + '26' }]}>
                <View style={[styles.chipDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.chipText, { color: colors.success }]}>Server</Text>
              </View>
              <View style={[styles.chip, { backgroundColor: colors.success + '26' }]}>
                <View style={[styles.chipDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.chipText, { color: colors.success }]}>Web</Text>
              </View>
            </View>
            <Text style={[styles.statusLine, { color: colors.mutedForeground }]}>• Optimized</Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <TouchableOpacity onPress={haptic} activeOpacity={0.7}>
          <Text style={[styles.learnMore, { color: colors.mutedForeground }]}>Learn more about pixels</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 14 },
  divider: { height: 10 },
  moreBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  searchBox: { flex: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput: { fontSize: 14, fontFamily: 'Inter_400Regular', padding: 0 },
  sortBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  pixelCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  pixelHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  pixelIcon: { width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  statusLine: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  learnMore: { fontSize: 12, fontFamily: 'Inter_500Medium', textAlign: 'center', paddingVertical: 40 },
});
