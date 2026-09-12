import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Switch, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export default function CustomerAccountsScreen() {
  const colors = useColors();
  const [signInLinks, setSignInLinks] = useState(true);
  const [selfServeReturns, setSelfServeReturns] = useState(false);
  const [storeCredit, setStoreCredit] = useState(true);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Customer accounts" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Sign-in links</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.row}>
              <Feather name="log-in" size={17} color={colors.foreground} style={styles.rowIcon} />
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>Show sign-in links</Text>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                  Show sign-in links in the header of online store and at checkout
                </Text>
              </View>
              <Switch
                value={signInLinks}
                onValueChange={() => { haptic(); setSignInLinks((v) => !v); }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
              />
            </View>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Customer accounts</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 14 }]}>
            <View style={[styles.listRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <Feather name="folder" size={17} color={colors.foreground} style={styles.rowIcon} />
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>Configurations</Text>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                  Configure apps, branding, and features for checkout and customer accounts
                </Text>
              </View>
              <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.actionBtn, { borderColor: colors.border }]}>
                <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Customize</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.listRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <Feather name="lock" size={17} color={colors.foreground} style={styles.rowIcon} />
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>Authentication</Text>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>Manage sign-in methods and account access</Text>
              </View>
              <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.actionBtn, { borderColor: colors.border }]}>
                <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Manage</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.listRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <Feather name="rotate-ccw" size={17} color={colors.foreground} style={styles.rowIcon} />
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>Self-serve returns and cancellations</Text>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                  Set conditions and fees with{' '}
                  <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>return and cancellation rules</Text>
                </Text>
              </View>
              <Switch
                value={selfServeReturns}
                onValueChange={() => { haptic(); setSelfServeReturns((v) => !v); }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
              />
            </View>

            <View style={[styles.listRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <Feather name="credit-card" size={17} color={colors.foreground} style={styles.rowIcon} />
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>Store credit</Text>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>Allow customers to see and spend store credit</Text>
              </View>
              <Switch
                value={storeCredit}
                onValueChange={() => { haptic(); setStoreCredit((v) => !v); }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
              />
            </View>

            <View style={styles.listRow}>
              <Feather name="link" size={17} color={colors.foreground} style={styles.rowIcon} />
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>URL</Text>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                  Use this URL anywhere you'd like customers to access customer accounts
                </Text>
              </View>
              <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.actionBtn, { borderColor: colors.border }]}>
                <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Change domain</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.urlBox, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.urlText, { color: colors.foreground }]} numberOfLines={1}>
              https://brandthread.app/70327206006/account
            </Text>
            <Feather name="link" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  divider: { height: 10 },
  card: { borderRadius: 14, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  rowIcon: { width: 20, marginTop: 2 },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rowDescription: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 3, lineHeight: 17 },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  actionBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start' },
  actionBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  urlBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, padding: 14, marginTop: 12, gap: 10 },
  urlText: { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
});
