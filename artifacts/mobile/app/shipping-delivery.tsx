import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface AccordionRowProps {
  title: string;
  subtitle: string;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  colors: ReturnType<typeof useColors>;
  last?: boolean;
}

function ComingSoonPill({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.offPill, { backgroundColor: colors.secondary }]}>
      <Text style={[styles.offPillText, { color: colors.mutedForeground }]}>Coming soon</Text>
    </View>
  );
}

function AccordionRow({ title, subtitle, expanded, onToggle, children, colors, last }: AccordionRowProps) {
  return (
    <View style={[!last && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7} style={styles.accordionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>{subtitle}</Text>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
      </TouchableOpacity>
      {expanded && <View style={styles.accordionBody}>{children}</View>}
    </View>
  );
}

export default function ShippingDeliveryScreen() {
  const colors = useColors();
  const [profilesOpen, setProfilesOpen] = useState(true);
  const [datesOpen, setDatesOpen] = useState(false);
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [carrierOpen, setCarrierOpen] = useState(false);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function toggle(setter: React.Dispatch<React.SetStateAction<boolean>>) {
    haptic();
    setter((v) => !v);
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Shipping and delivery" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Feather name="package" size={16} color={colors.foreground} />
            <Text style={[styles.groupTitle, { color: colors.foreground, marginLeft: 8 }]}>Shipping</Text>
          </View>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 14 }]}>
            <AccordionRow title="Shipping profiles" subtitle="Coming soon" expanded={profilesOpen} onToggle={() => toggle(setProfilesOpen)} colors={colors}>
              <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
                Custom shipping profiles per product group aren{'’'}t available yet. Set your rates from the Shipping screen for now.
              </Text>
            </AccordionRow>

            <AccordionRow title="Estimated delivery dates" subtitle="Coming soon" expanded={datesOpen} onToggle={() => toggle(setDatesOpen)} colors={colors}>
              <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
                Automatic delivery-date estimates aren{'’'}t available yet.
              </Text>
            </AccordionRow>

            <AccordionRow title="Packages" subtitle="Coming soon" expanded={packagesOpen} onToggle={() => toggle(setPackagesOpen)} colors={colors}>
              <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
                Saved package sizes aren{'’'}t available yet.
              </Text>
            </AccordionRow>

            <AccordionRow title="Carrier accounts" subtitle="None connected" expanded={carrierOpen} onToggle={() => toggle(setCarrierOpen)} colors={colors} last>
              <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
                Connecting your own carrier account isn{'’'}t available yet.
              </Text>
            </AccordionRow>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Additional delivery methods</Text>
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.simpleRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <Feather name="truck" size={17} color={colors.mutedForeground} style={styles.rowIcon} />
              <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>Local delivery</Text>
              <ComingSoonPill colors={colors} />
            </View>
            <View style={styles.simpleRow}>
              <Feather name="home" size={17} color={colors.mutedForeground} style={styles.rowIcon} />
              <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>Pickup in store</Text>
              <ComingSoonPill colors={colors} />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 14, lineHeight: 17 },
  groupTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  divider: { height: 10 },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  accordionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14 },
  accordionBody: { paddingHorizontal: 14, paddingBottom: 14 },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rowDescription: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2, lineHeight: 17 },
  hintText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  profileGroup: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  profileGroupTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 8 },
  profileRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 },
  addProfileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  addProfileText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  emoji: { fontSize: 13 },
  splitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: 10, marginTop: 4 },
  onPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  onPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  offPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginRight: 8 },
  offPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  carrierChipRow: { flexDirection: 'row', gap: 8 },
  carrierChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  carrierChipText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  simpleRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  rowIcon: { width: 20 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  addProviderBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 1, paddingVertical: 14, borderStyle: 'dashed' },
  addProviderText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
