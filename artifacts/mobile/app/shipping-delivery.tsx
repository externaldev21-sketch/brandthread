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
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [carrierOpen, setCarrierOpen] = useState(false);
  const [routingOpen, setRoutingOpen] = useState(false);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function toggle(setter: React.Dispatch<React.SetStateAction<boolean>>) {
    haptic();
    setter((v) => !v);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Shipping and delivery" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Feather name="package" size={16} color={colors.foreground} />
            <Text style={[styles.groupTitle, { color: colors.foreground, marginLeft: 8 }]}>Shipping</Text>
          </View>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 14 }]}>
            <AccordionRow title="Shipping profiles" subtitle="2 profiles" expanded={profilesOpen} onToggle={() => toggle(setProfilesOpen)} colors={colors}>
              <Text style={[styles.hintText, { color: colors.mutedForeground, marginBottom: 12 }]}>
                Manage where you ship and rates for products
              </Text>

              <View style={[styles.profileGroup, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <Text style={[styles.profileGroupTitle, { color: colors.foreground }]}>Store default</Text>
                <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={styles.profileRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, { color: colors.foreground }]}>General profile</Text>
                    <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>All other products · 1 location · 1 zone</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
                <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={styles.addProfileRow}>
                  <Feather name="plus-circle" size={15} color={colors.foreground} />
                  <Text style={[styles.addProfileText, { color: colors.foreground }]}>Add custom profile</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.profileGroup, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <View style={styles.rowStart}>
                  <Text style={styles.emoji}>👕</Text>
                  <Text style={[styles.profileGroupTitle, { color: colors.foreground, marginLeft: 6 }]}>Tapstitch - Dropshipping</Text>
                </View>
                <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={styles.profileRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, { color: colors.foreground }]}>Tapstitch: Special Line</Text>
                    <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>220 products · 1 location · 30 zones</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              <View style={[styles.splitRow, { borderColor: colors.border }]}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                  Manage{' '}
                  <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>split shipping</Text>
                </Text>
                <View style={[styles.onPill, { backgroundColor: colors.success + '26' }]}>
                  <Text style={[styles.onPillText, { color: colors.success }]}>On</Text>
                </View>
              </View>
            </AccordionRow>

            <AccordionRow title="Estimated delivery dates" subtitle="Automated dates" expanded={datesOpen} onToggle={() => toggle(setDatesOpen)} colors={colors}>
              <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
                Delivery dates are calculated automatically based on shipping profile transit times.
              </Text>
            </AccordionRow>

            <AccordionRow title="Packages" subtitle="1 box" expanded={packagesOpen} onToggle={() => toggle(setPackagesOpen)} colors={colors}>
              <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={styles.profileRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>Standard box</Text>
                  <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>12 × 9 × 4 in · Default</Text>
                </View>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            </AccordionRow>

            <AccordionRow title="Shipping labels" subtitle="+ 3" expanded={labelsOpen} onToggle={() => toggle(setLabelsOpen)} colors={colors}>
              <View style={styles.carrierChipRow}>
                <View style={[styles.carrierChip, { backgroundColor: '#1A56C4' }]}>
                  <Text style={styles.carrierChipText}>USPS</Text>
                </View>
                <View style={[styles.carrierChip, { backgroundColor: '#FFB800' }]}>
                  <Text style={[styles.carrierChipText, { color: '#1F2937' }]}>UPS</Text>
                </View>
                <View style={[styles.carrierChip, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.carrierChipText, { color: colors.foreground }]}>+3</Text>
                </View>
              </View>
            </AccordionRow>

            <AccordionRow title="Carrier accounts" subtitle="None" expanded={carrierOpen} onToggle={() => toggle(setCarrierOpen)} colors={colors}>
              <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={styles.addProfileRow}>
                <Feather name="plus-circle" size={15} color={colors.foreground} />
                <Text style={[styles.addProfileText, { color: colors.foreground }]}>Connect carrier account</Text>
              </TouchableOpacity>
            </AccordionRow>

            <AccordionRow title="Order routing" subtitle="3 rules" expanded={routingOpen} onToggle={() => toggle(setRoutingOpen)} colors={colors} last>
              <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
                Rules determine which location fulfills an order based on inventory and proximity.
              </Text>
            </AccordionRow>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Additional delivery methods</Text>
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.simpleRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <Feather name="truck" size={17} color={colors.foreground} style={styles.rowIcon} />
              <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>Local delivery</Text>
              <View style={[styles.offPill, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.offPillText, { color: colors.mutedForeground }]}>Off</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={styles.simpleRow}>
              <Feather name="home" size={17} color={colors.foreground} style={styles.rowIcon} />
              <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>Pickup in store</Text>
              <View style={[styles.offPill, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.offPillText, { color: colors.mutedForeground }]}>Off</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Documents</Text>
          <View style={{ gap: 10 }}>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.docRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="file-text" size={17} color={colors.foreground} style={styles.rowIcon} />
              <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>Sender name on shipping labels</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.docRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="file" size={17} color={colors.foreground} style={styles.rowIcon} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>Templates</Text>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>Packing slip, Invoice, Pick list</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Delivery customizations</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Customizations control how delivery options appear to buyers at checkout. You can hide, reorder, and rename delivery options.
          </Text>
          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.addProviderBtn, { borderColor: colors.border }]}>
            <Feather name="plus-circle" size={16} color={colors.foreground} />
            <Text style={[styles.addProviderText, { color: colors.foreground }]}>Add delivery customization</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Custom order fulfillment</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Add an email for a custom fulfillment service that fulfills orders for you
          </Text>
          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.addProviderBtn, { borderColor: colors.border }]}>
            <Feather name="plus-circle" size={16} color={colors.foreground} />
            <Text style={[styles.addProviderText, { color: colors.foreground }]}>Add fulfillment service</Text>
          </TouchableOpacity>
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
