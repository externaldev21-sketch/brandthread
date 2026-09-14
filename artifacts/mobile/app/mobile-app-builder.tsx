import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';

const FEATURES = [
  { icon: 'layout' as const, title: 'Drag-and-drop screens', desc: 'Build your own branded shopping app without code' },
  { icon: 'bell' as const, title: 'Push notifications', desc: 'Reach customers directly on their home screen' },
  { icon: 'credit-card' as const, title: 'Native checkout', desc: 'Same Brandthread Payments, packaged as your app' },
  { icon: 'upload-cloud' as const, title: 'One-tap publishing', desc: 'Ship updates to the App Store & Google Play instantly' },
];

export default function MobileAppBuilderScreen() {
  const colors = useColors();
  const isDark = colors.background === '#121110' || colors.background.startsWith('#0');
  const primary = colors.primary;

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Mobile App Builder" subtitle="Your brand, as a native app" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.heroTop}>
            <View style={[styles.heroIcon, { backgroundColor: primary + '22' }]}>
              <Feather name="smartphone" size={22} color={primary} />
            </View>
            <Badge label="Pro" variant="gold" />
          </View>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>Launch your own app</Text>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
            Turn your storefront into a fully branded iOS & Android app — no code required.
          </Text>
          <TouchableOpacity style={[styles.ctaBtn, { backgroundColor: primary }]} activeOpacity={0.85}>
            <Feather name="zap" size={15} color={colors.primaryForeground} />
            <Text style={styles.ctaText}>Start building</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>What's included</Text>
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {FEATURES.map((f, i) => (
            <View key={f.title} style={[styles.featureRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={[styles.featureIcon, { backgroundColor: colors.secondary }]}>
                <Feather name={f.icon} size={16} color={primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.featureTitle, { color: colors.foreground }]}>{f.title}</Text>
                <Text style={[styles.featureDesc, { color: colors.mutedForeground }]}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  heroCard: { borderRadius: 18, borderWidth: 1, padding: 20, marginBottom: 28, gap: 10 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', marginTop: 4 },
  heroSub: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 13, marginTop: 6 },
  ctaText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#03150B' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  section: { borderRadius: 14, borderWidth: 1 },
  featureRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  featureIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  featureTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  featureDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
});
