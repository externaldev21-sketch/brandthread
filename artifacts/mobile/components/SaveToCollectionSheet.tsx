/**
 * SaveToCollectionSheet — TikTok-style "Save to…" collection picker.
 *
 * Two states: the picker (All Saved + existing collections + "New collection")
 * and a separate "New collection" form (centered header/X, Name with live
 * 0/30 counter, Make public toggle + explanation, full-width Save).
 *
 * Saves the item first (idempotent server-side), then files it into the board.
 * Every async step is bound to the Clerk user that started it, so switching
 * accounts mid-flight cannot file an old item into the new account.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@clerk/expo';

import { Icon } from '@/components/ui/Icon';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { Sheet } from '@/components/ui/BottomSheet';
import { hapticError } from '@/lib/haptics';
import { BORDER, FG, MUTED, SUBTLE, FONT, FS, SP, RADIUS, ICON, COMP } from '@/lib/theme';
import { createCollection, getCollections, moveSavedItemToCollection, saveItem } from '@/services/socialService';
import { SavedCollection, SavedItemType } from '@/services/socialTypes';

export const COLLECTION_NAME_MAX = 30;

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
  /** Fired after the item is filed — null means "saved to All" (no board). The board's name is passed when known. */
  onSaved?: (collectionId: string | null, collectionName?: string) => void;
}


export class StaleAccountError extends Error {
  constructor() { super('Account changed'); this.name = 'StaleAccountError'; }
}

/** Pure orchestration: save → file. `isCurrent` is checked after each await. */
export async function fileItemInto(
  item: SaveToCollectionItem,
  collectionId: string | null,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) throw new StaleAccountError();
  await saveItem({
    type: item.type, targetId: item.targetId, title: item.title, subtitle: item.subtitle,
    accentColor: item.accentColor, priceCents: item.priceCents, collectionId,
  });
  if (!isCurrent()) throw new StaleAccountError();
  await moveSavedItemToCollection(item.targetId, collectionId);
  if (!isCurrent()) throw new StaleAccountError();
}

/**
 * Pure orchestration: create (atomically with visibility) → file.
 * Pass `existing` (created by an earlier attempt) to resume filing without
 * creating a duplicate. `onCreated` fires as soon as the collection exists.
 */
export async function createAndFile(
  item: SaveToCollectionItem,
  rawName: string,
  isPublic: boolean,
  isCurrent: () => boolean,
  existing?: SavedCollection | null,
  onCreated?: (collection: SavedCollection) => void,
): Promise<SavedCollection> {
  let collection = existing ?? null;
  if (!collection) {
    const name = rawName.trim().slice(0, COLLECTION_NAME_MAX);
    if (!name) throw new Error('Name required');
    if (!isCurrent()) throw new StaleAccountError();
    collection = await createCollection(name, { isPublic });
    if (!isCurrent()) throw new StaleAccountError();
    onCreated?.(collection);
  }
  await fileItemInto(item, collection.id, isCurrent);
  return collection;
}

