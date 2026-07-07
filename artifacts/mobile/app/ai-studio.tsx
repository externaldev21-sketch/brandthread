import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const STUDIO_TOOLS = [
  { label: 'AI Clothing Mockups', icon: 'image' as const, desc: 'Generate photorealistic product mockups', badge: 'Popular' },
  { label: 'AI Product Photography', icon: 'camera' as const, desc: 'Studio-quality product shots without a camera', badge: null },
  { label: 'Background Removal', icon: 'scissors' as const, desc: 'Clean product cutouts in seconds', badge: null },
  { label: 'Lifestyle Images', icon: 'sun' as const, desc: 'Contextual lifestyle shots for any product', badge: null },
  { label: 'Tech Pack Generator', icon: 'file-text' as const, desc: 'Professional tech packs for manufacturers', badge: 'New' },
  { label: 'Colorway Previews', icon: 'droplet' as const, desc: 'Preview products in any color combination', badge: null },
  { label: 'Packaging Design', icon: 'package' as const, desc: 'Boxes, bags, tags & labels', badge: null },
  { label: 'Hang Tag Creator', icon: 'tag' as const, desc: 'Custom branded hangtags & labels', badge: null },
  { label: 'Lookbook Creator', icon: 'book-open' as const, desc: 'Professional brand lookbooks & catalogs', badge: null },
];

const RECENT_MOCKUPS = [
  { name: 'Classic Tee – White', color: '#E8E8E8', status: 'ready' },
  { name: 'Hoodie – Black', color: '#1A1A1A', status: 'ready' },
  { name: 'Cargo Shorts – Khaki', color: '#8A7A5C', status: 'generating' },
  { name: 'Blazer – Navy', color: '#1A2A4A', status: 'ready' },
];

export default function AIStudioScreen() {
  const colors = useColors();
  const [selected, setSelected] = useState<string | null>(null);

  const aiBadge = (
    <View style={[styles.aiBadge, { backgroundColor: '#C9A96E22', borderColor: '#C9A96E44' }]}>
      <Feather name="zap" size={12} color={colors.primary} />
      <Text style={[styles.aiText, { color: colors.primary }]}>AI</Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="AI Design Studio" subtitle="Powered by generative AI" rightElement={aiBadge} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Credits */}
      <View style={[styles.creditsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.creditItem}>
          <Text style={[styles.creditVal, { color: colors.foreground }]}>840</Text>
          <Text style={[styles.creditLabel, { color: colors.mutedForeground }]}>Credits left</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.creditItem}>
          <Text style={[styles.creditVal, { color: colors.foreground }]}>124</Text>
          <Text style={[styles.creditLabel, { color: colors.mutedForeground }]}>Generated</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.creditItem}>
          <Text style={[styles.creditVal, { color: colors.foreground }]}>18s</Text>
          <Text style={[styles.creditLabel, { color: colors.mutedForeground }]}>Avg. time</Text>
        </View>
      </View>

      {/* Tools */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Studio Tools</Text>
      {STUDIO_TOOLS.map((tool) => (
        <TouchableOpacity
          key={tool.label}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setSelected(tool.label);
          }}
          activeOpacity={0.75}
          style={[
            styles.toolRow,
            { backgroundColor: selected === tool.label ? '#1A1500' : colors.card, borderColor: selected === tool.label ? colors.primary : colors.border },
          ]}
        >
          <View style={[styles.toolIcon, { backgroundColor: selected === tool.label ? '#C9A96E22' : colors.secondary }]}>
            <Feather name={tool.icon} size={18} color={selected === tool.label ? colors.primary : colors.mutedForeground} />
          </View>
          <View style={styles.toolInfo}>
            <Text style={[styles.toolLabel, { color: colors.foreground }]}>{tool.label}</Text>
            <Text style={[styles.toolDesc, { color: colors.mutedForeground }]}>{tool.desc}</Text>
          </View>
          {tool.badge != null && (
            <View style={[styles.toolBadge, { backgroundColor: tool.badge === 'Popular' ? '#C9A96E22' : '#22C55E22' }]}>
              <Text style={[styles.toolBadgeText, { color: tool.badge === 'Popular' ? colors.primary : colors.success }]}>{tool.badge}</Text>
            </View>
          )}
          <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
        </TouchableOpacity>
      ))}

      {/* Generate CTA */}
      {selected != null && (
        <TouchableOpacity
          style={[styles.generateBtn, { backgroundColor: colors.primary }]}
          onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
          activeOpacity={0.8}
        >
          <Feather name="zap" size={16} color={colors.primaryForeground} />
          <Text style={[styles.generateText, { color: colors.primaryForeground }]}>Generate with {selected}</Text>
        </TouchableOpacity>
      )}

      {/* Recent Mockups */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Mockups</Text>
      <View style={styles.mockupsGrid}>
        {RECENT_MOCKUPS.map((m) => (
          <View key={m.name} style={[styles.mockupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.mockupPreview, { backgroundColor: m.color + '44' }]}>
              <View style={[styles.mockupDot, { backgroundColor: m.color }]} />
              {m.status === 'generating' && (
                <View style={[styles.generatingOverlay, { backgroundColor: '#00000088' }]}>
                  <Feather name="loader" size={16} color="#FFFFFF" />
                </View>
              )}
            </View>
            <Text style={[styles.mockupName, { color: colors.foreground }]} numberOfLines={2}>{m.name}</Text>
            <Text style={[styles.mockupStatus, { color: m.status === 'ready' ? colors.success : colors.warning }]}>
              {m.status === 'ready' ? 'Ready' : 'Generating...'}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  aiText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  creditsRow: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 24 },
  creditItem: { flex: 1, alignItems: 'center', gap: 3 },
  creditVal: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  creditLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  divider: { width: 1 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  toolRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 14, borderWidth: 1, marginBottom: 8, gap: 12 },
  toolIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  toolInfo: { flex: 1 },
  toolLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  toolDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  toolBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  toolBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, padding: 16, marginBottom: 28, marginTop: 8 },
  generateText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  mockupsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  mockupCard: { width: '47.5%', borderRadius: 12, borderWidth: 1, overflow: 'hidden', padding: 12 },
  mockupPreview: { height: 100, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  mockupDot: { width: 32, height: 32, borderRadius: 16 },
  generatingOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  mockupName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 3 },
  mockupStatus: { fontSize: 11, fontFamily: 'Inter_500Medium' },
});
