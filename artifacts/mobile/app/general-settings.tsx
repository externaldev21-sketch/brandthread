import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const REGIONS = ['United States', 'Canada', 'United Kingdom', 'Australia'];
const UNIT_SYSTEMS = ['Imperial system', 'Metric system'];
const WEIGHT_UNITS = ['Ounce (oz)', 'Pound (lb)', 'Kilogram (kg)', 'Gram (g)'];
const TIME_ZONES = [
  '(GMT-06:00) Central Time (US & Canada)',
  '(GMT-05:00) Eastern Time (US & Canada)',
  '(GMT-08:00) Pacific Time (US & Canada)',
  '(GMT+00:00) London',
];

type FulfillmentOption = 'all' | 'giftCards' | 'none';

export default function GeneralSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const [region, setRegion] = useState(0);
  const [unitSystem, setUnitSystem] = useState(0);
  const [weightUnit, setWeightUnit] = useState(0);
  const [timeZone, setTimeZone] = useState(0);
  const [prefix, setPrefix] = useState('#');
  const [suffix, setSuffix] = useState('');
  const [fulfillment, setFulfillment] = useState<FulfillmentOption>('none');
  const [autoArchive, setAutoArchive] = useState(true);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function cycle(list: string[], current: number, setter: (i: number) => void) {
    haptic();
    setter((current + 1) % list.length);
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="General" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Business details */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Business details</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Business entity used for financial products, markets, apps, and taxes in this shop
          </Text>
          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.rowBetween}>
              <View style={styles.rowStart}>
                <Text style={styles.flagEmoji}>🇺🇸</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Galleria Desires</Text>
                  <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                    Multi-member LLC · 3801 Vitruvian Way, Addison, TX 75001, United States
                  </Text>
                </View>
              </View>
              <Feather name="more-horizontal" size={18} color={colors.mutedForeground} />
            </View>
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        {/* Store contact details */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Store contact details</Text>
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.listRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <Feather name="home" size={17} color={colors.foreground} style={styles.listIcon} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Galleria Desires</Text>
                <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>galleriadesires@gmail.com · No phone number</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={styles.listRow}>
              <Feather name="map-pin" size={17} color={colors.foreground} style={styles.listIcon} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Store address</Text>
                <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>3801 Vitruvian Way, 160, Addison Texas 75001, United States</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        {/* Store defaults */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Store defaults</Text>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 12 }]}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Currency display</Text>
                <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                  To manage the currencies customers see, go to{' '}
                  <Text style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/store-domain' as never)}>Markets</Text>
                </Text>
              </View>
              <Feather name="more-horizontal" size={18} color={colors.mutedForeground} />
            </View>
            <View style={[styles.pill, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.pillText, { color: colors.foreground }]}>US Dollar (USD $)</Text>
            </View>
          </View>

          <SelectField
            label="Backup Region"
            value={REGIONS[region]}
            onPress={() => cycle(REGIONS, region, setRegion)}
            hint="Determines settings for customers outside of your markets"
            colors={colors}
          />
          <SelectField
            label="Unit system"
            value={UNIT_SYSTEMS[unitSystem]}
            onPress={() => cycle(UNIT_SYSTEMS, unitSystem, setUnitSystem)}
            colors={colors}
          />
          <SelectField
            label="Default weight unit"
            value={WEIGHT_UNITS[weightUnit]}
            onPress={() => cycle(WEIGHT_UNITS, weightUnit, setWeightUnit)}
            colors={colors}
          />
          <SelectField
            label="Time zone"
            value={TIME_ZONES[timeZone]}
            onPress={() => cycle(TIME_ZONES, timeZone, setTimeZone)}
            hint="Sets the time for when orders and analytics are recorded"
            colors={colors}
          />

          <View style={[styles.noteBox, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
              To change your user level time zone and language visit your{' '}
              <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>account settings</Text>
            </Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        {/* Order ID format */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Order ID format</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Shown on the order page, customer pages, and customer order notifications to identify order
          </Text>

          <View style={[styles.inputBox, { borderColor: colors.border, marginBottom: 12 }]}>
            <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Prefix</Text>
            <TextInput value={prefix} onChangeText={setPrefix} style={[styles.input, { color: colors.foreground }]} />
          </View>
          <View style={[styles.inputBox, { borderColor: colors.border }]}>
            <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Suffix</Text>
            <TextInput
              value={suffix}
              onChangeText={setSuffix}
              placeholder=""
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground }]}
            />
          </View>
          <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
            Your order ID will appear as {prefix}1001, {prefix}1002, {prefix}1003, ...
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        {/* Order processing */}
        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Order processing</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[styles.groupLabel, { color: colors.foreground }]}>After an order has been paid</Text>

          <RadioRow
            label="Automatically fulfill the order's line items"
            selected={fulfillment === 'all'}
            onPress={() => { haptic(); setFulfillment('all'); }}
            colors={colors}
          />
          <RadioRow
            label="Automatically fulfill only the gift cards of the order"
            selected={fulfillment === 'giftCards'}
            onPress={() => { haptic(); setFulfillment('giftCards'); }}
            colors={colors}
          />
          <RadioRow
            label="Don't fulfill any of the order's line items automatically"
            selected={fulfillment === 'none'}
            onPress={() => { haptic(); setFulfillment('none'); }}
            colors={colors}
          />

          <Text style={[styles.groupLabel, { color: colors.foreground, marginTop: 16 }]}>
            After an order has been fulfilled and paid, or when all items have been refunded
          </Text>
          <TouchableOpacity
            onPress={() => { haptic(); setAutoArchive((v) => !v); }}
            activeOpacity={0.7}
            style={styles.checkRow}
          >
            <View
              style={[
                styles.checkbox,
                { borderColor: autoArchive ? colors.primary : colors.border, backgroundColor: autoArchive ? colors.primary : 'transparent' },
              ]}
            >
              {autoArchive && <Feather name="check" size={12} color={colors.primaryForeground} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Automatically archive the order</Text>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>The order will be removed from your list of open orders.</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        {/* Store assets */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Store assets</Text>
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.listRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <Feather name="archive" size={17} color={colors.foreground} style={styles.listIcon} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Metafields</Text>
                <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>Available in themes and configurable for Storefront API</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={styles.listRow}>
              <Feather name="tag" size={17} color={colors.foreground} style={styles.listIcon} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Brand</Text>
                <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>Integrate brand assets across sales channels, themes and apps</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        {/* Resources */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Resources</Text>
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ExternalRow icon="git-merge" label="Change log" onPress={() => { haptic(); Linking.openURL('https://brandthread.app/changelog'); }} colors={colors} />
            <ExternalRow icon="help-circle" label="Brandthread Help Center" onPress={() => { haptic(); Linking.openURL('https://brandthread.app/help'); }} colors={colors} />
            <ExternalRow icon="code" label="Hire a Brandthread Partner" onPress={() => { haptic(); Linking.openURL('https://brandthread.app/partners'); }} colors={colors} last />
          </View>
          <TouchableOpacity
            onPress={haptic}
            activeOpacity={0.7}
            style={[styles.listCard, styles.listRow, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 10 }]}
          >
            <Feather name="activity" size={17} color={colors.foreground} style={styles.listIcon} />
            <Text style={[styles.cardTitle, { color: colors.foreground, flex: 1 }]}>Store activity log</Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function SelectField({
  label,
  value,
  onPress,
  hint,
  colors,
}: {
  label: string;
  value: string;
  onPress: () => void;
  hint?: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ marginBottom: hint ? 6 : 12 }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={[styles.selectBox, { borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>{label}</Text>
          <Text style={[styles.selectValue, { color: colors.foreground }]}>{value}</Text>
        </View>
        <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>
      {hint && <Text style={[styles.hintText, { color: colors.mutedForeground, marginTop: 4, marginBottom: 12 }]}>{hint}</Text>}
    </View>
  );
}

function RadioRow({
  label,
  selected,
  onPress,
  colors,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.radioRow}>
      <View style={[styles.radioOuter, { borderColor: selected ? colors.primary : colors.border }]}>
        {selected && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
      </View>
      <Text style={[styles.radioLabel, { color: colors.foreground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ExternalRow({
  icon,
  label,
  onPress,
  colors,
  last,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.listRow, !last && { borderBottomColor: colors.border, borderBottomWidth: 1 }]}
    >
      <Feather name={icon} size={17} color={colors.foreground} style={styles.listIcon} />
      <Text style={[styles.cardTitle, { color: colors.foreground, flex: 1 }]}>{label}</Text>
      <Feather name="external-link" size={16} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 14, lineHeight: 17 },
  divider: { height: 10 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  rowStart: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flex: 1 },
  flagEmoji: { fontSize: 20 },
  cardTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  cardSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 3, lineHeight: 17 },
  pill: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginTop: 12 },
  pillText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listIcon: { width: 20 },
  selectBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 12, padding: 14,
  },
  inputLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', marginBottom: 3 },
  selectValue: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  inputBox: { borderWidth: 1, borderRadius: 12, padding: 14 },
  input: { fontSize: 14, fontFamily: 'Inter_600SemiBold', padding: 0, marginTop: 2 },
  hintText: { fontSize: 11, fontFamily: 'Inter_400Regular', lineHeight: 16 },
  noteBox: { borderRadius: 12, padding: 14, marginTop: 14 },
  noteText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  groupLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 10 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  radioLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
});
