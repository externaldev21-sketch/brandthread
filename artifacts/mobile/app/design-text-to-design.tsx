/**
 * Brandthread Design Studio — Text to Design
 * Route: /design-text-to-design
 */
import React, { useState } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Image, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard,
  GradientCard, PrimaryButton, SecondaryButton,
} from '@/components/BrandthreadUI';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE, BORDER_SUBTLE,
  FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  GARMENT_TYPES, PLACEMENT_TYPES, AI_STYLES,
  AIStyleKind, GarmentType, PlacementType,
} from '@/services/designTypes';
import {
  generateDesignFromText, GenerateDesignResult, createBrandAsset,
} from '@/services/designService';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

const { width: SW } = Dimensions.get('window');
const COL_W = (SW - SP.lg * 2 - SP.sm) / 2;

const GRAD_PALETTES: Record<number, readonly [string, string]> = {
  0: ['#8B5CF6', '#22D3EE'],
  1: ['#F97316', '#8B5CF6'],
  2: ['#22D3EE', '#3B82F6'],
  3: ['#F59E0B', '#F97316'],
};

export default function TextToDesignScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const s = createStyles(theme);
  const router = useRouter();

  // Form state
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<AIStyleKind>('streetwear');
  const [garmentType, setGarmentType] = useState<GarmentType | null>(null);
  const [placement, setPlacement] = useState<PlacementType | null>(null);
  const [colorPalette, setColorPalette] = useState('');
  const [textContent, setTextContent] = useState('');
  const [referenceUri, setReferenceUri] = useState<string | null>(null);
  const [count, setCount] = useState(4);
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<GenerateDesignResult | null>(null);

  async function pickReference() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!res.canceled && res.assets[0]) {
      setReferenceUri(res.assets[0].uri);
    }
  }

  async function saveDataUriToDevice(dataUri: string): Promise<void> {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Allow photo library access to save images.');
      return;
    }
    const b64 = dataUri.replace(/^data:image\/[a-z]+;base64,/, '');
    const file = new File(Paths.cache, `design_${Date.now()}.png`);
    file.write(b64, { encoding: 'base64' });
    await MediaLibrary.saveToLibraryAsync(file.uri);
  }

  async function handleGenerate() {
    if (!prompt.trim()) {
      Alert.alert('Describe your design', 'Please enter a prompt first.');
      return;
    }
    setIsGenerating(true);
    try {
      const result = await generateDesignFromText({
        prompt,
        style,
        garmentType,
        placement,
        colorPalette,
        textContent,
        referenceUri,
        count,
      });
      setResults(result);
    } catch (e) {
      Alert.alert('Generation failed', 'Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSaveAll() {
    if (!results) return;
    const realUris = results.imageUris.filter(u => u.startsWith('data:'));
    if (realUris.length === 0) {
      Alert.alert('Nothing to save', 'Generate designs first.');
      return;
    }
    try {
      await Promise.all(realUris.map((uri, i) =>
        createBrandAsset({
          name: `${results.prompt.slice(0, 30)} #${i + 1}`,
          type: 'graphic',
          uri,
          tags: ['ai-generated', 'text-to-design', results.style ?? ''].filter(Boolean),
        }),
      ));
      Alert.alert('Saved', `${realUris.length} design${realUris.length !== 1 ? 's' : ''} saved to Brand Assets.`);
    } catch {
      Alert.alert('Save failed', 'Could not save designs. Please try again.');
    }
  }

  // ─── Results screen ─────────────────────────────────────────────────────────
  if (results !== null) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader
          title="Your designs"
          onBack={() => setResults(null)}
        />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.resultsContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.resultsPrompt} numberOfLines={2}>"{results.prompt}"</Text>
          <View style={s.grid}>
            {results.imageUris.map((uri, idx) => (
              <View key={uri} style={s.resultCard}>
                {uri.startsWith('data:') ? (
                  <Image source={{ uri }} style={s.resultGradient} resizeMode="cover" />
                ) : (
                  <LinearGradient
                    colors={GRAD_PALETTES[idx % 4]}
                    style={s.resultGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Feather name="image" size={32} color="rgba(255,255,255,0.5)" />
                    <Text style={s.resultLabel}>Design {idx + 1}</Text>
                  </LinearGradient>
                )}
                {/* Style badge */}
                <View style={s.styleBadge}>
                  <Text style={s.styleBadgeText}>{results.style}</Text>
                </View>
                {/* Actions */}
                <View style={s.resultActions}>
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={() => {
                      if (!uri.startsWith('data:')) return;
                      createBrandAsset({ name: results!.prompt.slice(0, 40), type: 'graphic', uri, tags: ['ai-generated'] })
                        .then(() => Alert.alert('Saved', 'Saved to Brand Assets.'))
                        .catch(() => Alert.alert('Error', 'Could not save.'));
                    }}
                  >
                    <Feather name="bookmark" size={ICON.sm} color={PURPLE} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} onPress={() => Alert.alert('Try in Garment', 'Preview this design on a garment using the 3D renderer.')}>
                    <Feather name="layers" size={ICON.sm} color={CYAN} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} onPress={() => Alert.alert('Add to Product', 'Attach this design to a product listing from the product detail screen.')}>
                    <Feather name="package" size={ICON.sm} color={FG} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={async () => {
                      if (!uri.startsWith('data:')) { Alert.alert('Nothing to export', 'Generate first.'); return; }
                      try { await saveDataUriToDevice(uri); Alert.alert('Saved', 'Design saved to photo library.'); }
                      catch { Alert.alert('Export failed', 'Could not save.'); }
                    }}
                  >
                    <Feather name="download" size={ICON.sm} color={FG} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>

          <View style={s.resultsFooter}>
            <TouchableOpacity style={s.footerBtn} onPress={() => { setResults(null); setPrompt(''); }}>
              <Feather name="refresh-cw" size={ICON.sm} color={FG} />
              <Text style={s.footerBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.footerBtn} onPress={() => setResults(null)}>
              <Feather name="edit-2" size={ICON.sm} color={CYAN} />
              <Text style={[s.footerBtnText, { color: CYAN }]}>Edit prompt</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.footerBtn, { borderColor: PURPLE }]} onPress={handleSaveAll}>
              <Feather name="save" size={ICON.sm} color={PURPLE} />
              <Text style={[s.footerBtnText, { color: PURPLE }]}>Save all</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </BrandthreadScreen>
    );
  }

  // ─── Input screen ────────────────────────────────────────────────────────────
  return (
    <BrandthreadScreen>
      {isGenerating && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color={PURPLE} />
          <Text style={s.loadingText}>Generating your design…</Text>
          <Text style={s.loadingSubtext}>This takes ~3 seconds</Text>
        </View>
      )}
      <BrandthreadHeader title="Text to Design" onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.formContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Prompt */}
        <Text style={s.label}>Describe your design</Text>
        <View style={s.textAreaWrap}>
          <TextInput
            style={s.textArea}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="A bold streetwear logo with urban typography..."
            placeholderTextColor={SUBTLE}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Garment type */}
        <Text style={s.label}>Garment type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillRow}>
          {GARMENT_TYPES.map(g => (
            <TouchableOpacity
              key={g.value}
              style={[s.pill, garmentType === g.value && s.pillActive]}
              onPress={() => setGarmentType(garmentType === g.value ? null : g.value)}
            >
              <Text style={[s.pillText, garmentType === g.value && s.pillTextActive]}>
                {g.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Placement */}
        <Text style={s.label}>Placement</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillRow}>
          {PLACEMENT_TYPES.map(p => (
            <TouchableOpacity
              key={p.value}
              style={[s.pill, placement === p.value && s.pillActive]}
              onPress={() => setPlacement(placement === p.value ? null : p.value)}
            >
              <Text style={[s.pillText, placement === p.value && s.pillTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Style */}
        <Text style={s.label}>Style</Text>
        <View style={s.styleGrid}>
          {AI_STYLES.map(st => (
            <TouchableOpacity
              key={st.value}
              style={[s.styleCard, style === st.value && s.styleCardActive]}
              onPress={() => setStyle(st.value)}
            >
              <Text style={[s.styleCardText, style === st.value && s.styleCardTextActive]}>
                {st.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Color palette */}
        <Text style={s.label}>Color palette</Text>
        <View style={s.inputWrap}>
          <TextInput
            style={s.input}
            value={colorPalette}
            onChangeText={setColorPalette}
            placeholder="Black and gold, neon green..."
            placeholderTextColor={SUBTLE}
          />
        </View>

        {/* Text content */}
        <Text style={s.label}>Text to include <Text style={s.labelOptional}>(optional)</Text></Text>
        <View style={s.inputWrap}>
          <TextInput
            style={s.input}
            value={textContent}
            onChangeText={setTextContent}
            placeholder="Your brand name or slogan..."
            placeholderTextColor={SUBTLE}
          />
        </View>

        {/* Reference image */}
        <Text style={s.label}>Reference image <Text style={s.labelOptional}>(optional)</Text></Text>
        <TouchableOpacity style={s.uploadBtn} onPress={pickReference}>
          {referenceUri ? (
            <Image source={{ uri: referenceUri }} style={s.refThumb} />
          ) : (
            <>
              <Feather name="upload" size={ICON.md} color={MUTED} />
              <Text style={s.uploadBtnText}>Upload reference image</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Count stepper */}
        <Text style={s.label}>Number of results</Text>
        <View style={s.stepperRow}>
          <TouchableOpacity
            style={s.stepperBtn}
            onPress={() => setCount(Math.max(1, count - 1))}
          >
            <Feather name="minus" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={s.stepperVal}>{count}</Text>
          <TouchableOpacity
            style={s.stepperBtn}
            onPress={() => setCount(Math.min(8, count + 1))}
          >
            <Feather name="plus" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>

        {/* Generate button */}
        <GradientCard colors={theme.primaryGradient} style={[s.generateCard, { shadowColor: theme.shadowColor }]} onPress={handleGenerate}>
          <View style={s.generateInner}>
            <Feather name="zap" size={ICON.md} color="#fff" />
            <Text style={s.generateText}>Generate {count} design{count !== 1 ? 's' : ''}</Text>
          </View>
        </GradientCard>
      </ScrollView>
    </BrandthreadScreen>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT } = theme;
  return StyleSheet.create({
  formContent: {
    padding: SP.lg,
    paddingBottom: SP.xxl,
  },
  label: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
    marginBottom: SP.sm,
    marginTop: SP.lg,
  },
  labelOptional: {
    fontFamily: FONT.regular,
    color: MUTED,
    fontSize: FS.xs,
  },
  textAreaWrap: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
  },
  textArea: {
    fontFamily: FONT.regular,
    fontSize: FS.base,
    color: FG,
    padding: SP.md,
    minHeight: 100,
  },
  pillRow: {
    flexGrow: 0,
    marginBottom: SP.xs,
  },
  pill: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm - 2,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    marginRight: SP.sm,
  },
  pillActive: {
    borderColor: PURPLE,
    backgroundColor: PURPLE_DIM,
  },
  pillText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
  },
  pillTextActive: {
    color: PURPLE_LIGHT,
  },
  styleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  styleCard: {
    width: COL_W,
    paddingVertical: SP.md,
    paddingHorizontal: SP.sm,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  styleCardActive: {
    borderColor: PURPLE,
    backgroundColor: PURPLE_DIM,
  },
  styleCardText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
  },
  styleCardTextActive: {
    color: PURPLE_LIGHT,
  },
  inputWrap: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
  },
  input: {
    fontFamily: FONT.regular,
    fontSize: FS.base,
    color: FG,
    padding: SP.md,
    height: 52,
  },
  uploadBtn: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: 'dashed',
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    overflow: 'hidden',
  },
  uploadBtnText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
  },
  refThumb: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.lg,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperVal: {
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    color: FG,
    minWidth: 40,
    textAlign: 'center',
  },
  generateCard: {
    marginTop: SP.xl,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  generateInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    paddingVertical: SP.md,
  },
  generateText: {
    fontFamily: FONT.bold,
    fontSize: FS.md,
    color: '#fff',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(7,7,15,0.92)',
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.md,
  },
  loadingText: {
    fontFamily: FONT.semibold,
    fontSize: FS.lg,
    color: FG,
  },
  loadingSubtext: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
  },
  // Results
  resultsContent: {
    padding: SP.lg,
    paddingBottom: SP.xxl,
  },
  resultsPrompt: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    marginBottom: SP.lg,
    fontStyle: 'italic',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  resultCard: {
    width: COL_W,
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
  },
  resultGradient: {
    height: COL_W * 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
  },
  resultLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: 'rgba(255,255,255,0.7)',
  },
  styleBadge: {
    margin: SP.sm,
    alignSelf: 'flex-start',
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
  },
  styleBadgeText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: PURPLE_LIGHT,
  },
  resultActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: SP.sm,
    paddingBottom: SP.sm,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsFooter: {
    flexDirection: 'row',
    gap: SP.sm,
    marginTop: SP.xl,
  },
  footerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    paddingVertical: SP.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  footerBtnText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: FG,
  },
  });
};
