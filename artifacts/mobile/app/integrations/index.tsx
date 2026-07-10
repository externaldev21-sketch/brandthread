import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

interface IntegrationItem {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  iconBg: string;
  connected: boolean;
  route?: string;
}

const INTEGRATIONS: IntegrationItem[] = [
  { key: 'shopify', label: 'Shopify', icon: 'shopping-bag', iconBg: '#95BF47', connected: true },
  { key: 'instagram', label: 'Instagram', icon: 'instagram', iconBg: '#D62976', connected: true },
  { key: 'tiktok', label: 'TikTok', icon: 'music', iconBg: '#0B0B0B', connected: false },
  { key: 'klaviyo', label: 'Klaviyo', icon: 'mail', iconBg: '#1A1A1A', connected: true, route: '/integrations/klaviyo' },
  { key: 'stripe', label: 'Stripe', icon: 'credit-card', iconBg: '#635BFF', connected: true },
  { key: 'paypal', label: 'PayPal', icon: 'dollar-sign', iconBg: '#003087', connected: false },
  { key: 'shipstation', label: 'ShipStation', icon: 'truck', iconBg: '#4A5568', connected: false },
];

export default function IntegrationsScreen() {
  const colors = useColors();
  const router = useRouter();

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handlePress(item: IntegrationItem) {
    haptic();
    if (item.route) router.push(item.route as never);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Integrations" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Connect the tools you already use to run your brand — sales channels, marketing, and payments in one place.
          </Text>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {INTEGRATIONS.map((item, i) => (
              <TouchableOpacity
                key={item.key}
                onPress={() => handlePress(item)}
                activeOpacity={0.7}
                style={[styles.row, i !== INTEGRATIONS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              >
                <View style={[styles.iconWrap, { backgroundColor: item.iconBg }]}>
                  <Feather name={item.icon} size={16} color="#FFFFFF" />
                </View>
                <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>{item.label}</Text>
                {item.connected ? (
                  <View style={[styles.connectedPill, { backgroundColor: colors.success + '26' }]}>
                    <View style={[styles.dot, { backgroundColor: colors.success }]} />
                    <Text style={[styles.connectedText, { color: colors.success }]}>Connected</Text>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => handlePress(item)} activeOpacity={0.75} style={[styles.connectBtn, { borderColor: colors.border }]}>
                    <Text style={[styles.connectBtnText, { color: colors.foreground }]}>Connect</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, marginBottom: 16 },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  iconWrap: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  connectedPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  connectedText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  connectBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  connectBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});