export function SaveToCollectionSheet({ visible, item, onClose, onSaved }: Props) {
  const styles = makeStyles();
  const { userId, isSignedIn } = useAuth();
  const userRef = useRef<string | null | undefined>(userId);
  userRef.current = isSignedIn ? userId : null;

  const [collections, setCollections] = useState<SavedCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<(() => void) | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  // Collection created by a previous attempt whose filing failed — reused on retry.
  const [pendingCreated, setPendingCreated] = useState<SavedCollection | null>(null);
  const pendingRef = useRef<SavedCollection | null>(null);
  const pendingOwnerRef = useRef<string | null | undefined>(null);

  const bindAccount = useCallback(() => {
    const owner = userRef.current;
    return () => !!owner && userRef.current === owner;
  }, []);

  const load = useCallback(async () => {
    if (!userRef.current) { setLoading(false); setCollections([]); return; }
    const isCurrent = bindAccount();
    setLoading(true); setLoadError(false);
    try {
      const rows = await getCollections();
      if (!isCurrent()) return;
      setCollections([...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch {
      if (isCurrent()) setLoadError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [bindAccount]);

  useEffect(() => {
    if (visible) {
      setCreating(false); setNewName(''); setIsPublic(false); setError(null); setLastAction(null);
      pendingRef.current = null; pendingOwnerRef.current = null; setPendingCreated(null);
      load();
    }
  }, [visible, load, userId]);

  function fail(retry: () => void, err: unknown) {
    hapticError();
    if (err instanceof StaleAccountError) {
      setError('You switched accounts. Check the previous account for this save.');
      setLastAction(null);
    } else {
      setError("Couldn't save. Check your connection and try again.");
      setLastAction(() => retry);
    }
  }

  async function fileInto(collectionId: string | null) {
    if (!item || busyRef.current) return;
    if (!userRef.current) { setError('Sign in to save to collections.'); setLastAction(null); return; }
    busyRef.current = true;
    setBusyId(collectionId ?? 'none'); setError(null);
    const isCurrent = bindAccount();
    try {
      await fileItemInto(item, collectionId, isCurrent);
      onSaved?.(collectionId, collections.find((c) => c.id === collectionId)?.name);
      onClose();
    } catch (err) {
      fail(() => fileInto(collectionId), err);
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }

  // Single flow (no nested fileInto busy check) so the 'new' busy flag can't trap itself.
  async function handleCreate() {
    const name = newName.trim();
    // Only reuse a pending collection owned by the current account.
    const resume = pendingRef.current && pendingOwnerRef.current === userRef.current ? pendingRef.current : null;
    if ((!name && !resume) || !item || busyRef.current) return;
    if (!userRef.current) { setError('Sign in to create collections.'); setLastAction(null); return; }
    busyRef.current = true;
    setBusyId('new'); setError(null);
    const isCurrent = bindAccount();
    try {
      const owner = userRef.current;
      const collection = await createAndFile(item, name, isPublic, isCurrent, resume, (c) => {
        pendingRef.current = c; pendingOwnerRef.current = owner; setPendingCreated(c);
      });
      pendingRef.current = null; pendingOwnerRef.current = null; setPendingCreated(null);
      onSaved?.(collection.id, collection.name);
      onClose();
    } catch (err) {
      fail(() => handleCreate(), err);
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }

  const errorBanner = error ? (
    <View style={styles.errorBox} accessibilityRole="alert" testID="save-to-collection-error">
      <Text style={styles.errorText}>{error}</Text>
      {lastAction ? (
        <TouchableOpacity onPress={lastAction} disabled={!!busyId} testID="save-to-collection-retry">
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  ) : null;

  if (creating) {
    const trimmed = newName.trim();
    const frozen = !!busyId || !!pendingCreated;
    return (
      <Sheet
        visible={visible}
        onClose={() => {
          if (busyRef.current) return;
          // Leaving a partially completed create closes the whole sheet so the
          // created collection is never re-created from the picker.
          if (pendingRef.current) { onClose(); return; }
          setCreating(false); setError(null);
        }}
        title="New collection"
        centerTitle
        headerRight="plain-close"
        avoidKeyboard
        testID="new-collection-sheet"
        primaryAction={{
          label: pendingCreated ? 'Retry save' : 'Save',
          onPress: handleCreate,
          disabled: (!trimmed && !pendingCreated) || !!busyId,
          loading: busyId === 'new',
          variant: 'primary',
          testID: 'new-collection-save',
        }}
      >
        <View style={styles.fieldHeader}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.counter}>{newName.length}/{COLLECTION_NAME_MAX}</Text>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Enter collection name"
            placeholderTextColor={SUBTLE}
            selectionColor={FG}
            value={newName}
            onChangeText={(t) => setNewName(t.slice(0, COLLECTION_NAME_MAX))}
            maxLength={COLLECTION_NAME_MAX}
            autoFocus
            editable={!frozen}
            onSubmitEditing={handleCreate}
            returnKeyType="done"
            testID="new-collection-name"
          />
          {newName.length > 0 && !frozen ? (
            <TouchableOpacity onPress={() => setNewName('')} accessibilityLabel="Clear name" hitSlop={8}>
              <Icon name="x-circle" size={ICON.sm} color={MUTED} />
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.label}>Make public</Text>
          <HapticSwitch value={isPublic} onValueChange={setIsPublic} disabled={frozen} accessibilityLabel="Make public" />
        </View>
        <Text style={styles.help}>
          Collections made public will be shown on your profile and can be shared with friends.
        </Text>
        {pendingCreated ? (
          <Text style={styles.help} testID="new-collection-resume">
            "{pendingCreated.name}" was created. Retry to add this item to it.
          </Text>
        ) : null}
        {errorBanner}
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Save to" headerRight="close" maxHeightRatio={0.75} testID="save-to-collection-sheet">
      {errorBanner}
      {loading ? (
        <View testID="save-to-collection-loading">
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.row}>
              <View style={[styles.rowIcon, styles.skeleton]} />
              <View style={[styles.skeletonBar, styles.skeleton]} />
            </View>
          ))}
        </View>
      ) : (
        <>
          {loadError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>Couldn't load your collections.</Text>
              <TouchableOpacity onPress={load} testID="save-to-collection-reload"><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
            </View>
          ) : null}
          <TouchableOpacity style={styles.row} onPress={() => fileInto(null)} disabled={!!busyId} activeOpacity={0.7}>
            <View style={styles.rowIcon}><Icon name="bookmark" size={ICON.sm} color={FG} /></View>
            <Text style={styles.rowLabel}>All Saved</Text>
            {busyId === 'none' ? <ActivityIndicator color={FG} /> : null}
          </TouchableOpacity>
          {collections.map((c) => (
            <TouchableOpacity key={c.id} style={styles.row} onPress={() => fileInto(c.id)} disabled={!!busyId} activeOpacity={0.7}>
              <View style={styles.rowIcon}><Icon name="folder" size={ICON.sm} color={FG} /></View>
              <View style={styles.flex}>
                <Text style={styles.rowLabel} numberOfLines={1}>{c.name}</Text>
                <Text style={styles.rowSubtitle}>{c.itemCount} saved · {c.isPublic ? 'Public' : 'Private'}</Text>
              </View>
              {busyId === c.id ? <ActivityIndicator color={FG} /> : null}
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.row}
            onPress={() => { setCreating(true); setError(null); setLastAction(null); }}
            disabled={!!busyId}
            activeOpacity={0.7}
            testID="save-to-collection-new"
          >
            <View style={[styles.rowIcon, styles.newIcon]}><Icon name="plus" size={ICON.sm} color={FG} /></View>
            <Text style={[styles.rowLabel, { fontFamily: FONT.semibold }]}>New collection</Text>
          </TouchableOpacity>
        </>
      )}
    </Sheet>
  );
}

const makeStyles = () => StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm + 2, borderBottomWidth: 1, borderBottomColor: BORDER },
  rowIcon: { width: 36, height: 36, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  newIcon: { borderColor: FG },
  rowLabel: { color: FG, fontFamily: FONT.medium, fontSize: FS.base, flex: 1 },
  rowSubtitle: { color: MUTED, fontSize: FS.xs, marginTop: 1 },
  skeleton: { backgroundColor: BORDER },
  skeletonBar: { flex: 1, height: 14, borderRadius: RADIUS.sm },
  fieldHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SP.sm },
  label: { color: FG, fontFamily: FONT.semibold, fontSize: FS.base },
  counter: { color: MUTED, fontSize: FS.sm },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: BORDER, gap: SP.sm },
  input: { flex: 1, height: COMP.inputH, color: FG, fontSize: FS.base },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SP.lg },
  help: { color: MUTED, fontSize: FS.xs, marginTop: SP.xs, marginBottom: SP.md },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: FG, marginVertical: SP.sm },
  errorText: { color: FG, fontSize: FS.sm, flex: 1 },
  retryText: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline' },
});
