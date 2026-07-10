import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const SUGGESTIONS = [
  'Add Spanish for your customers in Rest of World',
  'Add German for your customers in Rest of World',
];

export default function LanguagesScreen() {
  const colors = useColors();

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Languages"
        rightElement={
          <TouchableOpacity
            onPress={haptic}
            activeOpacity={0.7}
            style={[styles.addBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="plus" size={18} color={colors.foreground} />
          </TouchableOpacity>
        }
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Languages</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Adding translations to your store improves cross-border conversion by an average of 13%
          </Text>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.tableHeaderText, { color: colors.mutedForeground, flex: 1.1 }]}>Language</Text>
              <Text style={[styles.tableHeaderText, { color: colors.mutedForeground, flex: 1 }]}>Status</Text>
              <Text style={[styles.tableHeaderText, { color: colors.mutedForeground, flex: 1 }]}>Domains</Text>
            </View>

            <View style={[styles.langRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <View style={{ flex: 1.1 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>English</Text>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>Default</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={[styles.onPill, { backgroundColor: colors.success + '26' }]}>
                  <Text style={[styles.onPillText, { color: colors.success }]}>Published</Text>
                </View>
              </View>
              <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.domainsBtn, { flex: 1 }]}>
                <Text style={[styles.domainsText, { color: colors.foreground }]}>3 domains</Text>
                <Feather name="chevron-down" size={13} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {SUGGESTIONS.map((s, i) => (
              <TouchableOpacity
                key={s}
                onPress={haptic}
                activeOpacity={0.7}
                style={[
                  styles.suggestionRow,
                  { backgroundColor: colors.primary + '0F' },
                  i !== SUGGESTIONS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                ]}
              >
                <Feather name="star" size={14} color={colors.primary} />
                <Text style={[styles.suggestionText, { color: colors.primary }]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.adaptRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.appIcon, { backgroundColor: '#4F46E5' }]}>
              <Feather name="globe" size={16} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Brandthread Translate & Adapt</Text>
              <View style={styles.ratingRow}>
                <Text style={[styles.ratingText, { color: colors.mutedForeground }]}>4.5</Text>
                <Feather name="star" size={11} color={colors.mutedForeground} style={{ marginLeft: 3 }} />
              </View>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Translate your store and cater to global audiences
              </Text>
            </View>
            <View style={[styles.installBtn, { borderColor: colors.border }]}>
              <Feather name="download" size={13} color={colors.foreground} />
              <Text style={[styles.installText, { color: colors.foreground }]}>Install</Text>
            </View>
          </TouchableOpacity>

          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            Learn more about{' '}
            <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>languages</Text>. To change your account language,{' '}
            <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>manage account</Text>.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, marginBottom: 14 },
  addBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  tableHeaderText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.3 },
  langRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 6 },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rowDescription: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2, lineHeight: 17 },
  onPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  onPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  domainsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  domainsText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  suggestionText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', flex: 1 },
  adaptRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 14 },
  appIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  ratingText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  installBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  installText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  footerText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18, marginTop: 16 },
});
