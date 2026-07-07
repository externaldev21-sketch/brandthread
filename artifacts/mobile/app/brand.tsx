import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, TextInput, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const BRAND_CHECKLIST = [
  { label: 'Brand name finalized', done: true },
  { label: 'Logo created', done: true },
  { label: 'Color palette defined', done: true },
  { label: 'Typography selected', done: true },
  { label: 'Domain connected', done: false },
  { label: 'Trademark filing started', done: false },
  { label: 'Business entity formed', done: false },
  { label: 'Social handles secured', done: true },
];

const STYLE_OPTIONS = ['Minimalist', 'Streetwear', 'Luxury', 'Sporty', 'Vintage', 'Y2K'];

export default function BrandScreen() {
  const colors = useColors();
  const router = useRouter();
  const [nameInput, setNameInput] = useState('Brandthread');
  const [selectedStyle, setSelectedStyle] = useState('Minimalist');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Brand Creation" subtitle="Build a brand identity that sells" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Brand Profile */}
      <LinearGradient colors={['#180D2E', '#0F0A1E']} style={[styles.profileCard, { borderColor: '#9F7AEA44' }]}>
        <View style={[styles.logoCircle, { borderColor: colors.primary }]}>
          <Text style={[styles.logoText, { color: colors.primary }]}>BT</Text>
        </View>
        <View>
          <Text style={[styles.brandName, { color: colors.primary }]}>Brandthread</Text>
          <Text style={[styles.brandStyle, { color: '#9F7AEA77' }]}>Minimalist · Est. 2025</Text>
        </View>
        <View style={[styles.completeBadge, { backgroundColor: '#9F7AEA22' }]}>
          <Text style={[styles.completeText, { color: colors.primary }]}>62%</Text>
        </View>
      </LinearGradient>

      {/* AI Name Generator */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Feather name="cpu" size={16} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>AI Brand Name Generator</Text>
          <View style={[styles.aiBadge, { backgroundColor: '#9F7AEA22' }]}>
            <Text style={[styles.aiText, { color: colors.primary }]}>AI</Text>
          </View>
        </View>
        <TextInput
          style={[styles.input, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
          placeholder="Describe your brand..."
          placeholderTextColor={colors.mutedForeground}
          value={nameInput}
          onChangeText={setNameInput}
        />
        <TouchableOpacity
          style={[styles.generateBtn, { backgroundColor: colors.primary }]}
          onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
          activeOpacity={0.8}
        >
          <Feather name="zap" size={16} color={colors.primaryForeground} />
          <Text style={[styles.generateText, { color: colors.primaryForeground }]}>Generate Names</Text>
        </TouchableOpacity>
        <View style={styles.suggestions}>
          {['ThreadCraft', 'Corevox', 'Moodwear', 'Rawline', 'Grainhaus'].map((name) => (
            <TouchableOpacity key={name} style={[styles.namePill, { backgroundColor: colors.secondary, borderColor: colors.border }]} activeOpacity={0.7}>
              <Text style={[styles.namePillText, { color: colors.foreground }]}>{name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Style Guide */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Feather name="sliders" size={16} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Brand Style</Text>
        </View>
        <View style={styles.styleGrid}>
          {STYLE_OPTIONS.map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setSelectedStyle(s)}
              activeOpacity={0.7}
              style={[styles.styleChip, {
                backgroundColor: selectedStyle === s ? colors.primary : colors.secondary,
                borderColor: selectedStyle === s ? colors.primary : colors.border,
              }]}
            >
              <Text style={[styles.styleText, { color: selectedStyle === s ? colors.primaryForeground : colors.mutedForeground }]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Color Palette */}
        <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>Color Palette</Text>
        <View style={styles.palette}>
          {['#0D0D0D', '#9F7AEA', '#FFFFFF', '#2A2A2A', '#A8853A'].map((c) => (
            <View key={c} style={[styles.swatch, { backgroundColor: c, borderColor: colors.border }]} />
          ))}
          <TouchableOpacity style={[styles.swatchAdd, { borderColor: colors.border }]} activeOpacity={0.7}>
            <Feather name="plus" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Typography */}
        <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>Typography</Text>
        <View style={styles.fontRow}>
          {['Inter', 'Playfair', 'Montserrat'].map((f) => (
            <View key={f} style={[styles.fontChip, { backgroundColor: f === 'Inter' ? '#9F7AEA22' : colors.secondary, borderColor: f === 'Inter' ? colors.primary : colors.border }]}>
              <Text style={[styles.fontText, { color: f === 'Inter' ? colors.primary : colors.mutedForeground }]}>{f}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Setup Checklist */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Feather name="check-square" size={16} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Business Setup</Text>
          <Text style={[styles.checklistProgress, { color: colors.mutedForeground }]}>5/8</Text>
        </View>
        {BRAND_CHECKLIST.map((item, i) => (
          <View key={item.label} style={[styles.checkRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.checkBox, { backgroundColor: item.done ? '#22C55E22' : colors.secondary, borderColor: item.done ? colors.success : colors.border }]}>
              {item.done && <Feather name="check" size={12} color={colors.success} />}
            </View>
            <Text style={[styles.checkLabel, { color: item.done ? colors.mutedForeground : colors.foreground }]}>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* Domain */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Feather name="globe" size={16} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Domain & Trademark</Text>
        </View>
        <View style={[styles.domainRow, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Text style={[styles.domainText, { color: colors.mutedForeground }]}>brandthread.com</Text>
          <View style={[styles.availBadge, { backgroundColor: '#22C55E22' }]}>
            <Text style={[styles.availText, { color: colors.success }]}>Available</Text>
          </View>
        </View>
        <TouchableOpacity style={[styles.connectBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}>
          <Text style={[styles.connectText, { color: colors.primaryForeground }]}>Connect Domain</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 20 },
  logoCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  brandName: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  brandStyle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  completeBadge: { marginLeft: 'auto', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  completeText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  cardTitle: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  aiBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  aiText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  input: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', marginBottom: 10 },
  generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, padding: 13 },
  generateText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  namePill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  namePillText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  styleChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  styleText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  subLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  palette: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  swatch: { width: 40, height: 40, borderRadius: 10, borderWidth: 1 },
  swatchAdd: { width: 40, height: 40, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },
  fontRow: { flexDirection: 'row', gap: 8 },
  fontChip: { flex: 1, paddingVertical: 9, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  fontText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 12 },
  checkBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkLabel: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  checklistProgress: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  domainRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 10 },
  domainText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  availBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  availText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  connectBtn: { borderRadius: 10, padding: 13, alignItems: 'center' },
  connectText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
