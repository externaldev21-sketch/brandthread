import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

export default function PlanDetailsScreen() {
  const colors = useColors();
  const router = useRouter();

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleCancelPlan() {
    haptic();
    Alert.alert(
      'Cancel plan',
      'Are you sure you want to cancel your plan? You will lose access to Basic features at the end of your billing period.',
      [
        { text: 'Keep plan', style: 'cancel' },
        { text: 'Cancel plan', style: 'destructive', onPress: () => {} },
      ]
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Plan" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Plan details</Text>
            <TouchableOpacity
              onPress={() => { haptic(); router.push('/plans' as never); }}
              activeOpacity={0.7}
              style={[styles.changeBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.changeBtnText, { color: colors.foreground }]}>Change plan</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.planNameRow}>
              <Text style={[styles.planName, { color: colors.foreground }]}>Basic</Text>
              <Text style={[styles.strikePrice, { color: colors.mutedForeground }]}>$39</Text>
            </View>
            <View style={styles.priceRow}>
              <Text style={[styles.price, { color: colors.foreground }]}>$1</Text>
              <Text style={[styles.priceSuffix, { color: colors.mutedForeground }]}>USD/month until September 7, 2026</Text>
            </View>

            <View style={[styles.ratesBox, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.ratesTitle, { color: colors.foreground }]}>Card rates</Text>
              <Text style={[styles.rateItem, { color: colors.foreground }]}>• 2.9% + $0.30 online</Text>
              <Text style={[styles.rateItem, { color: colors.foreground }]}>• 2.6% + $0.10 in person</Text>
            </View>

            <View style={styles.checkRow}>
              <Feather name="check" size={16} color={colors.primary} />
              <Text style={[styles.checkText, { color: colors.foreground }]}>Up to 77% shipping discount</Text>
            </View>

            <TouchableOpacity
              onPress={() => { haptic(); router.push('/plans' as never); }}
              activeOpacity={0.7}
              style={[styles.viewFeaturesRow, { borderTopColor: colors.border }]}
            >
              <Text style={[styles.viewFeaturesText, { color: colors.foreground }]}>View all features</Text>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.tosRow}>
          <Text style={[styles.tosText, { color: colors.mutedForeground }]}>
            View the{' '}
            <Text style={{ textDecorationLine: 'underline' }} onPress={() => Linking.openURL('https://brandthread.app/terms')}>
              terms of service
            </Text>
            {' '}and{' '}
            <Text style={{ textDecorationLine: 'underline' }} onPress={() => Linking.openURL('https://brandthread.app/privacy')}>
              privacy policy
            </Text>
          </Text>
          <TouchableOpacity
            onPress={handleCancelPlan}
            activeOpacity={0.7}
            style={[styles.cancelBtn, { borderColor: colors.destructive }]}
          >
            <Text style={[styles.cancelBtnText, { color: colors.destructive }]}>Cancel plan</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Subscriptions</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Additional items you're billed for on a recurring basis
          </Text>

          <TouchableOpacity
            onPress={() => { haptic(); router.push('/billing' as never); }}
            activeOpacity={0.7}
            style={[styles.listRow, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.listRowText, { color: colors.foreground }]}>View all subscriptions</Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4, marginBottom: 14 },
  changeBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  changeBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  card: { borderRadius: 14, borderWidth: 1, padding: 16 },
  planNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  planName: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  strikePrice: { fontSize: 14, fontFamily: 'Inter_400Regular', textDecorationLine: 'line-through' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 16 },
  price: { fontSize: 26, fontFamily: 'Inter_700Bold' },
  priceSuffix: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  ratesBox: { borderRadius: 12, padding: 14, marginBottom: 14, gap: 4 },
  ratesTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  rateItem: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  checkText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  viewFeaturesRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, paddingTop: 14,
  },
  viewFeaturesText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  divider: { height: 10, marginVertical: 4 },
  tosRow: { paddingHorizontal: 20, paddingVertical: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  tosText: { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  cancelBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  cancelBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  listRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 14, borderWidth: 1, padding: 16,
  },
  listRowText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
});
