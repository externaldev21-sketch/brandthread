/**
 * BrushLibrary.tsx — Procreate Pocket's full-screen "Brushes" panel, 1:1 in
 * structure, reskinned black / white / silver:
 *
 *   Done                                   (top-right)
 *   Brushes                                (large title)
 *   New set   New brush   Import          (text actions)
 *   ┌ rail ┐ ┌ brush cards ─────────────┐
 *   │glyph │ │ Name                  ⌇  │  ← stroke preview rendered by the
 *   │ Set  │ │ ～～～～～～～～～～～～  │    real paint engine
 *   └──────┘ └──────────────────────────┘
 *
 * Interactions (Mobbin flows 380c1871 / 962190de):
 *   - tap a set in the rail to show its brushes; tap a brush to select it
 *   - long-press a set → Rename / Delete / Share / Duplicate popover;
 *     Delete asks "Delete set?" in a centred Cancel / Delete alert
 *   - swipe a brush card left → Share / Duplicate / Delete
 *   - New set (adds "Untitled Set"), New brush (copy of the current brush in
 *     the open set), Import (a brush file shared from this panel)
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, PanResponder, ScrollView, Image,
  Modal, Pressable, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { BG, FG, MUTED, SUBTLE, BORDER_SUBTLE, FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import type { BrushLibraryState } from '@/lib/paint/brushLibrary';
import type { BrushPreset } from '@/lib/paint/brushPresets';
import { renderBrushPreview } from '@/lib/paint/brushPreview';
import BrushSetGlyph from './BrushSetGlyph';
import { confirmAlert } from '@/lib/actionSheet';

export interface BrushLibraryProps {
  library: BrushLibraryState;
  activeBrushId: string;
  onSelectBrush: (id: string) => void;
  onDuplicateBrush: (id: string) => void;
  onDeleteBrush: (id: string) => void;
  onShareBrush: (set: string, id: string) => void;
  onNewSet: () => string;
  onNewBrush: (set: string) => void;
  onImport: () => void;
  onRenameSet: (from: string, to: string) => void;
  onDeleteSet: (set: string) => void;
  onDuplicateSet: (set: string) => void;
  onShareSet: (set: string) => void;
  onClose: () => void;
}

const CARD = 'rgba(255,255,255,0.07)';
const SWIPE_ACTIONS_WIDTH = 168;
const RAIL_W = 84;

export default function BrushLibrary(props: BrushLibraryProps) {
  const { library, activeBrushId, onSelectBrush, onClose } = props;
  const insets = useSafeAreaInsets();
  const active = library.brushes.find(b => b.id === activeBrushId) ?? library.brushes[0];
  const [selectedSet, setSelectedSet] = useState(active?.category ?? library.sets[0] ?? '');
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [setMenu, setSetMenu] = useState<{ set: string; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ set: string; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const railItemY = useRef(new Map<string, number>());
  const railScrollY = useRef(0);

  useEffect(() => {
    if (!library.sets.includes(selectedSet)) setSelectedSet(library.sets[0] ?? '');
  }, [library.sets, selectedSet]);

  const visible = useMemo(() => library.brushes.filter(b => b.category === selectedSet), [library.brushes, selectedSet]);

  return (
    <View style={[s.panel, { paddingTop: insets.top }]} testID="brush-library">
      <View style={s.doneRow}>
        <TouchableOpacity onPress={onClose} testID="brush-library-done" accessibilityRole="button" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.done}>Done</Text>
        </TouchableOpacity>
      </View>
      <Text style={s.title} accessibilityRole="header">Brushes</Text>
      <View style={s.actionsRow}>
        <TouchableOpacity
          onPress={() => { const set = props.onNewSet(); setSelectedSet(set); setOpenSwipeId(null); }}
          testID="brush-new-set" accessibilityRole="button"
        >
          <Text style={s.action}>New set</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => props.onNewBrush(selectedSet)} testID="brush-new-brush" accessibilityRole="button">
          <Text style={s.action}>New brush</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={props.onImport} testID="brush-import" accessibilityRole="button">
          <Text style={s.action}>Import</Text>
        </TouchableOpacity>
      </View>

      <View style={s.body}>
        <ScrollView
          style={s.rail}
          testID="brush-library-sidebar"
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={32}
          onScroll={e => { railScrollY.current = e.nativeEvent.contentOffset.y; }}
          contentContainerStyle={{ paddingBottom: insets.bottom + SP.lg }}
        >
          {library.sets.map(set => {
            const on = set === selectedSet;
            return (
              <TouchableOpacity
                key={set}
                style={s.railItem}
                onLayout={e => { railItemY.current.set(set, e.nativeEvent.layout.y); }}
                onPress={() => { setSelectedSet(set); setOpenSwipeId(null); }}
                onLongPress={() => { setSelectedSet(set); setSetMenu({ set, y: (railItemY.current.get(set) ?? 0) - railScrollY.current }); }}
                delayLongPress={380}
                testID={`brush-category-${set}`}
                accessibilityRole="tab"
                accessibilityLabel={set}
                accessibilityState={{ selected: on }}
                accessibilityHint="Long-press for set options"
              >
                <BrushSetGlyph set={set} color={on ? FG : SUBTLE} />
                <Text style={[s.railLabel, on && s.railLabelOn]} numberOfLines={2}>{set}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <ScrollView style={s.list} contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + SP.lg }]} testID="brush-library-list">
          {visible.length === 0 && (
            <View style={s.empty}>
              <Text style={s.emptyText}>This set is empty.</Text>
              <TouchableOpacity onPress={() => props.onNewBrush(selectedSet)} accessibilityRole="button">
                <Text style={s.action}>New brush</Text>
              </TouchableOpacity>
            </View>
          )}
          {visible.map(b => (
            <BrushRow
              key={b.id}
              brush={b}
              isActive={b.id === activeBrushId}
              isSwipeOpen={openSwipeId === b.id}
              onOpenSwipe={() => setOpenSwipeId(b.id)}
              onCloseSwipe={() => setOpenSwipeId(id => (id === b.id ? null : id))}
              onSelect={() => { onSelectBrush(b.id); setOpenSwipeId(null); }}
              onShare={() => props.onShareBrush(selectedSet, b.id)}
              onDuplicate={() => { props.onDuplicateBrush(b.id); setOpenSwipeId(null); }}
              onDelete={() => {
                setOpenSwipeId(null);
                void confirmAlert({
                  title: `Delete "${b.name}"?`,
                  message: 'This brush will be removed from your library.',
                  confirmLabel: 'Delete',
                  destructive: true,
                }).then(ok => { if (ok) props.onDeleteBrush(b.id); });
              }}
              canDelete={library.brushes.length > 1}
            />
          ))}
        </ScrollView>
      </View>

      {/* Set long-press popover: Rename / Delete / Share / Duplicate */}
      {setMenu && (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setSetMenu(null)} testID="brush-set-menu-backdrop">
          <View
            style={[s.popover, { top: Math.max(insets.top + 150, Math.min(insets.top + 140 + setMenu.y, 640)) }]}
            testID="brush-set-menu"
          >
            {[
              { label: 'Rename', run: () => setRenaming({ set: setMenu.set, value: setMenu.set }) },
              { label: 'Delete', run: () => setConfirmDelete(setMenu.set) },
              { label: 'Share', run: () => props.onShareSet(setMenu.set) },
              { label: 'Duplicate', run: () => props.onDuplicateSet(setMenu.set) },
            ].map((item, i) => (
              <TouchableOpacity
                key={item.label}
                style={[s.popItem, i > 0 && s.popItemDivider]}
                onPress={() => { setSetMenu(null); item.run(); }}
                testID={`brush-set-${item.label.toLowerCase()}`}
                accessibilityRole="menuitem"
              >
                <Text style={s.popLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      )}

      {/* Rename set */}
      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <View style={s.alertBackdrop}>
          <View style={s.alert} testID="brush-rename-set">
            <Text style={s.alertTitle}>Rename set</Text>
            <TextInput
              value={renaming?.value ?? ''}
              onChangeText={v => setRenaming(r => (r ? { ...r, value: v } : r))}
              autoFocus
              selectTextOnFocus
              style={s.alertInput}
              placeholder="Set name"
              placeholderTextColor={SUBTLE}
              testID="brush-rename-input"
              onSubmitEditing={() => { if (renaming) { props.onRenameSet(renaming.set, renaming.value); setSelectedSet(renaming.value.trim() || renaming.set); } setRenaming(null); }}
            />
            <View style={s.alertButtons}>
              <TouchableOpacity style={s.alertBtn} onPress={() => setRenaming(null)} accessibilityRole="button">
                <Text style={s.alertBtnText}>Cancel</Text>
              </TouchableOpacity>
              <View style={s.alertBtnDivider} />
              <TouchableOpacity
                style={s.alertBtn}
                onPress={() => { if (renaming) { props.onRenameSet(renaming.set, renaming.value); setSelectedSet(renaming.value.trim() || renaming.set); } setRenaming(null); }}
                accessibilityRole="button"
                testID="brush-rename-save"
              >
                <Text style={[s.alertBtnText, s.alertBtnStrong]}>Rename</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* "Delete set?" — Procreate's centred confirm */}
      <Modal visible={confirmDelete !== null} transparent animationType="fade" onRequestClose={() => setConfirmDelete(null)}>
        <View style={s.alertBackdrop}>
          <View style={s.alert} testID="brush-delete-set-confirm">
            <Text style={s.alertTitle}>Delete set?</Text>
            <Text style={s.alertMessage}>
              This will delete “{confirmDelete}” and all the brushes in it. This can’t be undone.
            </Text>
            <View style={s.alertButtons}>
              <TouchableOpacity style={s.alertBtn} onPress={() => setConfirmDelete(null)} accessibilityRole="button" testID="brush-delete-set-cancel">
                <Text style={s.alertBtnText}>Cancel</Text>
              </TouchableOpacity>
              <View style={s.alertBtnDivider} />
              <TouchableOpacity
                style={s.alertBtn}
                onPress={() => { if (confirmDelete) props.onDeleteSet(confirmDelete); setConfirmDelete(null); }}
                accessibilityRole="button"
                testID="brush-delete-set-confirm-delete"
              >
                <Text style={[s.alertBtnText, s.alertBtnStrong]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Brush card ───────────────────────────────────────────────────────────────

interface BrushRowProps {
  brush: BrushPreset;
  isActive: boolean;
  isSwipeOpen: boolean;
  onOpenSwipe: () => void;
  onCloseSwipe: () => void;
  onSelect: () => void;
  onShare: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
}

function BrushRow(props: BrushRowProps) {
  const { brush, isActive, isSwipeOpen, onOpenSwipe, onCloseSwipe, onSelect, onShare, onDuplicate, onDelete, canDelete } = props;
  const translateX = useRef(new Animated.Value(0)).current;
  const dragStartX = useRef(0);
  // Web: the mouseup that ends a swipe also lands a click on the card's own
  // TouchableOpacity; swallow that one press so a swipe never also selects.
  const didDragRef = useRef(false);
  const openRef = useRef(isSwipeOpen);
  openRef.current = isSwipeOpen;

  useEffect(() => {
    Animated.timing(translateX, { toValue: isSwipeOpen ? -SWIPE_ACTIONS_WIDTH : 0, duration: 180, useNativeDriver: true }).start();
  }, [isSwipeOpen, translateX]);

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => { didDragRef.current = false; return false; },
    onMoveShouldSetPanResponder: (_e, g) => {
      const isDrag = Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy);
      if (isDrag) didDragRef.current = true;
      return isDrag;
    },
    onPanResponderGrant: () => { dragStartX.current = openRef.current ? -SWIPE_ACTIONS_WIDTH : 0; },
    onPanResponderMove: (_e, g) => translateX.setValue(Math.max(-SWIPE_ACTIONS_WIDTH, Math.min(0, dragStartX.current + g.dx))),
    onPanResponderRelease: (_e, g) => { if (dragStartX.current + g.dx < -SWIPE_ACTIONS_WIDTH / 2) onOpenSwipe(); else onCloseSwipe(); },
  })).current;

  // Engine-rendered preview: white stroke on the dark card, black on the selected (white) card.
  const preview = useMemo(
    () => renderBrushPreview(brush.id, brush.params, isActive ? '#000000' : '#FFFFFF'),
    [brush.id, brush.params, isActive],
  );

  return (
    <View style={s.rowWrap} testID={`brush-row-${brush.id}`}>
      <View style={s.swipeActions} pointerEvents={isSwipeOpen ? 'auto' : 'none'}>
        <TouchableOpacity style={s.swipeBtn} onPress={onShare} testID={`brush-share-${brush.id}`} accessibilityLabel={`Share ${brush.name}`}>
          <Text style={s.swipeLabel}>Share</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.swipeBtn} onPress={onDuplicate} testID={`brush-duplicate-${brush.id}`} accessibilityLabel={`Duplicate ${brush.name}`}>
          <Text style={s.swipeLabel}>Duplicate</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.swipeBtn, s.swipeDelete, !canDelete && { opacity: 0.3 }]}
          onPress={canDelete ? onDelete : undefined}
          testID={`brush-delete-${brush.id}`}
          accessibilityLabel={`Delete ${brush.name}`}
          accessibilityState={{ disabled: !canDelete }}
        >
          <Text style={[s.swipeLabel, { color: BG }]}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View {...responder.panHandlers} style={[s.card, isActive && s.cardActive, { transform: [{ translateX }] }]} testID={`brush-row-card-${brush.id}`}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => { if (didDragRef.current) { didDragRef.current = false; return; } onSelect(); }}
          testID={`brush-select-${brush.id}`}
          accessibilityRole="button"
          accessibilityLabel={brush.name}
          accessibilityState={{ selected: isActive }}
        >
          <View style={s.cardHead}>
            <Text style={[s.brushName, isActive && s.brushNameActive]} numberOfLines={1}>{brush.name}</Text>
            <Icon name="feather" size={ICON.xs ?? 12} color={isActive ? BG : SUBTLE} />
          </View>
          <View style={s.previewBox}>
            {preview ? (
              <Image source={{ uri: preview }} style={s.preview} resizeMode="contain" testID={`brush-preview-${brush.id}`} />
            ) : (
              <View style={[s.previewFallback, { backgroundColor: isActive ? BG : FG }]} />
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  panel: { flex: 1, backgroundColor: '#0A0A0A' },
  doneRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: SP.lg, paddingTop: SP.md, minHeight: 36 },
  done: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG, includeFontPadding: false },
  title: { fontFamily: FONT.bold, fontSize: FS.h1, color: FG, paddingHorizontal: SP.lg, marginTop: SP.md, includeFontPadding: false },
  actionsRow: { flexDirection: 'row', gap: SP.lg, paddingHorizontal: SP.lg, marginTop: SP.md, marginBottom: SP.md },
  action: { fontFamily: FONT.medium, fontSize: FS.md, color: FG, includeFontPadding: false },

  body: { flex: 1, flexDirection: 'row' },
  // flexGrow/flexShrink 0: a web ScrollView defaults to flexGrow 1 and would
  // otherwise split the row with the list instead of staying RAIL_W wide.
  rail: { width: RAIL_W, flexGrow: 0, flexShrink: 0 },
  railItem: { alignItems: 'center', gap: 4, paddingVertical: 9, paddingHorizontal: 4 },
  railLabel: { fontFamily: FONT.medium, fontSize: 11, color: SUBTLE, textAlign: 'center', includeFontPadding: false },
  railLabelOn: { color: FG },

  list: { flex: 1 },
  listContent: { paddingRight: SP.sm, paddingLeft: 2, gap: 6 },
  empty: { alignItems: 'center', gap: SP.sm, paddingTop: SP.xl },
  emptyText: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },

  rowWrap: { borderRadius: RADIUS.sm, overflow: 'hidden' },
  swipeActions: { position: 'absolute', right: 0, top: 0, bottom: 0, width: SWIPE_ACTIONS_WIDTH, flexDirection: 'row' },
  swipeBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1F1F1F', borderLeftWidth: 1, borderLeftColor: BORDER_SUBTLE },
  swipeDelete: { backgroundColor: '#D9D9D9' },
  swipeLabel: { fontFamily: FONT.semibold, fontSize: 12, color: FG },

  card: { backgroundColor: '#151515', borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4 },
  cardActive: { backgroundColor: '#EDEDED' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brushName: { fontFamily: FONT.bold, fontSize: 13, color: FG, includeFontPadding: false, flex: 1 },
  brushNameActive: { color: BG },
  previewBox: { height: 46, justifyContent: 'center' },
  preview: { width: '100%', height: 46 },
  previewFallback: { height: 4, borderRadius: 2, marginHorizontal: SP.md },

  popover: {
    position: 'absolute', left: RAIL_W - 6, width: 168, backgroundColor: '#1C1C1C', borderRadius: 12,
    borderWidth: 1, borderColor: BORDER_SUBTLE, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  popItem: { paddingVertical: 12, paddingHorizontal: SP.md },
  popItemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.14)' },
  popLabel: { fontFamily: FONT.medium, fontSize: FS.md, color: FG, textAlign: 'center' },

  alertBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  alert: { width: 280, backgroundColor: '#1C1C1C', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: BORDER_SUBTLE },
  alertTitle: { fontFamily: FONT.semibold, fontSize: 17, color: FG, textAlign: 'center', paddingTop: SP.lg, paddingHorizontal: SP.md },
  alertMessage: { fontFamily: FONT.regular, fontSize: 13, color: MUTED, textAlign: 'center', paddingHorizontal: SP.lg, paddingTop: 6, paddingBottom: SP.lg, lineHeight: 18 },
  alertInput: {
    marginHorizontal: SP.md, marginTop: SP.md, marginBottom: SP.lg, paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', color: FG, fontFamily: FONT.regular, fontSize: FS.md,
  },
  alertButtons: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.18)' },
  alertBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  alertBtnDivider: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.18)' },
  alertBtnText: { fontFamily: FONT.regular, fontSize: 17, color: FG },
  alertBtnStrong: { fontFamily: FONT.semibold },
});
