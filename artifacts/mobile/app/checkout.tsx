import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const CHECKOUT_MODES = ['Checkout only', 'Accounts optional', 'Accounts required'];

export default function CheckoutScreen() {
  const colors = useColors();
  const [modeIndex, setModeIndex] = useState(0);
  const [tipping, setTipping] = useState(false);
  const [postPurchaseFeatures, setPostPurchaseFeatures] = useState(false);
  const [scripts, setScripts] = useState('');

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function cycleMode() {
    haptic();
    setModeIndex((i) => (i + 1) % CHECKOUT_MODES.length);
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Checkout settings" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <TouchableOpacity onPress={cycleMode} activeOpacity={0.7} style={[styles.selectBox, { borderColor: colors.border, marginBottom: 12 }]}>
            <Text style={[styles.selectValue, { color: colors.foreground }]}>{CHECKOUT_MODES[modeIndex]}</Text>
            <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tipping</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Customers can choose between 3 presets or enter a custom amount
          </Text>
          <TouchableOpacity
            onPress={() => { haptic(); setTipping((v) => !v); }}
            activeOpacity={0.7}
            style={styles.checkRow}
          >
            <View
              style={[
                styles.checkbox,
                { borderColor: tipping ? colors.primary : colors.border, backgroundColor: tipping ? colors.primary : 'transparent' },
              ]}
            >
              {tipping && <Feather name="check" size={12} color={colors.primaryForeground} />}
            </View>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Show tipping options at checkout</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Post-purchase page</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground, marginBottom: 14 }]}>
            Add tracking scripts and other customizations
          </Text>

          <TouchableOpacity onPress={() => { haptic(); setPostPurchaseFeatures((v) => !v); }} activeOpacity={0.7} style={styles.radioRow}>
            <View
              style={[
                styles.checkbox,
                { borderColor: postPurchaseFeatures ? colors.primary : colors.border, backgroundColor: postPurchaseFeatures ? colors.primary : 'transparent' },
              ]}
            >
              {postPurchaseFeatures && <Feather name="check" size={12} color={colors.primaryForeground} />}
            </View>
            <Text style={[styles.radioLabel, { color: colors.foreground }]}>Add extra features after checkout</Text>
          </TouchableOpacity>

          <View style={[styles.textAreaBox, { borderColor: colors.border }]}>
            <TextInput
              value={scripts}
              onChangeText={setScripts}
              placeholder="Additional scripts"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[styles.textArea, { color: colors.foreground }]}
            />
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Checkout language</Text>
          <View style={[styles.langRow, { borderColor: colors.border }]}>
            <Text style={[styles.langText, { color: colors.foreground }]}>English</Text>
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
  divider: { height: 10 },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  selectBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 12, padding: 14 },
  selectValue: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  cardTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  radioLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },
  textAreaBox: { borderWidth: 1, borderRadius: 12, marginTop: 4 },
  textArea: { fontSize: 13, fontFamily: 'Inter_400Regular', padding: 14, minHeight: 90, textAlignVertical: 'top' },
  langRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  langText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
});
