import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, TextInput, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const BRAND_CHECKLIST_ITEMS = [
  'Brand name finalized',
  'Logo created',
  'Color palette defined',
  'Typography selected',
  'Domain connected',
  'Trademark filing started',
  'Business entity formed',
  'Social handles secured',
];

const LOGO_STYLES = ['Minimalist', 'Bold', 'Vintage', 'Luxury', 'Streetwear', 'Playful'];

type LogoConcept = { bg: string; fg: string; shape: 'circle' | 'square' | 'diamond'; style: string };

function generateLogoConcepts(brandName: string, style: string): LogoConcept[] {
  const palettes: Record<string, { bg: string; fg: string }[]> = {
    Minimalist: [{ bg: '#1A1A1A', fg: '#FFFFFF' }, { bg: '#F5F0E8', fg: '#1A1A1A' }, { bg: '#2D2D2D', fg: '#C0A060' }],
    Bold:       [{ bg: '#C94D1F', fg: '#FFFFFF' }, { bg: '#1A1A2E', fg: '#E94560' }, { bg: '#0F3460', fg: '#FFFFFF' }],
    Vintage:    [{ bg: '#8B4513', fg: '#F5DEB3' }, { bg: '#2F4F2F', fg: '#F5F5DC' }, { bg: '#4A3728', fg: '#D4AF6A' }],
    Luxury:     [{ bg: '#1A1208', fg: '#C9A96E' }, { bg: '#0D0D0D', fg: '#B8A060' }, { bg: '#1C1410', fg: '#E0C87A' }],
    Streetwear: [{ bg: '#000000', fg: '#FFFFFF' }, { bg: '#FF4500', fg: '#000000' }, { bg: '#1A1A1A', fg: '#7FFF00' }],
    Playful:    [{ bg: '#FF6B9D', fg: '#FFFFFF' }, { bg: '#4ECDC4', fg: '#1A1A1A' }, { bg: '#FFE66D', fg: '#1A1A1A' }],
  };
  const shapes: LogoConcept['shape'][] = ['circle', 'square', 'diamond'];
  const chosen = palettes[style] ?? palettes['Minimalist'];
  return chosen.map((p, i) => ({ ...p, shape: shapes[i % shapes.length], style }));
}

const NAME_PREFIXES = [
  'Thread', 'Core', 'Moon', 'Raw', 'Grain', 'Silt', 'Nova', 'Ash', 'Bare',
  'Field', 'Fable', 'Loom', 'Drift', 'Ember', 'Salt', 'Wolf', 'Cinder', 'Marsh',
  'Halo', 'Grit', 'Fern', 'Slate', 'Dune', 'Birch', 'Wren', 'Mossy', 'Void',
];
const NAME_SUFFIXES = [
  'craft', 'vox', 'wear', 'line', 'haus', 'form', 'works', 'goods', 'co',
  'field', 'thread', 'label', 'studio', 'supply', 'house', 'made', 'wood', 'stitch',
];

function generateBrandNames(count: number): string[] {
  const results = new Set<string>();
  while (results.size < count) {
    const prefix = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
    const suffix = NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)];
    const name = prefix + suffix.charAt(0).toUpperCase() + suffix.slice(1);
    if (name.toLowerCase() !== prefix.toLowerCase()) results.add(name);
  }
  return Array.from(results);
}

