/**
 * Brand Creation — AI brand name ideas, AI logo generator, setup checklist
 * and domain status. Reached from More → Design Studio → Brand Creation.
 *
 * Header shows the seller's real brand (api.seller.getProfile); name ideas
 * come from POST /api/ai-helpers/brand-names (fails with a clear message when
 * AI is unavailable); the domain card reflects /api/store/domains and
 * "Connect Domain" opens the real store-domain flow.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, TextInput, Platform, Image, Alert } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FS } from '@/lib/theme';
import { AiGeneratedBadge } from '@/components/AiGeneratedBadge';
import { radius } from '@/constants/radii';
import { ApiError } from '@/lib/networkNotice';
import { apiErrorMessage } from '@/lib/freelancer';
import { createBrandAsset } from '@/services/designService';

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
  const { theme } = useAppTheme();
  const router = useRouter();
  const [nameInput, setNameInput] = useState('');
  const [suggestedNames, setSuggestedNames] = useState<string[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const api = useApi();
  const [profile, setProfile] = useState<{ name: string; logoUrl: string | null; subtitle: string | null } | null>(null);
  const [domain, setDomain] = useState<{ name: string; verified: boolean } | null | undefined>(undefined);
  const [savingLogo, setSavingLogo] = useState(false);

  // Real seller data for the header and the domain card.
  useEffect(() => {
    let cancelled = false;
    api.seller.getProfile()
      .then((p) => {
        if (cancelled) return;
        setProfile({
          name: p.brandName || p.displayName || (p.username ? `@${p.username}` : 'Your brand'),
          logoUrl: p.logoUrl || p.profileImageUrl || null,
          subtitle: [p.category, p.location].filter(Boolean).join(' · ') || null,
        });
      })
      .catch(() => { if (!cancelled) setProfile({ name: 'Your brand', logoUrl: null, subtitle: null }); });
    api.store.domains()
      .then((rows: any[]) => {
        if (cancelled) return;
        const first = Array.isArray(rows) ? rows.find((d) => d.verified) ?? rows[0] : null;
        setDomain(first ? { name: String(first.domain), verified: !!first.verified } : null);
      })
      .catch(() => { if (!cancelled) setDomain(null); });
    return () => { cancelled = true; };
  }, [api]);
  const [logoStyle, setLogoStyle] = useState('Minimalist');
  const [logoGenerating, setLogoGenerating] = useState(false);
  const [logoImages, setLogoImages] = useState<string[]>([]); // base64 strings
  const [selectedLogo, setSelectedLogo] = useState<number | null>(null);

  async function handleGenerateLogo() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLogoGenerating(true);
    setSelectedLogo(null);
    setLogoImages([]);
    try {
      // Generate 3 variations in parallel
      const settled = await Promise.allSettled([
        api.logo.generate(nameInput || 'Brand', logoStyle),
        api.logo.generate(nameInput || 'Brand', logoStyle),
        api.logo.generate(nameInput || 'Brand', logoStyle),
      ]);
      const images = settled
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map(r => r.value?.b64_json)
        .filter(Boolean);
      if (images.length === 0) {
        Alert.alert('Generation failed', 'No logos could be generated. Please try again.');
      } else {
        setLogoImages(images);
      }
    } catch (err: any) {
      Alert.alert('Generation failed', 'Please try again.');
    } finally {
      setLogoGenerating(false);
    }
  }

  const [checklist, setChecklist] = useState<boolean[]>(BRAND_CHECKLIST_ITEMS.map(() => false));

  const doneCount = checklist.filter(Boolean).length;
  const totalCount = BRAND_CHECKLIST_ITEMS.length;
  const completionPct = Math.round((doneCount / totalCount) * 100);

  function toggleCheck(i: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChecklist(prev => prev.map((v, idx) => idx === i ? !v : v));
  }

  async function handleGenerateNames() {
    const description = nameInput.trim();
    if (description.length < 2) {
      setNameError('Describe your brand in a few words first.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsGenerating(true);
    setNameError(null);
    try {
      const { names } = await api.aiHelpers.brandNames({ description, style: logoStyle });
      setSuggestedNames(names);
    } catch (err) {
      setNameError(
        err instanceof ApiError && (err.status === 503 || err.code === 'ai_unavailable')
          ? 'AI name ideas aren’t available right now. Try again later.'
          : apiErrorMessage(err, 'Couldn’t get name ideas. Try again.'),
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleUseLogo() {
    if (selectedLogo === null || !logoImages[selectedLogo]) return;
    setSavingLogo(true);
    try {
      await createBrandAsset({
        name: `${profile?.name ?? 'Brand'} logo`,
        type: 'logo',
        uri: `data:image/png;base64,${logoImages[selectedLogo]}`,
        tags: ['ai-generated', 'logo'],
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Logo saved', 'Saved to Brand Assets. To show it on your store, upload it as your store logo.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Store branding', onPress: () => router.push('/store-setup-brand' as never) },
      ]);
    } catch {
      Alert.alert('Save failed', 'Could not save this logo. Please try again.');
    } finally {
      setSavingLogo(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Brand Creation" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Brand Profile */}
      <LinearGradient colors={theme.heroGradient} style={[styles.profileCard, { borderColor: theme.accent }]}>
        <View style={[styles.logoCircle, { borderColor: colors.primary, overflow: 'hidden' }]}>
          {profile?.logoUrl ? (
            <Image source={{ uri: profile.logoUrl }} style={{ width: '100%', height: '100%' }} />
          ) : (
            <Text style={[styles.logoText, { color: colors.primary }]}>
              {(profile?.name ?? '').replace(/^@/, '').slice(0, 2).toUpperCase() || '—'}
            </Text>
          )}
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text style={[styles.brandName, { color: colors.primary }]} numberOfLines={1}>{profile?.name ?? ' '}</Text>
          {!!profile?.subtitle && (
            <Text style={[styles.brandStyle, { color: theme.accentLight }]} numberOfLines={1}>{profile.subtitle}</Text>
          )}
        </View>
        <View style={[styles.completeBadge, { backgroundColor: theme.accentDim }]}>
          <Text style={[styles.completeText, { color: colors.primary }]}>{completionPct}%</Text>
        </View>
      </LinearGradient>

      {/* AI Name Generator */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Feather name="cpu" size={16} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>AI Brand Name Generator</Text>
          <View style={[styles.aiBadge, { backgroundColor: theme.accentDim }]}>
            <Text style={[styles.aiText, { color: colors.primary }]}>AI</Text>
          </View>
        </View>
        <TextInput
          style={[styles.input, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
          placeholder="Describe your brand (e.g. minimal black tees for runners)"
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
        {!!nameError && (
          <Text style={[styles.brandStyle, { color: colors.destructive, marginTop: 10 }]}>{nameError}</Text>
        )}
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
          <View style={[styles.aiBadge, { backgroundColor: theme.accentDim }]}>
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

        {/* Generated logos */}
        {logoImages.length > 0 && (
          <>
            <Text style={[styles.subLabel, { color: colors.mutedForeground, marginTop: 16 }]}>Tap a logo to select it</Text>
            <View style={styles.logoGrid}>
              {logoImages.map((b64, i) => {
                const isSelected = selectedLogo === i;
                return (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.85}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedLogo(i); }}
                    style={[styles.logoCard, { backgroundColor: colors.card, borderColor: isSelected ? colors.primary : colors.border, borderWidth: isSelected ? 2 : 1 }]}
                  >
                    <Image
                      source={{ uri: `data:image/png;base64,${b64}` }}
                      style={styles.logoImage}
                      resizeMode="contain"
                    />
                    <AiGeneratedBadge position="topLeft" />
                    {isSelected && (
                      <View style={[styles.logoCheckBadge, { backgroundColor: colors.primary }]}>
                        <Feather name="check" size={10} color={colors.primaryForeground} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedLogo !== null && (
              <TouchableOpacity
                style={[styles.generateBtn, { backgroundColor: theme.accentDim, marginTop: 8 }]}
                activeOpacity={0.8}
                onPress={handleUseLogo}
                disabled={savingLogo}
              >
                <Feather name="download" size={15} color={colors.success} />
                <Text style={[styles.generateText, { color: colors.success }]}>{savingLogo ? 'Saving…' : 'Use this logo'}</Text>
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
              <View style={[styles.checkBox, { backgroundColor: done ? theme.accentDim : colors.secondary, borderColor: done ? colors.success : colors.border }]}>
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
          <Text style={[styles.domainText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {domain === undefined ? 'Checking…' : domain ? domain.name : 'No custom domain connected yet'}
          </Text>
          {!!domain && (
            <View style={[styles.availBadge, { backgroundColor: theme.accentDim }]}>
              <Text style={[styles.availText, { color: domain.verified ? colors.success : colors.warning }]}>
                {domain.verified ? 'Connected' : 'Pending DNS'}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={[styles.connectBtn, { backgroundColor: colors.primary }]}
          activeOpacity={0.8}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/store-domain' as never); }}
        >
          <Text style={[styles.connectText, { color: colors.primaryForeground }]}>{domain ? 'Manage Domain' : 'Connect Domain'}</Text>
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
  aiText: { fontSize: FS.xs, fontFamily: 'Inter_700Bold' },
  input: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', marginBottom: 10 },
  generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, padding: 13 },
  generateText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  namePill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1 },
  namePillText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  styleChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1 },
  styleText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  subLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  logoGrid: { flexDirection: 'row', gap: 10 },
  logoCard: { flex: 1, borderRadius: 14, overflow: 'hidden', position: 'relative' },
  logoImage: { width: '100%', aspectRatio: 1, borderRadius: 12 },
  logoCheckBadge: { position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
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
