/**
 * Brandthread AI Design — chat-first design agent
 * Route: /design-text-to-design
 *
 * Empty state: a grid of tappable garment silhouettes (Mobbin: Manus "Choose a
 * theme" tiles / Apple Image Playground "Suggestions"). The composer carries
 * inline chips (reference image, garment, colour, placement) instead of
 * paragraph copy (Mobbin: ElevenLabs / Manus composer chips). Results land in
 * the thread as large cards with Refine / Variation / Save actions; every
 * follow-up edits the chosen version via applyPromptEdit, with full version
 * history kept. Generation/refinement backend is unchanged.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, FlatList, ScrollView, TouchableOpacity, Pressable, StyleSheet, Image,
  ActivityIndicator, Alert, Modal, TextInput, useWindowDimensions, Dimensions,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import * as Haptics from 'expo-haptics';
import { File, Paths } from 'expo-file-system';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import Composer from '@/components/ui/Composer';
import { GarmentSilhouette, GARMENT_TILES, type SilhouetteGarment } from '@/components/design/GarmentSilhouette';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import {
  generateDesignFromText, applyPromptEdit, createBrandAsset,
} from '@/services/designService';
import type { PlacementType } from '@/services/designTypes';
import { useHideTabBar } from '@/lib/tabBarVisibility';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DesignVersion {
  id: string;
  imageUri: string;
  prompt: string;
  createdAt: string;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  versionId?: string;
  error?: string;
}

type ChipKey = 'garment' | 'colour' | 'placement';

const COLOURS = ['Black', 'White', 'Silver', 'Charcoal', 'Cream', 'Navy', 'Olive', 'Red'];
const PLACEMENTS: { key: PlacementType; label: string }[] = [
  { key: 'center_chest', label: 'Chest' },
  { key: 'left_chest', label: 'Left chest' },
  { key: 'full_front', label: 'Full front' },
  { key: 'full_back', label: 'Back' },
  { key: 'upper_back', label: 'Upper back' },
  { key: 'sleeve', label: 'Sleeve' },
  { key: 'pocket', label: 'Pocket' },
];

const GRID_GAP = 12;
const SCREEN_W_FOR_GRID = Dimensions.get('window').width;
const SCREEN_PAD = SP.md;

let seq = 0;
const uid = (prefix: string) => `${prefix}_${Date.now()}_${seq++}`;

export default function AiDesignChatScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const colors = useColors();
  const s = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { width: screenW } = useWindowDimensions();
  const cardSize = screenW - SCREEN_PAD * 2;
  const tileSize = Math.floor((screenW - SCREEN_PAD * 2 - GRID_GAP * 2) / 3);

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [versions, setVersions] = useState<DesignVersion[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingRetryText, setPendingRetryText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [garment, setGarment] = useState<SilhouetteGarment | null>(null);
  const [colour, setColour] = useState<string | null>(null);
  const [placement, setPlacement] = useState<PlacementType | null>(null);
  const [referenceUri, setReferenceUri] = useState<string | null>(null);
  const [openChip, setOpenChip] = useState<ChipKey | null>(null);
  const flatListRef = useRef<FlatList<ChatTurn>>(null);
  const inputRef = useRef<TextInput>(null);

  const versionById = useMemo(() => {
    const map = new Map<string, DesignVersion>();
    for (const v of versions) map.set(v.id, v);
    return map;
  }, [versions]);

  const current = currentId ? versionById.get(currentId) ?? null : null;

  // `base` is the version being edited; null starts a brand-new design.
  const runGeneration = useCallback(async (text: string, base: DesignVersion | null, shown = text) => {
    if (!text || isGenerating) return;

    setInputText('');
    setOpenChip(null);
    setPendingRetryText(text);
    setIsGenerating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    setTurns(prev => [...prev, { id: uid('turn'), role: 'user', text: shown }]);

    try {
      const imageUri = base
        ? (await applyPromptEdit({ imageUri: base.imageUri, prompt: text })).imageUris[0]
        : (await generateDesignFromText({
            prompt: text,
            style: 'streetwear',
            count: 1,
            garmentType: garment,
            placement,
            colorPalette: colour,
            referenceUri,
          })).imageUris[0];

      if (!imageUri) throw new Error('No design was returned. Please try again.');

      const version: DesignVersion = { id: uid('ver'), imageUri, prompt: shown, createdAt: new Date().toISOString() };
      setVersions(prev => [...prev, version]);
      setCurrentId(version.id);
      setTurns(prev => [...prev, { id: uid('turn'), role: 'assistant', versionId: version.id }]);
      if (!base) { setGarment(null); setColour(null); setPlacement(null); setReferenceUri(null); }
    } catch (err: any) {
      const message = err?.message ?? 'Design generation failed. Please try again.';
      setTurns(prev => [...prev, { id: uid('turn'), role: 'assistant', error: message }]);
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, garment, placement, colour, referenceUri]);

  const handleSend = useCallback(() => {
    void runGeneration(inputText.trim(), current);
  }, [runGeneration, inputText, current]);

  const handleRetry = useCallback(() => {
    if (pendingRetryText) void runGeneration(pendingRetryText, current);
  }, [pendingRetryText, runGeneration, current]);

  const pickReference = useCallback(async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!res.canceled && res.assets[0]) {
      setReferenceUri(res.assets[0].uri);
      setCurrentId(null);
    }
  }, []);

  const selectGarment = useCallback((key: SilhouetteGarment) => {
    Haptics.selectionAsync();
    setGarment(prev => (prev === key ? null : key));
    setCurrentId(null);
    setOpenChip(null);
    inputRef.current?.focus();
  }, []);

  // ── Actions on a result card ───────────────────────────────────────────────

  function handleRefine(version: DesignVersion) {
    setCurrentId(version.id);
    setOpenChip(null);
    inputRef.current?.focus();
  }

  function handleVariation(version: DesignVersion) {
    void runGeneration('Create a variation of this design with the same garment and concept.', version, 'Variation');
  }

  async function handleSave(version: DesignVersion) {
    try {
      await createBrandAsset({
        name: version.prompt.slice(0, 40) || 'AI design',
        type: 'graphic',
        uri: version.imageUri,
        tags: ['ai-generated', 'ai-design-chat'],
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Saved to Brand Assets.');
    } catch {
      Alert.alert('Save failed', 'Could not save this design. Please try again.');
    }
  }

  async function handleSendToDesignStudio(version: DesignVersion) {
    try {
      await createBrandAsset({
        name: version.prompt.slice(0, 40) || 'AI design',
        type: 'graphic',
        uri: version.imageUri,
        tags: ['ai-generated', 'design-layer'],
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Added to Design Studio',
        'Your design is now in Brand Assets. Open a design project and insert it as an image layer from the assets panel.',
        [
          { text: 'Open Design Studio', onPress: () => router.push('/design' as any) },
          { text: 'OK' },
        ],
      );
    } catch {
      Alert.alert('Error', 'Could not send to Design Studio. Please try again.');
    }
  }

  async function handleSendToMockupToModel(version: DesignVersion) {
    try {
      const b64 = version.imageUri.replace(/^data:image\/[a-z]+;base64,/, '');
      const file = new File(Paths.cache, `ai-design-${Date.now()}.png`);
      file.write(b64, { encoding: 'base64' });
      router.push({ pathname: '/design-mockup-to-model', params: { seedMockupUri: file.uri } } as any);
    } catch {
      Alert.alert('Error', 'Could not send to Mockup to Model. Please try again.');
    }
  }

  // ── Composer chips ─────────────────────────────────────────────────────────

  const garmentLabel = GARMENT_TILES.find(g => g.key === garment)?.label ?? null;
  const placementLabel = PLACEMENTS.find(p => p.key === placement)?.label ?? null;

  const chip = (key: ChipKey, label: string, value: string | null, onClear: () => void) => {
    const active = value != null;
    return (
      <Pressable
        key={key}
        onPress={() => setOpenChip(prev => (prev === key ? null : key))}
        style={[s.chip, active && s.chipActive, openChip === key && s.chipOpen]}
        accessibilityRole="button"
        accessibilityLabel={active ? `${label}: ${value}` : label}
        testID={`ai-design-chip-${key}`}
      >
        <Text style={[s.chipText, active && s.chipTextActive]} numberOfLines={1}>{value ?? label}</Text>
        {active ? (
          <Pressable hitSlop={8} onPress={onClear} accessibilityLabel={`Clear ${label}`}>
            <Feather name="x" size={13} color={colors.background} />
          </Pressable>
        ) : (
          <Feather name="chevron-down" size={13} color={colors.text} />
        )}
      </Pressable>
    );
  };

  const optionRow = openChip ? (
    <View style={s.optionRow}>
      {(openChip === 'garment'
        ? GARMENT_TILES.map(g => ({ id: g.key as string, label: g.label, selected: garment === g.key, onPress: () => { setGarment(g.key); setOpenChip(null); } }))
        : openChip === 'colour'
          ? COLOURS.map(c => ({ id: c, label: c, selected: colour === c, onPress: () => { setColour(c); setOpenChip(null); } }))
          : PLACEMENTS.map(p => ({ id: p.key as string, label: p.label, selected: placement === p.key, onPress: () => { setPlacement(p.key); setOpenChip(null); } }))
      ).map(o => (
        <Pressable key={o.id} onPress={o.onPress} style={[s.option, o.selected && s.optionSelected]} accessibilityRole="button" accessibilityLabel={o.label}>
          <Text style={[s.optionText, o.selected && s.optionTextSelected]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  ) : null;

  const topSlot = (
    <View style={s.topSlot}>
      {optionRow}
      <View style={s.chipRow}>
        {current ? (
          <Pressable
            onPress={() => setCurrentId(null)}
            style={[s.chip, s.chipActive, s.refineChip]}
            accessibilityRole="button"
            accessibilityLabel="Stop refining and start a new design"
            testID="ai-design-chip-refining"
          >
            <Image source={{ uri: current.imageUri }} style={s.refineThumb} />
            <Text style={[s.chipText, s.chipTextActive]}>Refining</Text>
            <Feather name="x" size={13} color={colors.background} />
          </Pressable>
        ) : (
          <>
            {referenceUri ? (
              <Pressable
                onPress={() => setReferenceUri(null)}
                style={[s.chip, s.chipActive, s.refineChip]}
                accessibilityRole="button"
                accessibilityLabel="Remove reference image"
                testID="ai-design-chip-reference"
              >
                <Image source={{ uri: referenceUri }} style={s.refineThumb} />
                <Text style={[s.chipText, s.chipTextActive]}>Reference</Text>
                <Feather name="x" size={13} color={colors.background} />
              </Pressable>
            ) : null}
            {chip('garment', 'Garment', garmentLabel, () => setGarment(null))}
            {chip('colour', 'Colour', colour, () => setColour(null))}
            {chip('placement', 'Placement', placementLabel, () => setPlacement(null))}
          </>
        )}
      </View>
    </View>
  );

  // ── Render ───────────────────────────────────────────────────────────────

  const renderTurn = useCallback(({ item }: { item: ChatTurn }) => {
    if (item.role === 'user') {
      return (
        <View style={s.userRow}>
          <View style={[s.userBubble, { backgroundColor: theme.accent }]}>
            <Text style={[s.userText, { color: theme.onAccent }]}>{item.text}</Text>
          </View>
        </View>
      );
    }

    if (item.error) {
      return (
        <View style={s.assistantRow}>
          <View style={[s.assistantBubble, s.errorBubble]}>
            <Feather name="alert-circle" size={14} color={colors.destructive} />
            <Text style={s.errorText}>{item.error}</Text>
            <TouchableOpacity onPress={handleRetry} style={s.retryBtn}>
              <Feather name="refresh-cw" size={12} color={theme.accent} />
              <Text style={[s.retryText, { color: theme.accent }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    const version = item.versionId ? versionById.get(item.versionId) : null;
    if (!version) return null;
    const isCurrent = version.id === currentId;

    return (
      <View style={s.resultCard} testID="ai-design-result-card">
        <TouchableOpacity activeOpacity={0.92} onPress={() => setCurrentId(version.id)}>
          <Image
            source={{ uri: version.imageUri }}
            style={[s.resultImage, { width: cardSize, height: cardSize }, isCurrent && { borderColor: theme.accent }]}
            resizeMode="cover"
          />
        </TouchableOpacity>
        <View style={s.actionGrid}>
          <ActionPill icon="edit-3" label="Refine" primary onPress={() => handleRefine(version)} s={s} colors={colors} testID="ai-design-refine" />
          <ActionPill icon="shuffle" label="Variation" onPress={() => handleVariation(version)} s={s} colors={colors} testID="ai-design-variation" disabled={isGenerating} />
          <ActionPill icon="bookmark" label="Save" onPress={() => handleSave(version)} s={s} colors={colors} testID="ai-design-save" />
          <ActionPill icon="layers" label="Studio" onPress={() => handleSendToDesignStudio(version)} s={s} colors={colors} testID="ai-design-studio" />
          <ActionPill icon="user" label="Model" onPress={() => handleSendToMockupToModel(version)} s={s} colors={colors} testID="ai-design-model" />
          <ActionPill icon="clock" label="History" onPress={() => setShowHistory(true)} s={s} colors={colors} testID="ai-design-history" />
        </View>
      </View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, theme, colors, currentId, versionById, handleRetry, cardSize, isGenerating]);

  return (
    <View style={s.root}>
      <ScreenHeader title="AI Design" onBack={() => goBackOr(router)} divider={false} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {turns.length === 0 ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.gridContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={s.sectionLabel}>Garment</Text>
            <View style={s.grid}>
              {GARMENT_TILES.map(g => {
                const selected = garment === g.key;
                return (
                  <Pressable
                    key={g.key}
                    onPress={() => selectGarment(g.key)}
                    style={[s.tile, { width: tileSize }, selected && s.tileSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={g.label}
                    testID={`ai-design-tile-${g.key}`}
                  >
                    <View style={[s.tileArt, { height: tileSize - 28 }]}>
                      <GarmentSilhouette garment={g.key} size={Math.round((tileSize - 28) * 0.86)} />
                    </View>
                    <Text style={[s.tileLabel, selected && { color: colors.text }]} numberOfLines={1}>{g.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        ) : (
          <FlatList
            ref={flatListRef}
            data={turns}
            keyExtractor={t => t.id}
            renderItem={renderTurn}
            style={{ flex: 1 }}
            contentContainerStyle={s.listContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            ListFooterComponent={isGenerating ? (
              <View style={[s.generatingCard, { width: cardSize, height: cardSize }]}>
                <ActivityIndicator size="small" color={theme.accent} />
                <Text style={s.generatingText}>Designing…</Text>
              </View>
            ) : null}
          />
        )}

        <Composer
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          busy={false}
          canSend={inputText.trim().length > 0 && !isGenerating}
          editable={!isGenerating}
          inputRef={inputRef}
          placeholder={current ? 'Describe the change…' : 'Describe your design…'}
          accessibilityLabel="Describe your design"
          testID="ai-design-composer"
          topSlot={topSlot}
          leftAccessory={current ? undefined : (
            <Pressable
              onPress={pickReference}
              style={s.plusBtn}
              accessibilityRole="button"
              accessibilityLabel="Attach reference image"
              testID="ai-design-attach"
            >
              <Feather name="plus" size={20} color={colors.text} />
            </Pressable>
          )}
        />
      </KeyboardAvoidingView>

      {/* ── Version history ── */}
      <Modal visible={showHistory} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowHistory(false)}>
        <SafeAreaProvider style={s.historyRoot}>
          <ScreenHeader title="Version history" variant="modal" onBack={() => setShowHistory(false)} />
          <FlatList
            data={[...versions].reverse()}
            keyExtractor={v => v.id}
            numColumns={2}
            contentContainerStyle={{ padding: SP.md }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[s.historyCard, item.id === currentId && { borderColor: theme.accent }]}
                onPress={() => { setCurrentId(item.id); setShowHistory(false); }}
                activeOpacity={0.85}
              >
                <Image source={{ uri: item.imageUri }} style={s.historyThumb} resizeMode="cover" />
                <Text style={s.historyPrompt} numberOfLines={2}>{item.prompt}</Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

