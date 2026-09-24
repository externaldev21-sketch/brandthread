/**
 * SaveToCollectionSheet — the "Save to…" board picker.
 *
 * Opens from a long-press on any save/bookmark button (or an explicit "Move
 * to collection" quick action). Lets the buyer file the item into an existing
 * board or spin up a new one on the spot. Saves the item first (idempotent —
 * the server no-ops if it's already saved) then files it into the chosen
 * board, so this works whether the item was already saved or not.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity,
  TouchableWithoutFeedback, View, FlatList,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, OVERLAY,
  FONT, FS, SP, RADIUS, ICON, COMP,
} from '@/lib/theme';
import { createCollection, getCollections, moveSavedItemToCollection, saveItem } from '@/services/socialService';
import { SavedCollection, SavedItemType } from '@/services/socialTypes';

export interface SaveToCollectionItem {
  type: SavedItemType;
  targetId: string;
  title: string;
  subtitle?: string;
  accentColor?: string;
  priceCents?: number;
}

interface Props {
  visible: boolean;
  item: SaveToCollectionItem | null;
  onClose: () => void;
  /** Fired after the item is filed — null means "saved to All" (no board). */
  onSaved?: (collectionId: string | null) => void;
}

export function SaveToCollectionSheet({ visible, item, onClose, onSaved }: Props) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const [collections, setCollections] = useState<SavedCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getCollections();
      setCollections([...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch { /* sheet still usable — just shows "New collection" */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (visible) { setCreating(false); setNewName(''); load(); }
  }, [visible, load]);

  async function fileInto(collectionId: string | null) {
    if (!item || busyId) return;
    setBusyId(collectionId ?? 'none');
    try {
      await saveItem({
        type: item.type,
        targetId: item.targetId,
        title: item.title,
        subtitle: item.subtitle,
        accentColor: item.accentColor,
        priceCents: item.priceCents,
        collectionId,
      });
      await moveSavedItemToCollection(item.targetId, collectionId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved?.(collectionId);
      onClose();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setBusyId('new');
    try {
      const collection = await createCollection(name);
      await fileInto(collection.id);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setBusyId(null);
    }
  }

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.md }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>Save to…</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Close">
            <Feather name="x" size={18} color={FG} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingRow}><ActivityIndicator color={theme.accent} /></View>
        ) : (
          <FlatList
            data={collections}
            keyExtractor={c => c.id}
            style={styles.list}
            ListHeaderComponent={
              <TouchableOpacity
                style={styles.row}
                onPress={() => fileInto(null)}
                disabled={!!busyId}
                activeOpacity={0.7}
              >
                <View style={[styles.rowIcon, { backgroundColor: theme.accentDim }]}>
                  <Feather name="bookmark" size={ICON.sm} color={theme.accent} />
                </View>
                <Text style={styles.rowLabel}>All Saved (no board)</Text>
                {busyId === 'none' ? <ActivityIndicator color={theme.accent} /> : null}
              </TouchableOpacity>
            }
            renderItem={({ item: c }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => fileInto(c.id)}
                disabled={!!busyId}
                activeOpacity={0.7}
              >
                <View style={[styles.rowIcon, { backgroundColor: theme.accentDim }]}>
                  <Feather name="folder" size={ICON.sm} color={theme.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.rowSubtitle}>{c.itemCount} saved{c.isPublic ? ' · Public' : ''}</Text>
                </View>
                {busyId === c.id ? <ActivityIndicator color={theme.accent} /> : null}
              </TouchableOpacity>
            )}
            ListFooterComponent={
              creating ? (
                <View style={styles.newRow}>
                  <TextInput
                    style={styles.newInput}
                    placeholder="Collection name"
                    placeholderTextColor={SUBTLE}
                    value={newName}
                    onChangeText={setNewName}
                    autoFocus
                    onSubmitEditing={handleCreate}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    style={[styles.createBtn, { backgroundColor: theme.accent }]}
                    onPress={handleCreate}
                    disabled={!newName.trim() || !!busyId}
                  >
                    {busyId === 'new' ? <ActivityIndicator color={theme.onAccent} size="small" /> : (
                      <Text style={[styles.createBtnText, { color: theme.onAccent }]}>Create</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.row} onPress={() => setCreating(true)} activeOpacity={0.7}>
                  <View style={[styles.rowIcon, { borderWidth: 1, borderColor: theme.accent, backgroundColor: 'transparent' }]}>
                    <Feather name="plus" size={ICON.sm} color={theme.accent} />
                  </View>
                  <Text style={[styles.rowLabel, { color: theme.accent, fontFamily: FONT.semibold }]}>New collection</Text>
                </TouchableOpacity>
              )
            }
          />
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: OVERLAY },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '75%',
    backgroundColor: theme.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderWidth: 1, borderColor: theme.border, paddingTop: SP.sm,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.sm },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingBottom: SP.sm,
  },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.lg },
  loadingRow: { paddingVertical: SP.xl, alignItems: 'center' },
  list: { paddingHorizontal: SP.md },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingVertical: SP.sm + 2, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: FG, fontFamily: FONT.medium, fontSize: FS.base, flex: 1 },
  rowSubtitle: { color: MUTED, fontSize: FS.xs, marginTop: 1 },
  newRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'center', paddingVertical: SP.sm },
  newInput: {
    flex: 1, height: COMP.inputH, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD, paddingHorizontal: SP.md, color: FG, fontSize: FS.base,
  },
  createBtn: { height: COMP.inputH, paddingHorizontal: SP.lg, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  createBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
