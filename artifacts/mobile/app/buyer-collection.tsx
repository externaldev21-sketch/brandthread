/**
 * Owner-side view of a single saved collection (board).
 * Reached from the Saved screen's Collections tab. Not linked from the buyer
 * profile screen directly — that stays untouched; profile links to /buyer-saved,
 * which links here.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Alert, StyleSheet, Dimensions,
  Modal, TextInput, ActivityIndicator, Share,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import {
  CARD, BORDER, FG, MUTED, OVERLAY,
  FONT, FS, SP, RADIUS, COMP,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { getCollectionItems, updateCollection, deleteCollection, moveSavedItemToCollection } from '@/services/socialService';
import { SavedItem, SavedCollection } from '@/services/socialTypes';
import { reportNetworkError } from '@/lib/networkNotice';
import { Header } from '@/components/layout';
import { CachedImage } from '@/components/CachedImage';
import { GridSkeleton } from '@/components/layout/Skeleton';
import { EmptyState, HapticSwitch } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { formatCents } from '@/lib/money';
import { buildCanonicalCollectionUrl } from '@/lib/shareCollection';

const { width: W } = Dimensions.get('window');
const GAP = SP.sm;
const TILE_SIZE = (W - SP.md * 2 - GAP) / 2;

export default function BuyerCollection() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const { collectionId } = useLocalSearchParams<{ collectionId: string }>();

  const [collection, setCollection] = useState<SavedCollection | null>(null);
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!collectionId) return;
    setLoading(true);
    try {
      const data = await getCollectionItems(collectionId);
      setCollection(data.collection);
      setItems(data.items);
    } catch (error) {
      reportNetworkError(error, load);
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function togglePublic(value: boolean) {
    if (!collection) return;
    setCollection({ ...collection, isPublic: value });
    try {
      await updateCollection(collection.id, { isPublic: value });
    } catch {
      setCollection({ ...collection, isPublic: !value });
      Alert.alert('Couldn’t update', 'Try again.');
    }
  }

  async function handleRename() {
    if (!collection || !renameValue.trim()) return;
    setSaving(true);
    try {
      const updated = await updateCollection(collection.id, { name: renameValue.trim() });
      setCollection(updated);
      setRenameOpen(false);
    } catch {
      Alert.alert('Couldn’t rename', 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleShare() {
    if (!collection) return;
    const link = buildCanonicalCollectionUrl(collection.id);
    if (!collection.isPublic) {
      Alert.alert(
        'Make public to share?',
        'This collection is currently private. Turn it public so anyone with the link can view it.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Make public & share', onPress: async () => { await togglePublic(true); shareLink(link); } },
        ],
      );
      return;
    }
    shareLink(link);
  }

  async function shareLink(link: string) {
    try {
      await Share.share({ message: `Check out my "${collection?.name}" collection on Brandthread: ${link}`, url: link });
    } catch {
      await Clipboard.setStringAsync(link);
      Alert.alert('Link copied', link);
    }
  }

  function handleDelete() {
    if (!collection) return;
    Alert.alert('Delete collection?', 'Saved items stay in "All" — they won’t be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try { await deleteCollection(collection.id); router.back(); }
          catch { Alert.alert('Couldn’t delete', 'Try again.'); }
        },
      },
    ]);
  }

  function removeItem(item: SavedItem) {
    Alert.alert('Remove from this collection?', item.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try {
            await moveSavedItemToCollection(item.targetId, null);
            setItems(prev => prev.filter(i => i.id !== item.id));
          } catch { Alert.alert('Couldn’t remove item', 'Try again.'); }
        },
      },
    ]);
  }

  function openItem(item: SavedItem) {
    if (item.type === 'product') {
      router.push(`/thread-product-detail?productId=${encodeURIComponent(item.targetId)}&productName=${encodeURIComponent(item.title)}` as never);
    } else if (item.type === 'post') {
      router.push(`/buyer-post-viewer?postId=${encodeURIComponent(item.targetId)}` as never);
    }
  }

  function renderTile({ item }: { item: SavedItem }) {
    return (
      <TouchableOpacity
        style={styles.tile}
        onPress={() => openItem(item)}
        onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); removeItem(item); }}
        activeOpacity={0.85}
      >
        <View style={styles.tileImageWrap}>
          {item.image ? (
            <CachedImage source={{ uri: item.image }} style={styles.tileImage} />
          ) : (
            <View style={[styles.tileImage, styles.tilePlaceholder, { backgroundColor: item.accentColor || theme.accentDim }]}>
              <Feather name="shopping-bag" size={22} color={theme.accent} />
            </View>
          )}
        </View>
        <View style={styles.tileInfo}>
          {item.brand ? <Text style={styles.tileBrand} numberOfLines={1}>{item.brand}</Text> : null}
          <Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text>
          {item.priceCents != null ? <Text style={styles.tilePrice}>{formatCents(item.priceCents)}</Text> : null}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.root}>
      <Header
        title={collection?.name ?? 'Collection'}
        actions={collection ? [
          { icon: 'edit-2', onPress: () => { setRenameValue(collection.name); setRenameOpen(true); }, accessibilityLabel: 'Rename collection' },
          { icon: 'share', onPress: handleShare, accessibilityLabel: 'Share collection' },
          { icon: 'trash-2', onPress: handleDelete, accessibilityLabel: 'Delete collection' },
        ] : []}
      />

      {collection && (
        <View style={styles.publicRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.publicLabel}>Public</Text>
            <Text style={styles.publicDesc}>Anyone with the link can view this board</Text>
          </View>
          <HapticSwitch
            value={collection.isPublic}
            onValueChange={togglePublic}
            trackColor={{ false: BORDER, true: theme.accent }}
            thumbColor={theme.onAccent}
          />
        </View>
      )}

      {loading ? (
        <View style={styles.gridContent}><GridSkeleton columns={2} cardWidth={TILE_SIZE} rows={3} gap={GAP} /></View>
      ) : items.length === 0 ? (
        <EmptyState
          icon="folder"
          title="Nothing here yet"
          description="Long-press the save button on anything and add it to this collection."
          style={{ marginTop: SP.xxl }}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={styles.gridContent}
          renderItem={renderTile}
        />
      )}

      <Modal transparent animationType="fade" visible={renameOpen} onRequestClose={() => setRenameOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setRenameOpen(false)} />
        <View style={styles.centerModal}>
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>Rename collection</Text>
            <TextInput
              style={styles.input}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              onSubmitEditing={handleRename}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <Button label="Cancel" variant="tertiary" size="small" onPress={() => setRenameOpen(false)} />
              <Button
                label="Save"
                variant="primary"
                size="small"
                loading={saving}
                disabled={!renameValue.trim() || saving}
                onPress={handleRename}
                style={styles.modalSave}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  publicRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  publicLabel: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  publicDesc: { color: MUTED, fontSize: FS.xs, marginTop: 1 },
  gridContent: { paddingHorizontal: SP.md, paddingTop: SP.sm, gap: GAP, paddingBottom: SP.xxl },
  tile: { width: TILE_SIZE, marginBottom: GAP },
  tileImageWrap: { width: TILE_SIZE, aspectRatio: 1, borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  tileImage: { width: '100%', height: '100%' },
  tilePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  tileInfo: { paddingTop: SP.xs, gap: 1 },
  tileBrand: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, textTransform: 'uppercase', letterSpacing: 0.3 },
  tileTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  tilePrice: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: OVERLAY },
  centerModal: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg },
  renameCard: {
    width: '100%', backgroundColor: theme.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border,
    padding: SP.lg, gap: SP.md,
  },
  renameTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  input: {
    height: COMP.inputH, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD, paddingHorizontal: SP.md, color: FG, fontSize: FS.base,
  },
  modalActions: { flexDirection: 'row', gap: SP.sm, justifyContent: 'flex-end' },
  modalSave: { minWidth: 84 },
});
