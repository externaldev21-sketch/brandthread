import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface NotifRow {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  description: string;
}

const ROWS: NotifRow[] = [
  { key: 'customer', icon: 'user', label: 'Customer notifications', description: 'Notify customers about order and account events' },
  { key: 'staff', icon: 'users', label: 'Staff notifications', description: 'Notify staff members about new order events' },
  { key: 'fulfillment', icon: 'package', label: 'Fulfillment request notification', description: 'Notify your fulfillment service provider when you mark an order as fulfilled' },
  { key: 'webhooks', icon: 'code', label: 'Webhooks', description: 'Send XML or JSON notifications about store events to a URL' },
];

export default function NotificationsSettingsScreen() {
  const colors = useColors();
  const [email, setEmail] = useState('store@brandthread.com');

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Notifications" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Sender email</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            The email your store uses to send and receive emails from your customers
          </Text>

          <View style={[styles.infoBox, { backgroundColor: colors.primary + '12' }]}>
            <Feather name="info" size={15} color={colors.primary} style={{ marginTop: 2 }} />
            <Text style={[styles.infoText, { color: colors.foreground }]}>
              Public domains like Gmail don't support custom sending. Customers will see your email as{' '}
              <Text style={{ fontFamily: 'Inter_700Bold' }}>store+70327206006@brandthreademail.com</Text>. For better brand recognition, use a custom domain or{' '}
              <Text style={{ textDecorationLine: 'underline', color: colors.primary }} onPress={haptic}>create a new one</Text>.
            </Text>
          </View>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            style={[styles.emailInput, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
          />
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {ROWS.map((row, i) => (
              <TouchableOpacity
                key={row.key}
                onPress={haptic}
                activeOpacity={0.7}
                style={[styles.row, i !== ROWS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, marginBottom: 14 },
  divider: { height: 10 },
  infoBox: { flexDirection: 'row', gap: 10, borderRadius: 12, padding: 14, marginBottom: 14 },
  infoText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, flex: 1 },
  emailInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular' },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  rowIcon: { width: 20, marginTop: 2 },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rowDescription: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 3, lineHeight: 17 },
});