export default function BrandScreen() {
  const colors = useColors();
  const router = useRouter();
  const [nameInput, setNameInput] = useState('Brandthread');
  const [selectedStyle, setSelectedStyle] = useState('Minimalist');
  const [suggestedNames, setSuggestedNames] = useState<string[]>(['ThreadCraft', 'Corevox', 'Moodwear', 'Rawline', 'Grainhaus']);
  const [isGenerating, setIsGenerating] = useState(false);
  const [logoStyle, setLogoStyle] = useState('Minimalist');
  const [logoGenerating, setLogoGenerating] = useState(false);
  const [logoConcepts, setLogoConcepts] = useState<LogoConcept[]>([]);
  const [selectedLogo, setSelectedLogo] = useState<number | null>(null);

  function handleGenerateLogo() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLogoGenerating(true);
    setSelectedLogo(null);
    setTimeout(() => {
      setLogoConcepts(generateLogoConcepts(nameInput || 'Brand', logoStyle));
      setLogoGenerating(false);
    }, 1200);
  }

  const [checklist, setChecklist] = useState<boolean[]>(BRAND_CHECKLIST_ITEMS.map(() => false));

  const doneCount = checklist.filter(Boolean).length;
  const totalCount = BRAND_CHECKLIST_ITEMS.length;
  const completionPct = Math.round((doneCount / totalCount) * 100);

  function toggleCheck(i: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChecklist(prev => prev.map((v, idx) => idx === i ? !v : v));
  }

  function handleGenerateNames() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsGenerating(true);
    setTimeout(() => {
      setSuggestedNames(generateBrandNames(5));
      setIsGenerating(false);
    }, 400);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Brand Creation" subtitle="Build a brand identity that sells" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Brand Profile */}
      <LinearGradient colors={['#180D2E', '#17140F']} style={[styles.profileCard, { borderColor: '#C1440E44' }]}>
        <View style={[styles.logoCircle, { borderColor: colors.primary }]}>
          <Text style={[styles.logoText, { color: colors.primary }]}>BT</Text>
        </View>
        <View>
          <Text style={[styles.brandName, { color: colors.primary }]}>Brandthread</Text>
          <Text style={[styles.brandStyle, { color: '#C94D1F77' }]}>Minimalist · Est. 2025</Text>
        </View>
        <View style={[styles.completeBadge, { backgroundColor: '#C1440E22' }]}>
          <Text style={[styles.completeText, { color: colors.primary }]}>{completionPct}%</Text>
        </View>
      </LinearGradient>

      {/* AI Name Generator */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Feather name="cpu" size={16} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>AI Brand Name Generator</Text>
          <View style={[styles.aiBadge, { backgroundColor: '#C1440E22' }]}>
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
          style={[styles.generateBtn, { backgroundColor: colors.primary, opacity: isGenerating ? 0.7 : 1 }]}
          onPress={handleGenerateNames}
          activeOpacity={0.8}
          disabled={isGenerating}
        >
          <Feather name={isGenerating ? 'loader' : 'zap'} size={16} color={colors.primaryForeground} />
          <Text style={[styles.generateText, { color: colors.primaryForeground }]}>
            {isGenerating ? 'Generating…' : 'Generate Names'}
          </Text>
        </TouchableOpacity>
        <View style={styles.suggestions}>
          {suggestedNames.map((name) => (
            <TouchableOpacity
              key={name}
              style={[styles.namePill, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              activeOpacity={0.7}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setNameInput(name);
              }}
            >
              <Text style={[styles.namePillText, { color: colors.foreground }]}>{name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* AI Logo Generator */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Feather name="aperture" size={16} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>AI Logo Generator</Text>
          <View style={[styles.aiBadge, { backgroundColor: '#C1440E22' }]}>
            <Text style={[styles.aiText, { color: colors.primary }]}>AI</Text>
          </View>
        </View>

        {/* Style picker */}
        <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>Logo Style</Text>
        <View style={styles.styleGrid}>
          {LOGO_STYLES.map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setLogoStyle(s); }}
              activeOpacity={0.7}
              style={[styles.styleChip, {
                backgroundColor: logoStyle === s ? colors.primary : colors.secondary,
                borderColor: logoStyle === s ? colors.primary : colors.border,
              }]}
            >
              <Text style={[styles.styleText, { color: logoStyle === s ? colors.primaryForeground : colors.mutedForeground }]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Generate button */}
        <TouchableOpacity
          style={[styles.generateBtn, { backgroundColor: colors.primary, opacity: logoGenerating ? 0.7 : 1, marginTop: 4 }]}
          onPress={handleGenerateLogo}
          activeOpacity={0.85}
          disabled={logoGenerating}
        >
          <Feather name={logoGenerating ? 'loader' : 'aperture'} size={16} color={colors.primaryForeground} />
          <Text style={[styles.generateText, { color: colors.primaryForeground }]}>
            {logoGenerating ? 'Generating…' : `Generate Logo for "${nameInput || 'Your Brand'}"`}
          </Text>
        </TouchableOpacity>

        {/* Logo concepts */}
        {logoConcepts.length > 0 && (
          <>
            <Text style={[styles.subLabel, { color: colors.mutedForeground, marginTop: 16 }]}>Concepts — tap to select</Text>
            <View style={styles.logoGrid}>
              {logoConcepts.map((c, i) => {
                const initials = (nameInput || 'B').slice(0, 2).toUpperCase();
                const isSelected = selectedLogo === i;
                return (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.8}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedLogo(i); }}
                    style={[styles.logoCard, { borderColor: isSelected ? colors.primary : colors.border, borderWidth: isSelected ? 2 : 1 }]}
                  >
                    <View style={[
                      styles.logoShape,
                      { backgroundColor: c.bg, borderRadius: c.shape === 'circle' ? 36 : c.shape === 'diamond' ? 8 : 12 },
                      c.shape === 'diamond' && { transform: [{ rotate: '45deg' }] },
                    ]}>
                      <Text style={[styles.logoInitials, { color: c.fg, transform: c.shape === 'diamond' ? [{ rotate: '-45deg' }] : [] }]}>
                        {initials}
                      </Text>
                    </View>
                    <Text style={[styles.logoStyleLabel, { color: colors.mutedForeground }]}>Style {i + 1}</Text>
                    {isSelected && (
                      <View style={[styles.logoCheckBadge, { backgroundColor: colors.primary }]}>
                        <Feather name="check" size={10} color="#FFF" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedLogo !== null && (
              <TouchableOpacity
                style={[styles.generateBtn, { backgroundColor: '#4C9A5E22', marginTop: 8 }]}
                activeOpacity={0.8}
                onPress={() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)}
              >
                <Feather name="download" size={15} color={colors.success} />
                <Text style={[styles.generateText, { color: colors.success }]}>Use this logo</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* Setup Checklist */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Feather name="check-square" size={16} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Business Setup</Text>
          <Text style={[styles.checklistProgress, { color: colors.mutedForeground }]}>{doneCount}/{totalCount}</Text>
        </View>
        {BRAND_CHECKLIST_ITEMS.map((label, i) => {
          const done = checklist[i];
          return (
            <TouchableOpacity
              key={label}
              activeOpacity={0.7}
              onPress={() => toggleCheck(i)}
              style={[styles.checkRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
            >
              <View style={[styles.checkBox, { backgroundColor: done ? '#4C9A5E22' : colors.secondary, borderColor: done ? colors.success : colors.border }]}>
                {done && <Feather name="check" size={12} color={colors.success} />}
              </View>
              <Text style={[styles.checkLabel, { color: done ? colors.mutedForeground : colors.foreground }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Domain */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Feather name="globe" size={16} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Domain & Trademark</Text>
        </View>
        <View style={[styles.domainRow, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Text style={[styles.domainText, { color: colors.mutedForeground }]}>brandthread.com</Text>
          <View style={[styles.availBadge, { backgroundColor: '#4C9A5E22' }]}>
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
  logoGrid: { flexDirection: 'row', gap: 10 },
  logoCard: { flex: 1, borderRadius: 14, padding: 12, alignItems: 'center', gap: 8, position: 'relative', backgroundColor: '#0D0B08' },
  logoShape: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  logoInitials: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  logoStyleLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  logoCheckBadge: { position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
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