function ActionPill({ icon, label, onPress, primary, disabled, s, colors, testID }: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  s: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useColors>;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[s.actionPill, primary && s.actionPillPrimary, disabled && { opacity: 0.4 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Feather name={icon} size={15} color={primary ? colors.background : colors.text} />
      <Text style={[s.actionText, primary && { color: colors.background }]}>{label}</Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  gridContent: { paddingHorizontal: SCREEN_PAD, paddingTop: SP.md, paddingBottom: SP.md },
  sectionLabel: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: colors.text,
    marginBottom: SP.sm + 2,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  tile: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 8,
  },
  tileSelected: { borderColor: colors.text, borderWidth: 2, paddingTop: 5, paddingBottom: 7 },
  tileArt: { alignItems: 'center', justifyContent: 'center' },
  tileLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: colors.mutedForeground,
    marginTop: 4,
  },
  topSlot: { gap: SP.sm, paddingBottom: SP.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, alignItems: 'center' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipOpen: { borderColor: colors.text },
  chipText: { fontFamily: FONT.medium, fontSize: FS.sm, color: colors.text },
  chipTextActive: { color: colors.background },
  refineChip: { paddingLeft: 4 },
  refineThumb: { width: 24, height: 24, borderRadius: 12 },
  option: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  optionSelected: { backgroundColor: colors.text, borderColor: colors.text },
  optionText: { fontFamily: FONT.medium, fontSize: FS.sm, color: colors.text },
  optionTextSelected: { color: colors.background },
  plusBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  listContent: { padding: SCREEN_PAD, gap: SP.md },
  userRow: { alignItems: 'flex-end' },
  userBubble: {
    borderRadius: RADIUS.lg,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    maxWidth: '80%',
  },
  userText: { fontFamily: FONT.medium, fontSize: FS.base },
  assistantRow: { alignItems: 'flex-start' },
  resultCard: { gap: SP.sm + 2 },
  resultImage: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  // 3×2 grid: six equal-size buttons, icon + label centred together.
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    width: (SCREEN_W_FOR_GRID - SCREEN_PAD * 2 - SP.sm * 2) / 3,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  actionPillPrimary: { backgroundColor: colors.text, borderColor: colors.text },
  actionText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: colors.text },
  assistantBubble: {
    borderRadius: RADIUS.lg,
    padding: SP.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: '85%',
  },
  errorBubble: { gap: SP.xs },
  errorText: { fontFamily: FONT.regular, fontSize: FS.sm, color: colors.destructive },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  retryText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  generatingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  generatingText: { fontFamily: FONT.medium, fontSize: FS.sm, color: colors.mutedForeground },
  historyRoot: { flex: 1, backgroundColor: colors.background },
  historyCard: {
    flex: 1,
    margin: SP.xs,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  historyThumb: { width: '100%', aspectRatio: 1 },
  historyPrompt: { fontFamily: FONT.regular, fontSize: FS.xs, color: colors.mutedForeground, padding: SP.xs },
});
