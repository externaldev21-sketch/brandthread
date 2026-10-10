/**
 * Highlights Manager — create, rename, and delete story highlights.
 * Opened from the buyer profile's highlights row ("New" → `?create=1` opens
 * the create form; tapping a highlight → `?edit=<id>` opens that highlight)
 * and from the profile menu.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Modal, Platform, Alert, Pressable,
} from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { haptics } from '@/lib/haptics';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui';
import {
  loadHighlights, createHighlight, updateHighlight, deleteHighlight,
  reorderHighlights, type Highlight,
} from '@/lib/highlightsService';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { EmptyState } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { canSyncSocialServer } from '@/services/socialService';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

const EMOJIS = ['✨', '🌟', '💜', '🎵', '🌿', '🔥', '💫', '🌙', '🎨', '🏄', '🍕', '📸', '🎉', '💙', '🌸', '🏆'];

function HLFormModal({
  visible, title, label, setLabel, emoji, setEmoji, coverColor, setCoverColor, coverColors,
  onSave, onSelectStories, onClose, s, insets, colors,
}: {
  visible: boolean; title: string;
  label: string; setLabel: (v: string) => void;
  emoji: string; setEmoji: (v: string) => void;
  coverColor: string; setCoverColor: (v: string) => void;
  coverColors: string[];
  onSave: () => void; onSelectStories?: () => void; onClose: () => void;
  s: ReturnType<typeof makeStyles>;
  insets: { bottom: number };
  colors: ReturnType<typeof useColors>;
}) {
  // Emoji grid inlines into this same sheet instead of a modal-on-modal
  // (a second Modal on top of this one won't present on iOS).
  const [emojiGridOpen, setEmojiGridOpen] = useState(false);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => setEmojiGridOpen(false)}
    >
      <ModalSafeArea>
        <View style={sheet.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={sheet.kbWrap}
          >
            <View style={[sheet.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + SPACING.md }]}>
              <View style={[sheet.handle, { backgroundColor: colors.border }]} />
              <Text style={[sheet.sheetTitle, { color: colors.foreground }]}>{title}</Text>

              {/* Emoji picker trigger */}
              <PressableScale
                style={s.emojiTrigger}
                onPress={() => { setEmojiGridOpen(v => !v); }}
                accessibilityRole="button"
                accessibilityLabel="Change highlight emoji"
              >
                <Text style={{ fontSize: 36 }}>{emoji}</Text>
                <Text style={[s.emojiHint, { color: colors.mutedForeground }]}>
                  {emojiGridOpen ? 'Choose below' : 'Tap to change'}
                </Text>
              </PressableScale>

              {emojiGridOpen && (
                <View style={s.emojiGrid}>
                  {EMOJIS.map(e => (
                    <PressableScale
                      key={e}
                      style={s.emojiBtn}
                      onPress={() => { haptics.selection(); setEmoji(e); setEmojiGridOpen(false); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Use ${e} as the emoji`}
                    >
                      <Text style={{ fontSize: 28 }}>{e}</Text>
                    </PressableScale>
                  ))}
                </View>
              )}

              {/* Label input */}
              <TextInput
                style={[s.labelInput, { borderColor: colors.primary, color: colors.foreground }]}
                value={label}
                onChangeText={setLabel}
                placeholder="Highlight name"
                placeholderTextColor={colors.mutedForeground}
                maxLength={20}
                autoFocus
              />

              {/* Cover colour */}
              <Text style={[s.colorLabel, { color: colors.mutedForeground }]}>Cover color</Text>
              <View style={s.colorRow}>
                {coverColors.map(c => (
                  <PressableScale
                    key={c}
                    noMinHeight
                    style={[s.colorSwatch, { backgroundColor: c }, coverColor === c && [s.colorSwatchActive, { borderColor: colors.foreground }]]}
                    onPress={() => { haptics.selection(); setCoverColor(c); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Use this color as the cover`}
                    accessibilityState={{ selected: coverColor === c }}
                  />
                ))}
              </View>

              {onSelectStories ? (
                <PressableScale
                  style={[s.selectStories, { borderColor: colors.border }]}
                  onPress={() => { onSelectStories(); }}
                  disabled={!label.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Select stories for this highlight"
                  testID="highlight-select-stories"
                >
                  <Feather name="image" size={18} color={colors.foreground} />
                  <Text style={[s.selectStoriesLabel, { color: colors.foreground }]}>Select stories</Text>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </PressableScale>
              ) : null}

              <View style={s.modalActions}>
                <View style={{ flex: 1 }}><Button label="Cancel" variant="secondary" onPress={onClose} fullWidth /></View>
                <View style={{ flex: 1 }}><Button label="Save" variant="primary" onPress={onSave} disabled={!label.trim()} fullWidth /></View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </ModalSafeArea>
    </Modal>
  );
}

export default function BuyerHighlightsManager() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const COVER_COLORS = [
    theme.accent, theme.accentLight,
    '#F472B6', // theme-exempt: user-selectable cover color swatch, not UI chrome
    theme.warning, theme.success, colors.destructive, theme.accentLight, theme.accent,
  ];
  const s = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Highlight | null>(null);
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('✨');
  const [coverColor, setCoverColor] = useState(COVER_COLORS[0]);

  const params = useLocalSearchParams<{ create?: string; edit?: string }>();
  // Deep-link intents from the profile's highlights row run once per mount.
  const intentHandled = useRef(false);

  const pull = usePullToRefresh(() => loadHighlights().then(setHighlights));

  useFocusEffect(useCallback(() => {
    loadHighlights().then((items) => {
      setHighlights(items);
      if (intentHandled.current) return;
      intentHandled.current = true;
      const target = params.edit ? items.find((h) => h.id === params.edit) : undefined;
      if (target) openEdit(target);
      else if (params.create === '1') openCreate();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.create, params.edit]));

  function openCreate() {
    setLabel('');
    setEmoji('✨');
    setCoverColor(COVER_COLORS[0]);
    setCreating(true);
  }

  function openEdit(h: Highlight) {
    setEditing(h);
    setLabel(h.label);
    setEmoji(h.emoji);
    setCoverColor(h.coverColor);
  }

  async function handleSaveCreate() {
    if (!label.trim()) return;
    const h = await createHighlight({ emoji, label, coverColor });
    haptics.success();
    setHighlights(prev => [...prev, h]);
    setCreating(false);
  }

  // Stories are saved server-side, so the step needs a signed-in account (or the demo preview).
  const canSelectStories = canSyncSocialServer() || isPreviewDemoMode();

  async function handleSelectStoriesCreate() {
    if (!label.trim()) return;
    const h = await createHighlight({ emoji, label, coverColor });
    haptics.success();
    setHighlights(prev => [...prev, h]);
    setCreating(false);
    router.push(`/buyer-highlight-stories?highlightId=${encodeURIComponent(h.id)}` as any);
  }

  async function handleSelectStoriesEdit() {
    if (!editing) return;
    const id = editing.id;
    await updateHighlight(id, { emoji, label, coverColor });
    setHighlights(prev => prev.map(h => h.id === id ? { ...h, emoji, label, coverColor } : h));
    setEditing(null);
    router.push(`/buyer-highlight-stories?highlightId=${encodeURIComponent(id)}` as any);
  }

  async function handleSaveEdit() {
    if (!editing) return;
    await updateHighlight(editing.id, { emoji, label, coverColor });
    haptics.success();
    setHighlights(prev => prev.map(h => h.id === editing.id ? { ...h, emoji, label, coverColor } : h));
    setEditing(null);
  }

  function confirmDelete(h: Highlight) {
    haptics.warning();
    Alert.alert(
      'Delete highlight?',
      `"${h.label}" will be removed from your profile. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteHighlight(h.id);
            setHighlights(prev => prev.filter(x => x.id !== h.id));
          },
        },
      ],
      { cancelable: true },
    );
  }

  async function moveUp(index: number) {
    if (index === 0) return;
    const next = [...highlights];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setHighlights(next);
    await reorderHighlights(next.map(h => h.id));
  }

  async function moveDown(index: number) {
    if (index >= highlights.length - 1) return;
    const next = [...highlights];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setHighlights(next);
    await reorderHighlights(next.map(h => h.id));
  }

  const renderItem = ({ item, index }: { item: Highlight; index: number }) => (
    <View style={s.row}>
      {/* Up/down reorder arrows — compact icons, hitSlop reaches the 44pt minimum without growing the row */}
      <View style={s.reorderBtns}>
        <PressableScale
          style={[s.reorderArrow, index === 0 && { opacity: 0.2 }]}
          onPress={() => moveUp(index)}
          disabled={index === 0}
          hitSlop={{ top: 6, bottom: 2, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.label} up`}
        >
          <Feather name="chevron-up" size={16} color={colors.mutedForeground} />
        </PressableScale>
        <PressableScale
          style={[s.reorderArrow, index >= highlights.length - 1 && { opacity: 0.2 }]}
          onPress={() => moveDown(index)}
          disabled={index >= highlights.length - 1}
          hitSlop={{ top: 2, bottom: 6, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.label} down`}
        >
          <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
        </PressableScale>
      </View>
      <View style={[s.circle, { backgroundColor: item.coverColor, overflow: 'hidden' }]}>
        {item.coverUrl
          ? <CachedImage source={{ uri: item.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          : <Text style={{ fontSize: 22 }}>{item.emoji}</Text>}
      </View>
      <Text style={[s.rowLabel, { color: colors.foreground }]} numberOfLines={1}>{item.label}</Text>
      <PressableScale
        style={s.editIcon}
        onPress={() => openEdit(item)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${item.label}`}
      >
        <Feather name="edit-2" size={16} color={colors.mutedForeground} />
      </PressableScale>
      <PressableScale
        style={s.deleteIcon}
        onPress={() => confirmDelete(item)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${item.label}`}
      >
        <Feather name="trash-2" size={16} color={colors.mutedForeground} />
      </PressableScale>
    </View>
  );

  return (
    <View style={s.page}>
      <ScreenHeader
        title="Highlights"
        actions={[{ icon: 'plus', onPress: openCreate, accessibilityLabel: 'New highlight' }]}
      />

      {/* Card chrome lives on a wrapper: on web, RN's RefreshControl wrapper would otherwise apply the list `style` twice (double border). */}
      <View style={{ flexGrow: 1, flexShrink: 1, backgroundColor: colors.card, borderRadius: RADII.card, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
      <FlatList
        data={highlights}
        keyExtractor={h => h.id}
        refreshControl={pull.refreshControl}
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: insets.bottom + 40 }}
        ListEmptyComponent={
          <EmptyState
            icon="bookmark"
            title="No highlights yet"
            description="Create a highlight to display it on your profile."
            action={{ label: 'Create highlight', onPress: openCreate }}
          />
        }
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />}
      />
      </View>

      <HLFormModal
        visible={creating}
        title="New highlight"
        label={label}
        setLabel={setLabel}
        emoji={emoji}
        setEmoji={setEmoji}
        coverColor={coverColor}
        setCoverColor={setCoverColor}
        coverColors={COVER_COLORS}
        onSave={handleSaveCreate}
        onSelectStories={canSelectStories ? handleSelectStoriesCreate : undefined}
        onClose={() => setCreating(false)}
        s={s}
        insets={insets}
        colors={colors}
      />
      <HLFormModal
        visible={!!editing}
        title="Edit highlight"
        label={label}
        setLabel={setLabel}
        emoji={emoji}
        setEmoji={setEmoji}
        coverColor={coverColor}
        setCoverColor={setCoverColor}
        coverColors={COVER_COLORS}
        onSave={handleSaveEdit}
        onSelectStories={canSelectStories ? handleSelectStoriesEdit : undefined}
        onClose={() => setEditing(null)}
        s={s}
        insets={insets}
        colors={colors}
      />
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: 14, gap: 10 },
  reorderBtns: { flexDirection: 'column', alignItems: 'center' },
  reorderArrow: { width: 24, height: 22, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 44, height: 44, borderRadius: RADII.avatar, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontFamily: FONT.medium, ...TYPE_SCALE.body },
  editIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  deleteIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  emojiTrigger: { alignItems: 'center', paddingVertical: SPACING.md, gap: 4 },
  emojiHint: { ...TYPE_SCALE.caption },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', paddingBottom: SPACING.md },
  emojiBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  labelInput: { borderWidth: 1, borderRadius: RADII.input, padding: SPACING.md, ...TYPE_SCALE.body, marginBottom: SPACING.md },
  colorLabel: { fontFamily: FONT.semibold, ...TYPE_SCALE.caption, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SPACING.sm },
  colorRow: { flexDirection: 'row', gap: 10, marginBottom: SPACING.lg, flexWrap: 'wrap' },
  colorSwatch: { width: 32, height: 32, borderRadius: 16 },
  colorSwatchActive: { borderWidth: 3 },
  selectStories: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: RADII.input, paddingHorizontal: SPACING.md, height: 48, marginBottom: SPACING.md },
  selectStoriesLabel: { flex: 1, fontFamily: FONT.medium, ...TYPE_SCALE.body },
  modalActions: { flexDirection: 'row', gap: SPACING.sm },
});

const sheet = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  kbWrap: { justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet, padding: SPACING.lg },
  handle: { width: 36, height: 4, borderRadius: RADII.pill, alignSelf: 'center', marginBottom: SPACING.md, opacity: 0.5 },
  sheetTitle: { fontFamily: FONT.bold, ...TYPE_SCALE.title2, marginBottom: SPACING.md },
});
