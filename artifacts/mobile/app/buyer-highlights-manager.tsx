/**
 * Highlights Manager — create, rename, and delete story highlights.
 * Accessible from the profile highlights row via long-press or "New" button.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  SUCCESS, RED, ORANGE, GOLD,
  FONT, FS, SP, RADIUS, OVERLAY,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  loadHighlights, createHighlight, updateHighlight, deleteHighlight,
  reorderHighlights, type Highlight,
} from '@/lib/highlightsService';

function EmojiPicker({ visible, onSelect, onClose }: {
  visible: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const EMOJIS = ['✨', '🌟', '💜', '🎵', '🌿', '🔥', '💫', '🌙', '🎨', '🏄', '🍕', '📸', '🎉', '💙', '🌸', '🏆'];
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={sheet.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[sheet.sheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={sheet.handle} />
          <Text style={sheet.sheetTitle}>Choose an emoji</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', paddingHorizontal: SP.md }}>
            {EMOJIS.map(e => (
              <TouchableOpacity key={e} style={sheet.emojiBtn} onPress={() => { onSelect(e); onClose(); }}>
                <Text style={{ fontSize: 32 }}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export default function BuyerHighlightsManager() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const CYAN = theme.accentLight;
  const COVER_COLORS = [PURPLE, CYAN, '#F472B6', ORANGE, SUCCESS, RED, PURPLE_LIGHT, GOLD];
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Highlight | null>(null);
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('✨');
  const [coverColor, setCoverColor] = useState(COVER_COLORS[0]);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    loadHighlights().then(setHighlights);
  }, []));

  function openCreate() {
    Haptics.selectionAsync();
    setLabel('');
    setEmoji('✨');
    setCoverColor(COVER_COLORS[0]);
    setCreating(true);
  }

  function openEdit(h: Highlight) {
    Haptics.selectionAsync();
    setEditing(h);
    setLabel(h.label);
    setEmoji(h.emoji);
    setCoverColor(h.coverColor);
  }

  async function handleSaveCreate() {
    if (!label.trim()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const h = await createHighlight({ emoji, label, coverColor });
    setHighlights(prev => [...prev, h]);
    setCreating(false);
  }

  async function handleSaveEdit() {
    if (!editing) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await updateHighlight(editing.id, { emoji, label, coverColor });
    setHighlights(prev => prev.map(h => h.id === editing.id ? { ...h, emoji, label, coverColor } : h));
    setEditing(null);
  }

  async function handleDelete(h: Highlight) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await deleteHighlight(h.id);
    setHighlights(prev => prev.filter(x => x.id !== h.id));
  }

  async function moveUp(index: number) {
    if (index === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = [...highlights];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setHighlights(next);
    await reorderHighlights(next.map(h => h.id));
  }

  async function moveDown(index: number) {
    if (index >= highlights.length - 1) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = [...highlights];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setHighlights(next);
    await reorderHighlights(next.map(h => h.id));
  }

  const renderItem = ({ item, index }: { item: Highlight; index: number }) => (
    <View style={s.row}>
      {/* Up/down reorder arrows */}
      <View style={s.reorderBtns}>
        <TouchableOpacity
          style={[s.reorderArrow, index === 0 && { opacity: 0.2 }]}
          onPress={() => moveUp(index)}
          disabled={index === 0}
        >
          <Feather name="chevron-up" size={16} color={MUTED} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.reorderArrow, index >= highlights.length - 1 && { opacity: 0.2 }]}
          onPress={() => moveDown(index)}
          disabled={index >= highlights.length - 1}
        >
          <Feather name="chevron-down" size={16} color={MUTED} />
        </TouchableOpacity>
      </View>
      <View style={[s.circle, { backgroundColor: item.coverColor }]}>
        <Text style={{ fontSize: 22 }}>{item.emoji}</Text>
      </View>
      <Text style={s.rowLabel}>{item.label}</Text>
      <TouchableOpacity style={s.editIcon} onPress={() => openEdit(item)}>
        <Feather name="edit-2" size={16} color={MUTED} />
      </TouchableOpacity>
      <TouchableOpacity style={s.deleteIcon} onPress={() => handleDelete(item)}>
        <Feather name="trash-2" size={16} color={MUTED} />
      </TouchableOpacity>
    </View>
  );

  function HLFormModal({ visible, title, onSave, onClose }: {
    visible: boolean; title: string;
    onSave: () => void; onClose: () => void;
  }) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <TouchableOpacity style={sheet.backdrop} activeOpacity={1} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={[sheet.sheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={sheet.handle} />
            <Text style={sheet.sheetTitle}>{title}</Text>
            {/* Emoji picker trigger */}
            <TouchableOpacity style={s.emojiTrigger} onPress={() => setEmojiPickerOpen(true)}>
              <Text style={{ fontSize: 36 }}>{emoji}</Text>
              <Text style={s.emojiHint}>Tap to change</Text>
            </TouchableOpacity>
            {/* Label input */}
            <TextInput
              style={s.labelInput}
              value={label}
              onChangeText={setLabel}
              placeholder="Highlight name"
              placeholderTextColor={SUBTLE}
              maxLength={20}
              autoFocus
            />
            {/* Cover colour */}
            <Text style={s.colorLabel}>Cover colour</Text>
            <View style={s.colorRow}>
              {COVER_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[s.colorSwatch, { backgroundColor: c }, coverColor === c && s.colorSwatchActive]}
                  onPress={() => setCoverColor(c)}
                />
              ))}
            </View>
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, !label.trim() && { opacity: 0.4 }]}
                onPress={onSave}
                disabled={!label.trim()}
              >
                <Text style={s.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    );
  }

  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Story Highlights</Text>
        <TouchableOpacity style={s.iconBtn} onPress={openCreate}>
          <Feather name="plus" size={22} color={PURPLE} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={highlights}
        keyExtractor={h => h.id}
        contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="bookmark" size={36} color={MUTED} />
            <Text style={s.emptyTitle}>No highlights yet</Text>
            <Text style={s.emptySub}>Create a highlight to display it on your profile.</Text>
            <TouchableOpacity style={s.createBtn} onPress={openCreate}>
              <Text style={s.createBtnText}>Create highlight</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: BORDER }} />}
        style={{ backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' }}
      />

      <HLFormModal
        visible={creating}
        title="New Highlight"
        onSave={handleSaveCreate}
        onClose={() => setCreating(false)}
      />
      <HLFormModal
        visible={!!editing}
        title="Edit Highlight"
        onSave={handleSaveEdit}
        onClose={() => setEditing(null)}
      />
      <EmojiPicker
        visible={emojiPickerOpen}
        onSelect={setEmoji}
        onClose={() => setEmojiPickerOpen(false)}
      />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 14, gap: 10 },
  reorderBtns: { flexDirection: 'column', alignItems: 'center' },
  reorderArrow: { width: 24, height: 22, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  editIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  deleteIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingTop: 80, gap: SP.md },
  emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.lg, color: FG },
  emptySub: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', paddingHorizontal: SP.xl },
  createBtn: { paddingHorizontal: SP.xl, paddingVertical: SP.md, borderRadius: RADIUS.pill, backgroundColor: theme.accent },
   createBtnText: { fontFamily: FONT.bold, fontSize: FS.base, color: theme.onAccent },
  emojiTrigger: { alignItems: 'center', paddingVertical: SP.md, gap: 4 },
  emojiHint: { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE },
  labelInput: { borderWidth: 1, borderColor: theme.accent, borderRadius: RADIUS.md, padding: SP.md, color: FG, fontFamily: FONT.regular, fontSize: FS.base, marginBottom: SP.md },
  colorLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SP.sm },
  colorRow: { flexDirection: 'row', gap: 10, marginBottom: SP.lg },
  colorSwatch: { width: 32, height: 32, borderRadius: 16 },
  colorSwatchActive: { borderWidth: 3, borderColor: FG },
  modalActions: { flexDirection: 'row', gap: SP.sm },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  cancelBtnText: { fontFamily: FONT.medium, fontSize: FS.base, color: MUTED },
  saveBtn: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.md, backgroundColor: theme.accent, alignItems: 'center' },
   saveBtnText: { fontFamily: FONT.bold, fontSize: FS.base, color: theme.onAccent },
});

const sheet = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  sheet: { backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SP.lg },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.md },
  sheetTitle: { fontFamily: FONT.bold, fontSize: FS.lg, color: FG, marginBottom: SP.md },
  emojiBtn: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
});
