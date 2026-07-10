import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface StatusRow {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  description: string;
}

const PRIVACY_ROWS: StatusRow[] = [
  { key: 'policy', icon: 'file-text', label: 'Privacy policy', description: 'Published on your online store' },
  { key: 'cookie', icon: 'monitor', label: 'Cookie banner', description: 'Visible in Austria, Belgium and 29 other regions' },
  { key: 'sharing', icon: 'send', label: 'Data sharing opt out page', description: 'Active in California, Colorado and 13 other states' },
];

const MARKETING_ROWS: { key: string; icon: keyof typeof Feather.glyphMap; label: string; description: string }[] = [
  { key: 'checkout-marketing', icon: 'mail', label: 'E-mail and SMS marketing in checkout', description: 'Ask your customers for their marketing preferences' },
  { key: 'double-opt-in', icon: 'shield', label: 'Double opt-in for marketing', description: 'Ask your customers to confirm their contact details' },
];

export default function CustomerPrivacyScreen() {
  const colors = useColors();
  const [networkIntelEnabled, setNetworkIntelEnabled] = useState(true);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Customer privacy" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Privacy settings</Text>
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {PRIVACY_ROWS.map((row, i) => (
              <TouchableOpacity
                key={row.key}
                onPress={haptic}
                activeOpacity={0.7}
                style={[styles.privacyRow, i !== PRIVACY_ROWS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              >
                <View style={styles.privacyTop}>
                  <Feather name={row.icon} size={17} color={colors.foreground} style={styles.rowIcon} />
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={[styles.rowLabel, { color: colors.foreground }]}>{row.label}</Text>
                    <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>{row.description}</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                </View>
                <View style={[styles.statusPill, { backgroundColor: colors.success + '26', marginLeft: 32 }]}>
                  <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
                  <Text style={[styles.statusPillText, { color: colors.success }]}>Automated</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={[styles.networkRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="shield" size={17} color={colors.foreground} style={styles.rowIcon} />
            <View style={styles.rowStart}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Brandthread Network Intelligence</Text>
              <View style={[styles.statusPill, { backgroundColor: colors.success + '26', marginLeft: 8 }]}>
                <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.statusPillText, { color: colors.success }]}>Enabled</Text>
              </View>
            </View>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              onPress={() => { haptic(); setNetworkIntelEnabled((v) => !v); }}
              activeOpacity={0.7}
              style={[styles.disableBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.disableBtnText, { color: colors.foreground }]}>{networkIntelEnabled ? 'Disable' : 'Enable'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            Your customer data is securely used with other Brandthread data to improve products, ad targeting, and personalization for your store as described in the{' '}
            <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>Additional Services Terms</Text>. No other merchant can see your data.
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Marketing settings</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 14 }]}>
            {MARKETING_ROWS.map((row, i) => (
              <TouchableOpacity
                key={row.key}
                onPress={haptic}
                activeOpacity={0.7}
                style={[styles.row, i !== MARKETING_ROWS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              >
                <Feather name={row.icon} size={17} color={colors.foreground} style={styles.rowIcon} />
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>{row.label}</Text>
                  <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>{row.description}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Data storage hosting location</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.countryRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={styles.flag}>🇺🇸</Text>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>United States</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            Recommended privacy settings are for your convenience. Compliance with laws and regulations is your responsibility.{' '}
            <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>Learn more</Text>
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  divider: { height: 10 },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginTop: 14 },
  privacyRow: { padding: 14, gap: 8 },
  privacyTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  rowIcon: { width: 20, marginTop: 2 },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rowDescription: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2, lineHeight: 17 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  networkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12, flexWrap: 'wrap' },
  disableBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  disableBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  footerText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  countryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 14 },
  flag: { fontSize: 20 },
});
