import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';

const CHECKOUT_MODES = ['Checkout only', 'Accounts optional', 'Accounts required'];

type PostPurchaseApp = 'none' | 'smart';

export default function CheckoutScreen() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const [modeIndex, setModeIndex] = useState(0);
  const [tipping, setTipping] = useState(false);
  const [postPurchaseApp, setPostPurchaseApp] = useState<PostPurchaseApp>('smart');
  const [scripts, setScripts] = useState('');

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function cycleMode() {
    haptic();
    setModeIndex((i) => (i + 1) % CHECKOUT_MODES.length);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Checkout" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <TouchableOpacity onPress={cycleMode} activeOpacity={0.7} style={[styles.selectBox, { borderColor: colors.border, marginBottom: 12 }]}>
            <Text style={[styles.selectValue, { color: colors.foreground }]}>{CHECKOUT_MODES[modeIndex]}</Text>
            <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>

          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.smsRow, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.smsText, { color: colors.foreground }]}>Text me with news and offers</Text>
            <Feather name="edit-2" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
          <Text style={[styles.hintText, { color: colors.mutedForeground, marginTop: 6 }]}>
            To launch SMS campaigns, you need to install an{' '}
            <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>SMS App</Text>
          </Text>
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
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Abandoned checkout emails</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Send an email to customers who didn't finish checking out
          </Text>
          <View style={[styles.infoBox, { backgroundColor: colors.primary + '12' }]}>
            <Feather name="info" size={15} color={colors.primary} style={{ marginTop: 2 }} />
            <Text style={[styles.infoText, { color: colors.foreground }]}>
              Abandoned checkouts settings are no longer managed here. To view or edit your automation, visit{' '}
              <Text style={{ textDecorationLine: 'underline', color: colors.primary }} onPress={haptic}>marketing automations</Text>.
            </Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Post-purchase page</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground, marginBottom: 14 }]}>
            Add tracking scripts and other customizations
          </Text>
          <Text style={[styles.groupLabel, { color: colors.foreground }]}>Use an app to add features at checkout after payment</Text>

          <RadioRow
            label="None"
            selected={postPurchaseApp === 'none'}
            onPress={() => { haptic(); setPostPurchaseApp('none'); }}
            colors={colors}
          />
          <TouchableOpacity onPress={() => { haptic(); setPostPurchaseApp('smart'); }} activeOpacity={0.7} style={styles.radioRow}>
            <View style={[styles.radioOuter, { borderColor: postPurchaseApp === 'smart' ? colors.primary : colors.border }]}>
              {postPurchaseApp === 'smart' && <View style={[styles.radioInner, { backgroundColor: colors.primary }]} />}
            </View>
            <View style={[styles.appIcon, { backgroundColor: theme.accent }]}>
              <Feather name="shopping-bag" size={12} color={theme.onAccent} />
            </View>
            <Text style={[styles.radioLabel, { color: colors.foreground }]}>SMART Checkout Rules</Text>
          </TouchableOpacity>
          {postPurchaseApp === 'smart' && (
            <Text style={[styles.hintText, { color: colors.mutedForeground, marginLeft: 30, marginBottom: 14 }]}>
              Make sure this app is set up for the post-purchase page
            </Text>
          )}

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
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.editBtn, { borderColor: colors.border }]}>
              <Text style={[styles.editBtnText, { color: colors.foreground }]}>Edit checkout content</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Advanced preferences</Text>
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.listRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <Feather name="map-pin" size={17} color={colors.foreground} style={styles.listIcon} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Address collection</Text>
                <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>Manage how you collect shipping and billing addresses</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={styles.listRow}>
              <Feather name="shopping-cart" size={17} color={colors.foreground} style={styles.listIcon} />
              <View style={{ flex: 1 }}>
                <View style={styles.rowStart}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Add-to-cart limit</Text>
                  <View style={[styles.recommendedPill, { backgroundColor: colors.secondary }]}>
                    <Text style={[styles.recommendedText, { color: colors.mutedForeground }]}>Recommended</Text>
                  </View>
                </View>
                <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>Protects your available inventory quantities from being revealed</Text>
                <View style={[styles.onPill, { backgroundColor: colors.success + '26' }]}>
                  <Text style={[styles.onPillText, { color: colors.success }]}>On</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <View style={styles.rowStart}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Checkout rules</Text>
                <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
              </View>
              <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
                Rules set parameters for how the cart or checkout responds to different customer scenarios. You can set product limits, perform age verification and more.
              </Text>
            </View>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.addRuleBtn, { borderColor: colors.border }]}>
              <Text style={[styles.addRuleText, { color: colors.foreground }]}>Add rule</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.ruleRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="globe" size={17} color={colors.foreground} style={styles.listIcon} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Cart address validation</Text>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>by Managed Markets</Text>
            </View>
            <View style={[styles.onPill, { backgroundColor: colors.success + '26' }]}>
              <Text style={[styles.onPillText, { color: colors.success }]}>Active</Text>
            </View>
            <Feather name="more-horizontal" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </ScrollView>
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 14, lineHeight: 17 },
  divider: { height: 10 },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  selectBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 12, padding: 14 },
  selectValue: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  smsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, padding: 14 },
  smsText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  hintText: { fontSize: 11, fontFamily: 'Inter_400Regular', lineHeight: 16 },
  cardTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  cardSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 3, lineHeight: 17 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  infoBox: { flexDirection: 'row', gap: 10, borderRadius: 12, padding: 14, marginTop: 4 },
  infoText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, flex: 1 },
  groupLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 10 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  radioLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },
  appIcon: { width: 20, height: 20, borderRadius: 5, alignItems: 'center', justifyContent: 'center', marginRight: -2 },
  textAreaBox: { borderWidth: 1, borderRadius: 12, marginTop: 4 },
  textArea: { fontSize: 13, fontFamily: 'Inter_400Regular', padding: 14, minHeight: 90, textAlignVertical: 'top' },
  langRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  langText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  editBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  editBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  listIcon: { width: 20, marginTop: 2 },
  recommendedPill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8 },
  recommendedText: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  onPill: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8 },
  onPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  addRuleBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  addRuleText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
});
