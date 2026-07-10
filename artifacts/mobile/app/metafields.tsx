import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const DEFINITIONS: { key: string; icon: keyof typeof Feather.glyphMap; label: string; count: number }[] = [
  { key: 'products', icon: 'tag', label: 'Products', count: 0 },
  { key: 'variants', icon: 'copy', label: 'Variants', count: 0 },
  { key: 'collections', icon: 'tag', label: 'Collections', count: 0 },
  { key: 'customers', icon: 'user', label: 'Customers', count: 0 },
  { key: 'orders', icon: 'inbox', label: 'Orders', count: 0 },
  { key: 'draft-orders', icon: 'edit-3', label: 'Draft orders', count: 0 },
  { key: 'companies', icon: 'briefcase', label: 'Companies', count: 0 },
  { key: 'company-locations', icon: 'map', label: 'Company locations', count: 0 },
  { key: 'locations', icon: 'map-pin', label: 'Locations', count: 0 },
  { key: 'transfers', icon: 'shuffle', label: 'Transfers', count: 0 },
  { key: 'pages', icon: 'file', label: 'Pages', count: 0 },
  { key: 'blogs', icon: 'edit-2', label: 'Blogs', count: 0 },
  { key: 'blog-posts', icon: 'edit', label: 'Blog posts', count: 0 },
  { key: 'markets', icon: 'globe', label: 'Markets', count: 0 },
  { key: 'shop', icon: 'home', label: 'Shop', count: 0 },
];

export default function MetafieldsScreen() {
  const colors = useColors();

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Metafields and metaobjects" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Metafield definitions</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Add a custom piece of data to a specific part of your store.
          </Text>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {DEFINITIONS.map((def, i) => (
              <TouchableOpacity
                key={def.key}
                onPress={haptic}
                activeOpacity={0.7}
                style={[styles.row, i !== DEFINITIONS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              >
                <Feather name={def.icon} size={17} color={colors.foreground} style={styles.rowIcon} />
                <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>{def.label}</Text>
                <Text style={[styles.countText, { color: colors.mutedForeground }]}>{def.count}</Text>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Define your first metaobject</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Metaobjects allow you to group fields and connect them to different parts of your store. Use them to create custom content or data structures.
          </Text>
          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.addBtn, { borderColor: colors.border }]}>
            <Text style={[styles.addBtnText, { color: colors.foreground }]}>Add definition</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, marginTop: 6, marginBottom: 14 },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  divider: { height: 10 },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowIcon: { width: 20 },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  countText: { fontSize: 13, fontFamily: 'Inter_500Medium', marginRight: 8 },
  addBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11, alignSelf: 'flex-start' },
  addBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
