/**
 * Brandthread AI Design — chat-first design agent
 * Route: /design-text-to-design
 *
 * The seller describes a garment in chat; the design renders inline. Every
 * follow-up message edits the same design iteratively (applyPromptEdit),
 * with the current version pinned at the top and full version history below.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image,
  ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { File, Paths } from 'expo-file-system';
import { useAppTheme, getOnAccentTextStyle } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { BrandthreadScreen, BrandthreadHeader } from '@/components/BrandthreadUI';
import AiComposer from '@/components/ai/AiComposer';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import {
  generateDesignFromText, applyPromptEdit, createBrandAsset,
} from '@/services/designService';

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

let seq = 0;
const uid = (prefix: string) => `${prefix}_${Date.now()}_${seq++}`;

export default function AiDesignChatScreen() {
  const { theme } = useAppTheme();
  const colors = useColors();
  const s = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [versions, setVersions] = useState<DesignVersion[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingRetryText, setPendingRetryText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const flatListRef = useRef<FlatList<ChatTurn>>(null);

  const versionById = useMemo(() => {
    const map = new Map<string, DesignVersion>();
    for (const v of versions) map.set(v.id, v);
    return map;
  }, [versions]);

  const current = currentId ? versionById.get(currentId) ?? null : null;

  const handleSend = useCallback(async (override?: string) => {
    const text = (override ?? inputText).trim();
    if (!text || isGenerating) return;

    setInputText('');
    setPendingRetryText(text);
    setIsGenerating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userTurn: ChatTurn = { id: uid('turn'), role: 'user', text };
    setTurns(prev => [...prev, userTurn]);

    try {
      const imageUri = current
        ? (await applyPromptEdit({ imageUri: current.imageUri, prompt: text })).imageUris[0]
        : (await generateDesignFromText({ prompt: text, style: 'streetwear', count: 1 })).imageUris[0];

      if (!imageUri) throw new Error('No design was returned. Please try again.');

      const version: DesignVersion = { id: uid('ver'), imageUri, prompt: text, createdAt: new Date().toISOString() };
      setVersions(prev => [...prev, version]);
      setCurrentId(version.id);
      setTurns(prev => [...prev, { id: uid('turn'), role: 'assistant', versionId: version.id }]);
    } catch (err: any) {
      const message = err?.message ?? 'Design generation failed. Please try again.';
      setTurns(prev => [...prev, { id: uid('turn'), role: 'assistant', error: message }]);
    } finally {
      setIsGenerating(false);
    }
  }, [inputText, isGenerating, current]);

  const handleRetry = useCallback(() => {
    if (pendingRetryText) handleSend(pendingRetryText);
  }, [pendingRetryText, handleSend]);

  // ── Actions on the pinned current version ──────────────────────────────────

  async function handleSave() {
    if (!current) return;
    try {
      await createBrandAsset({
        name: current.prompt.slice(0, 40) || 'AI design',
        type: 'graphic',
        uri: current.imageUri,
        tags: ['ai-generated', 'ai-design-chat'],
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Saved to Brand Assets.');
    } catch {
      Alert.alert('Save failed', 'Could not save this design. Please try again.');
    }
  }

  async function handleSendToDesignStudio() {
    if (!current) return;
    try {
      await createBrandAsset({
        name: current.prompt.slice(0, 40) || 'AI design',
        type: 'graphic',
        uri: current.imageUri,
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

  async function handleSendToMockupToModel() {
    if (!current) return;
    try {
      const b64 = current.imageUri.replace(/^data:image\/[a-z]+;base64,/, '');
      const file = new File(Paths.cache, `ai-design-${Date.now()}.png`);
      file.write(b64, { encoding: 'base64' });
      router.push({ pathname: '/design-mockup-to-model', params: { seedMockupUri: file.uri } } as any);
    } catch {
      Alert.alert('Error', 'Could not send to Mockup to Model. Please try again.');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const renderTurn = useCallback(({ item }: { item: ChatTurn }) => {
    if (item.role === 'user') {
      return (
        <View style={s.userRow}>
          <View style={[s.userBubble, { backgroundColor: theme.accent }]}>
            <Text style={[s.userText, getOnAccentTextStyle(theme)]}>{item.text}</Text>
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
      <View style={s.assistantRow}>
        <TouchableOpacity
          style={[s.designThumbWrap, isCurrent && { borderColor: theme.accent }]}
          onPress={() => setCurrentId(version.id)}
          activeOpacity={0.9}
        >
          <Image source={{ uri: version.imageUri }} style={s.designThumb} resizeMode="cover" />
          {isCurrent && (
            <View style={[s.currentBadge, { backgroundColor: theme.accent }]}>
              <Text style={[s.currentBadgeText, getOnAccentTextStyle(theme)]}>Current</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  }, [s, theme, colors, currentId, versionById, handleRetry]);

  const canSend = inputText.trim().length > 0 && !isGenerating;
  const bottomInset = Math.max(insets.bottom, 8);

  return (
    <BrandthreadScreen>
      <BrandthreadHeader title="AI Design" onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* ── Pinned current version ── */}
        {current && (
          <View style={s.pinnedCard}>
            <Image source={{ uri: current.imageUri }} style={s.pinnedThumb} resizeMode="cover" />
            <View style={{ flex: 1 }}>
              <Text style={s.pinnedLabel}>CURRENT VERSION</Text>
              <Text style={s.pinnedPrompt} numberOfLines={2}>{current.prompt}</Text>
              <View style={s.pinnedActions}>
                <TouchableOpacity style={s.pinnedActionBtn} onPress={handleSave}>
                  <Feather name="bookmark" size={ICON.xs} color={colors.text} />
                  <Text style={s.pinnedActionText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.pinnedActionBtn} onPress={handleSendToDesignStudio}>
                  <Feather name="layers" size={ICON.xs} color={colors.text} />
                  <Text style={s.pinnedActionText}>Design Studio</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.pinnedActionBtn} onPress={handleSendToMockupToModel}>
                  <Feather name="user" size={ICON.xs} color={colors.text} />
                  <Text style={s.pinnedActionText}>Mockup to Model</Text>
                </TouchableOpacity>
                {versions.length > 1 && (
                  <TouchableOpacity style={s.pinnedActionBtn} onPress={() => setShowHistory(true)}>
                    <Feather name="clock" size={ICON.xs} color={colors.text} />
                    <Text style={s.pinnedActionText}>History ({versions.length})</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        )}

        {/* ── Chat ── */}
        {turns.length === 0 ? (
          <View style={s.emptyWrap}>
            <Feather name="feather" size={28} color={theme.accent} />
            <Text style={s.emptyTitle}>Describe the design you want</Text>
            <Text style={s.emptySubtitle}>
              "A heavyweight black hoodie with a distressed chrome logo on the back" — then keep
              refining it with follow-ups like "make the logo bigger" or "try cream".
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={turns}
            keyExtractor={t => t.id}
            renderItem={renderTurn}
            contentContainerStyle={s.listContent}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            ListFooterComponent={isGenerating ? (
              <View style={s.assistantRow}>
                <View style={s.generatingCard}>
                  <ActivityIndicator size="small" color={theme.accent} />
                  <Text style={s.generatingText}>Designing…</Text>
                </View>
              </View>
            ) : null}
          />
        )}

        <AiComposer
          value={inputText}
          onChangeText={setInputText}
          onSend={() => handleSend()}
          onStop={() => {}}
          isGenerating={isGenerating}
          canSend={canSend}
          placeholder={current ? 'Describe the change…' : 'Describe your design…'}
          accentColor={theme.accent}
          bottomInset={bottomInset}
        />
      </KeyboardAvoidingView>

      {/* ── Version history ── */}
      <Modal visible={showHistory} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowHistory(false)}>
        <View style={s.historyRoot}>
          <View style={s.historyHeader}>
            <Text style={s.historyTitle}>Version history</Text>
            <TouchableOpacity onPress={() => setShowHistory(false)}>
              <Feather name="x" size={ICON.sm} color={colors.text} />
            </TouchableOpacity>
          </View>
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
        </View>
      </Modal>
    </BrandthreadScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  pinnedCard: {
    flexDirection: 'row',
    gap: SP.md,
    padding: SP.md,
    margin: SP.md,
    marginBottom: SP.sm,
    borderRadius: RADIUS.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pinnedThumb: {
    width: 72,
    height: 72,
    borderRadius: RADIUS.md,
  },
  pinnedLabel: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    color: colors.subtle,
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  pinnedPrompt: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: colors.text,
    marginBottom: SP.xs,
  },
  pinnedActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.xs,
  },
  pinnedActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SP.xs,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pinnedActionText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: colors.text,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xl,
    gap: SP.sm,
  },
  emptyTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.lg,
    color: colors.text,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: colors.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  listContent: {
    padding: SP.md,
    gap: SP.sm,
  },
  userRow: {
    alignItems: 'flex-end',
    marginBottom: SP.xs,
  },
  userBubble: {
    borderRadius: RADIUS.lg,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    maxWidth: '80%',
  },
  userText: {
    fontFamily: FONT.medium,
    fontSize: FS.base,
  },
  assistantRow: {
    alignItems: 'flex-start',
    marginBottom: SP.xs,
  },
  designThumbWrap: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  designThumb: {
    width: 220,
    height: 220,
  },
  currentBadge: {
    position: 'absolute',
    top: SP.xs,
    left: SP.xs,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
  },
  currentBadgeText: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
  },
  assistantBubble: {
    borderRadius: RADIUS.lg,
    padding: SP.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: '85%',
  },
  errorBubble: {
    gap: SP.xs,
  },
  errorText: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: colors.destructive,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  retryText: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
  generatingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    borderRadius: RADIUS.lg,
    padding: SP.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  generatingText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: colors.mutedForeground,
  },
  historyRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyTitle: {
    fontFamily: FONT.bold,
    fontSize: FS.md,
    color: colors.text,
  },
  historyCard: {
    flex: 1,
    margin: SP.xs,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  historyThumb: {
    width: '100%',
    aspectRatio: 1,
  },
  historyPrompt: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: colors.mutedForeground,
    padding: SP.xs,
  },
});
