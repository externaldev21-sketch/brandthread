import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const TABS = ['All', 'Active', 'Inactive', 'Physical storefront'];

export default function LocationsScreen() {
  const colors = useColors();
  const [activeTab, setActiveTab] = useState('All');
  const [appLocationOpen, setAppLocationOpen] = useState(true);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Locations" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>All locations</Text>
              <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
                Using 1 of 10 active locations available on your plan
              </Text>
            </View>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.addBtn, { borderColor: colors.border }]}>
              <Text style={[styles.addBtnText, { color: colors.foreground }]}>Add location</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.toolbarRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              <View style={[styles.tabsRow, { backgroundColor: colors.secondary }]}>
                {TABS.map((tab) => (
                  <TouchableOpacity
                    key={tab}
                    onPress={() => { haptic(); setActiveTab(tab); }}
                    activeOpacity={0.7}
                    style={[styles.tabChip, activeTab === tab && { backgroundColor: colors.card }]}
                  >
                    <Text
                      style={[
                        styles.tabText,
                        { color: activeTab === tab ? colors.foreground : colors.mutedForeground },
                        activeTab === tab && styles.tabTextActive,
                      ]}
                    >
                      {tab}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.iconBtn, { borderColor: colors.border }]}>
              <Feather name="search" size={15} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.iconBtn, { borderColor: colors.border }]}>
              <Feather name="filter" size={15} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.iconBtn, { borderColor: colors.border }]}>
              <Feather name="arrow-up" size={12} color={colors.mutedForeground} />
              <Feather name="arrow-down" size={12} color={colors.mutedForeground} style={{ marginLeft: -5 }} />
            </TouchableOpacity>
          </View>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.tableHeaderText, { color: colors.mutedForeground, flex: 1 }]}>Location</Text>
              <Text style={[styles.tableHeaderText, { color: colors.mutedForeground }]}>Status</Text>
            </View>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={styles.locationRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>Shop location</Text>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>United States</Text>
              </View>
              <View style={[styles.onPill, { backgroundColor: colors.success + '26' }]}>
                <Text style={[styles.onPillText, { color: colors.success }]}>Active</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Point of Sale subscriptions</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Start selling in person from any location with the in-person selling features included in your Brandthread plan
          </Text>

          <View style={[styles.posRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.posIcon, { backgroundColor: '#1E90FF' }]}>
              <Feather name="shopping-bag" size={14} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Point of Sale</Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>Installed</Text>
            </View>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.addBtn, { borderColor: colors.border }]}>
              <Text style={[styles.addBtnText, { color: colors.foreground }]}>Open</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>App and custom fulfillment locations</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            3rd-party services that manage inventory and fulfill orders
          </Text>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => { haptic(); setAppLocationOpen((v) => !v); }}
              activeOpacity={0.7}
              style={[styles.appLocationHeader, appLocationOpen && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>Tapstitch - Dropshipping</Text>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>1 location</Text>
              </View>
              <View style={[styles.appPill, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.appPillText, { color: colors.mutedForeground }]}>App</Text>
              </View>
              <Feather name={appLocationOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
            {appLocationOpen && (
              <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.subLocationRow, { borderColor: colors.border }]}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>ODMPOD</Text>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>United States</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <TouchableOpacity onPress={haptic} activeOpacity={0.7}>
          <Text style={[styles.learnMore, { color: colors.mutedForeground }]}>Learn more about locations</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  divider: { height: 10 },
  addBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, alignSelf: 'flex-start' },
  addBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 14 },
  tabsRow: { flexDirection: 'row', borderRadius: 10, padding: 3, gap: 2 },
  tabChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  tabText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  tabTextActive: { fontFamily: 'Inter_600SemiBold' },
  iconBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  tableHeaderText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.3 },
  locationRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rowDescription: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  onPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  onPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  posRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 14 },
  posIcon: { width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  appLocationHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  appPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  appPillText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  subLocationRow: { paddingHorizontal: 14, paddingVertical: 12, marginLeft: 14, marginRight: 14, marginBottom: 8, borderLeftWidth: 1 },
  learnMore: { fontSize: 12, fontFamily: 'Inter_500Medium', textAlign: 'center', paddingVertical: 16 },
});
