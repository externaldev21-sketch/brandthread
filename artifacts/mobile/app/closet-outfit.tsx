/**
 * Digital Closet outfit — Whering's "Add" picker → outfit board, reskinned.
 *
 *   /closet-outfit          pick pieces (grid, numbered checks, "Next (n)"),
 *                           then the board with Save / Post as a Fit
 *   /closet-outfit?id=…     a saved outfit: board, its pieces, Post as a Fit
 *
 * "Post as a Fit" opens the existing create flow with every piece already
 * tagged (create-post `fitTags`); the server accepts buyer tags only for
 * pieces in that buyer's closet.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ClosetPieceTile, OutfitBoard } from '@/components/closet/ClosetViews';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { createFitHref, fitTagsFromPieces, pieceCaption } from '@/lib/closet';
import { hapticDestructiveConfirm, hapticSelection, hapticSuccess } from '@/lib/haptics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, SP } from '@/lib/theme';
import {
  MAX_OUTFIT_PIECES, deleteClosetOutfit, getClosetOutfits, getClosetPieces, saveClosetOutfit,
  type ClosetOutfit, type ClosetPiece,
} from '@/services/closetService';

const GRID_COLUMNS = 3;
const GRID_GAP = 1;

export default function ClosetOutfitScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const columnWidth = Math.min(width, 600);
  const params = useLocalSearchParams<{ id?: string }>();
  const outfitId = typeof params.id === 'string' ? params.id : null;

  const [pieces, setPieces] = useState<ClosetPiece[] | null>(null);
  const [outfit, setOutfit] = useState<ClosetOutfit | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [step, setStep] = useState<'pick' | 'board'>('pick');
  const [busy, setBusy] = useState<'save' | 'post' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = outfitId
      ? getClosetOutfits().then((all) => {
        if (!live) return;
        const found = all.find((o) => o.id === outfitId) ?? null;
        setOutfit(found);
        setPieces(found?.pieces ?? []);
      })
      : getClosetPieces().then((all) => { if (live) setPieces(all); });
    load.catch(() => { if (live) { setPieces([]); setError('Couldn’t load your closet.'); } });
    return () => { live = false; };
  }, [outfitId]);

  const byId = useMemo(() => new Map((pieces ?? []).map((p) => [p.id, p])), [pieces]);
  const boardPieces = outfit ? outfit.pieces : picked.map((id) => byId.get(id)).filter((p): p is ClosetPiece => !!p);

  const toggle = useCallback((piece: ClosetPiece) => {
    setPicked((prev) => {
      if (prev.includes(piece.id)) return prev.filter((id) => id !== piece.id);
      if (prev.length >= MAX_OUTFIT_PIECES) return prev;
      return [...prev, piece.id];
    });
    // An outfit already saved from this picker (Post as a Fit, then back) no
    // longer matches the picks: drop it so the board and Save/Post use them.
    if (!outfitId) setOutfit(null);
    hapticSelection();
  }, [outfitId]);

  const save = useCallback(async (): Promise<ClosetOutfit | null> => {
    if (outfit) return outfit;
    try {
      const saved = await saveClosetOutfit(picked);
      setOutfit(saved);
      return saved;
    } catch {
      setError('Couldn’t save this outfit. Try again.');
      return null;
    }
  }, [outfit, picked]);

  const onSave = useCallback(async () => {
    setBusy('save');
    setError(null);
    const saved = await save();
    setBusy(null);
    if (!saved) return;
    hapticSuccess();
    router.replace(`/closet-outfit?id=${encodeURIComponent(saved.id)}` as never);
  }, [router, save]);

  const onPost = useCallback(async () => {
    setBusy('post');
    setError(null);
    const saved = await save();
    setBusy(null);
    if (!saved) return;
    router.push(createFitHref(fitTagsFromPieces(saved.pieces)) as never);
  }, [router, save]);

  const onDelete = useCallback(() => {
    if (!outfit) return;
    const run = async () => {
      setBusy('delete');
      try {
        await deleteClosetOutfit(outfit.id);
        hapticDestructiveConfirm();
        goBackOr(router, '/(buyer)/profile' as never);
      } catch {
        setError('Couldn’t delete this outfit. Try again.');
      } finally {
        setBusy(null);
      }
    };
    if (Platform.OS === 'web') { void run(); return; }
    Alert.alert('Delete this outfit?', 'The pieces stay in your closet.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void run(); } },
    ]);
  }, [outfit, router]);

  const back = useCallback(() => {
    if (!outfitId && step === 'board') { setStep('pick'); return; }
    goBackOr(router, '/(buyer)/profile' as never);
  }, [outfitId, router, step]);

  if (pieces === null) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <ScreenHeader title={outfitId ? 'Outfit' : 'New outfit'} onBack={back} />
        <ActivityIndicator style={styles.loading} color={theme.muted} />
      </View>
    );
  }

  // ── Picker ────────────────────────────────────────────────────────────────
  if (!outfitId && step === 'pick') {
    const tileWidth = Math.floor((columnWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]} testID="closet-outfit-pick">
        <ScreenHeader title="New outfit" onBack={back} />
        {pieces.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>Your closet is empty</Text>
          </View>
        ) : (
          <FlatList
            data={pieces}
            keyExtractor={(p) => p.id}
            numColumns={GRID_COLUMNS}
            columnWrapperStyle={{ gap: GRID_GAP }}
            contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
            renderItem={({ item }) => {
              const index = picked.indexOf(item.id);
              return (
                <ClosetPieceTile
                  piece={item}
                  width={tileWidth}
                  selected={index >= 0}
                  selectionIndex={index >= 0 ? index + 1 : undefined}
                  onPress={toggle}
                  testID={`closet-pick-${item.id}`}
                />
              );
            }}
          />
        )}
        {pieces.length > 0 ? (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + SP.sm, backgroundColor: theme.background, borderTopColor: theme.border }]}>
            <Button
              label={picked.length ? `Next (${picked.length})` : 'Next'}
              disabled={picked.length === 0}
              onPress={() => setStep('board')}
              fullWidth
              testID="closet-outfit-next"
            />
          </View>
        ) : null}
      </View>
    );
  }

  // ── Board (new or saved) ─────────────────────────────────────────────────
  const boardWidth = columnWidth - SP.md * 2;
  if (outfitId && !outfit) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <ScreenHeader title="Outfit" onBack={back} />
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>{error ? 'Couldn’t load this outfit' : 'This outfit is gone'}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="closet-outfit-board">
      <ScreenHeader title={outfitId ? 'Outfit' : 'New outfit'} onBack={back} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: 140 + insets.bottom }}>
        <OutfitBoard pieces={boardPieces} width={boardWidth} testID="closet-outfit-board-canvas" />
        <View style={styles.pieceList}>
          {boardPieces.map((piece) => (
            <View key={piece.id} style={styles.pieceRow}>
              <Text style={[styles.pieceName, { color: theme.text }]} numberOfLines={1}>{piece.name}</Text>
              <Text style={[styles.pieceMeta, { color: theme.muted }]} numberOfLines={1}>{pieceCaption(piece)}</Text>
            </View>
          ))}
        </View>
        {outfit ? (
          <Button label="Delete outfit" variant="tertiary" onPress={onDelete} loading={busy === 'delete'} testID="closet-outfit-delete" />
        ) : null}
      </ScrollView>
      <View style={[styles.bottomBar, styles.bottomRow, { paddingBottom: insets.bottom + SP.sm, backgroundColor: theme.background, borderTopColor: theme.border }]}>
        {error ? <Text style={[styles.error, { color: theme.muted }]}>{error}</Text> : null}
        <View style={styles.actions}>
          {!outfit ? (
            <View style={styles.actionFlex}>
              <Button label="Save" variant="secondary" onPress={onSave} loading={busy === 'save'} disabled={!!busy} fullWidth testID="closet-outfit-save" />
            </View>
          ) : null}
          <View style={styles.actionFlex}>
            <Button label="Post as a Fit" onPress={onPost} loading={busy === 'post'} disabled={!!busy} fullWidth testID="closet-outfit-post" />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { marginTop: SP.xl },
  empty: { paddingHorizontal: SP.lg, paddingTop: SP.xl, gap: SP.xs },
  emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.md },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: SP.md, paddingTop: SP.sm, borderTopWidth: StyleSheet.hairlineWidth,
  },
  bottomRow: { gap: SP.xs },
  actions: { flexDirection: 'row', gap: SP.sm },
  actionFlex: { flex: 1 },
  error: { fontFamily: FONT.regular, fontSize: FS.meta, textAlign: 'center' },
  pieceList: { paddingTop: SP.md, paddingBottom: SP.sm },
  pieceRow: { paddingVertical: SP.sm, gap: 2 },
  pieceName: { fontFamily: FONT.medium, fontSize: FS.base },
  pieceMeta: { fontFamily: FONT.regular, fontSize: FS.sm },
});
