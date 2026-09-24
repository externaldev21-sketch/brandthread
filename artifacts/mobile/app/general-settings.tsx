import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { FONT } from '@/lib/theme';

export default function GeneralSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ brandName: string | null; website: string | null } | null>(null);

  useEffect(() => {
    let active = true;
    api.seller.getProfile()
      .then((p) => { if (active) setProfile({ brandName: p.brandName, website: p.website }); })
      .catch(() => { /* keep the "add your details" empty state on failure */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const hasBusinessDetails = !!profile?.brandName;

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Store details" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Business details — bound to the real seller profile, never fabricated */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Business details</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Your brand name and website, shown on your public store
          </Text>

          {loading ? (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: 'center' }]}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : hasBusinessDetails ? (
            <TouchableOpacity
              onPress={() => { haptic(); router.push('/edit-profile' as never); }}
              activeOpacity={0.7}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{profile?.brandName}</Text>
                  {profile?.website ? (
                    <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>{profile.website}</Text>
                  ) : null}
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => { haptic(); router.push('/edit-profile' as never); }}
              activeOpacity={0.7}
              style={[styles.card, styles.rowBetween, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Add your business details</Text>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        {/* Resources — real external links, unchanged */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Resources</Text>
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ExternalRow icon="git-merge" label="Change log" onPress={() => { haptic(); Linking.openURL('https://brandthread.app/changelog'); }} colors={colors} />
            <ExternalRow icon="help-circle" label="Brandthread Help Center" onPress={() => { haptic(); Linking.openURL('https://brandthread.app/help'); }} colors={colors} />
            <ExternalRow icon="code" label="Hire a Brandthread Partner" onPress={() => { haptic(); Linking.openURL('https://brandthread.app/partners'); }} colors={colors} last />
          </View>
        </View>
      </ScrollView>
    </View>
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
      style={[styles.listRow, !last && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
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
  sectionTitle: { fontSize: 15, lineHeight: 19, fontFamily: FONT.semibold, marginBottom: 6 },
  sectionSubtitle: { fontSize: 12, fontFamily: FONT.regular, marginBottom: 14, lineHeight: 17 },
  divider: { height: 10 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardTitle: { fontSize: 14, lineHeight: 18, fontFamily: FONT.semibold },
  cardSub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 3, lineHeight: 17 },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 52 },
  listIcon: { width: 20 },
});
