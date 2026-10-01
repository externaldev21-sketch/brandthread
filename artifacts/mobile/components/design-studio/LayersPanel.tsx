/**
 * LayersPanel.tsx — Procreate's own Layers panel: a full-height dark sheet
 * (not a small floating popover), title "Layers" + Done, a "New layer" text
 * action, rows with a real thumbnail + name + blend-mode letter + visibility
 * checkbox, a pinned non-draggable "Background colour" row at the bottom,
 * swipe-left-to-reveal Lock/Duplicate/Delete per row, drag-to-reorder via the
 * handle, and tapping the ALREADY-selected row opens a context menu
 * (Rename/Select/Copy/Alpha Lock/Mask).
 *
 * "New group" / collapsible groups are deliberately NOT implemented here —
 * DesignLayer has no parentId/children relationship and DesignLayerData has
 * no 'group' variant (see services/designTypes.ts), so grouping would need a
 * real data-model + compositor + export change, not a panel-only stub. Left
 * for a follow-up rather than faked as a button that does nothing.
 *
 * Similarly, the Procreate context menu's Fill Layer / Clear / Invert /
 * Reference entries are left out: none of those have backing logic anywhere
 * in design-canvas.tsx today, and adding fake menu items that no-op would
 * violate "no stubs" more than leaving them out.
 *
 * Pure presentational + callback-driven: the host screen (design-canvas.tsx)
 * owns the layer array and undo/autosave wiring, and passes down the current
 * layers plus handlers. This keeps the panel reusable and independently
 * testable without dragging in the whole canvas screen's state machine.
 */

import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, PanResponder, Pressable,
  Animated, Image as RNImage, Dimensions, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  BG, SURFACE, CARD_ELEVATED, BORDER, BORDER_SUBTLE, FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import type { DesignLayer, BlendModeKind } from '@/services/designTypes';
import { blendLetter, computeDragTargetIndex, clampSwipeTranslateX, shouldSwipeOpen } from '@/lib/layersPanelModel';
import { radius } from '@/constants/radii';

export interface LayersPanelProps {
  layers: DesignLayer[]; // any order; will be rendered top-first (highest `order` first)
  selectedLayerId: string | null;
  onSelect: (id: string) => void;
  onAddLayer: () => void;
  onDuplicateLayer: (id: string) => void;
  onDeleteLayer: (id: string) => void;
  onRenameLayer: (id: string, name: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onToggleAlphaLock: (id: string) => void;
  onToggleClippingMask: (id: string) => void;
  onSetOpacity: (id: string, opacity: number) => void;
  onSetBlendMode: (id: string, mode: BlendModeKind) => void;
  onReorder: (fromIndex: number, toIndex: number) => void; // indices into the TOP-FIRST displayed order
  onMergeDown: (id: string) => void;
  onClose: () => void;
  /** Pinned "Background colour" row — real canvas background state, not a fake row. */
  canvasBackgroundHex: string;
  canvasBackgroundVisible: boolean;
  onToggleBackgroundVisible: () => void;
}

const BLEND_MODES: BlendModeKind[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'];
const ROW_HEIGHT = 64;
const SWIPE_ACTIONS_WIDTH = 168; // Lock (56) + Duplicate (56) + Delete (56)
const SWIPE_OPEN_THRESHOLD = 44;


export default function LayersPanel(props: LayersPanelProps) {
  const {
    layers, selectedLayerId, onSelect, onAddLayer, onDuplicateLayer, onDeleteLayer,
    onRenameLayer, onToggleVisible, onToggleLocked, onToggleAlphaLock, onToggleClippingMask,
    onSetBlendMode, onReorder, onClose,
    canvasBackgroundHex, canvasBackgroundVisible, onToggleBackgroundVisible,
  } = props;

  // Non-template layers only, top-first (highest order = drawn last = visually on top).
  const displayed = [...layers]
    .filter(l => !l.isTemplate)
    .sort((a, b) => b.order - a.order);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragStartY = useRef(0);
  const dragFromIndex = useRef<number | null>(null);

  // One Animated.Value per layer id for the swipe-reveal translateX, created
  // lazily and kept across renders in a ref map (keyed by layer id).
  const swipeAnims = useRef<Map<string, Animated.Value>>(new Map());
  function swipeAnimFor(id: string): Animated.Value {
    let v = swipeAnims.current.get(id);
    if (!v) { v = new Animated.Value(0); swipeAnims.current.set(id, v); }
    return v;
  }
  function closeSwipe(id: string) {
    Animated.timing(swipeAnimFor(id), { toValue: 0, duration: 160, useNativeDriver: true }).start();
    if (openSwipeId === id) setOpenSwipeId(null);
  }

  function makeDragResponder(index: number) {
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: (e) => {
        dragStartY.current = e.nativeEvent.pageY;
        dragFromIndex.current = index;
        setDragIndex(index);
        setDragOverIndex(index);
      },
      onPanResponderMove: (e) => {
        const dy = e.nativeEvent.pageY - dragStartY.current;
        setDragOverIndex(computeDragTargetIndex(index, dy, ROW_HEIGHT, displayed.length));
      },
      onPanResponderRelease: () => {
        if (dragFromIndex.current !== null && dragOverIndex !== null && dragOverIndex !== dragFromIndex.current) {
          onReorder(dragFromIndex.current, dragOverIndex);
        }
        setDragIndex(null);
        setDragOverIndex(null);
        dragFromIndex.current = null;
      },
      onPanResponderTerminate: () => {
        setDragIndex(null);
        setDragOverIndex(null);
        dragFromIndex.current = null;
      },
    });
  }

  function makeSwipeResponder(id: string) {
    const anim = swipeAnimFor(id);
    let base = 0;
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        anim.stopAnimation(v => { base = v; });
      },
      onPanResponderMove: (_e, g) => {
        anim.setValue(clampSwipeTranslateX(base, g.dx, SWIPE_ACTIONS_WIDTH));
      },
      onPanResponderRelease: (_e, g) => {
        if (shouldSwipeOpen(base, g.dx, SWIPE_OPEN_THRESHOLD)) {
          Animated.timing(anim, { toValue: -SWIPE_ACTIONS_WIDTH, duration: 140, useNativeDriver: true }).start();
          setOpenSwipeId(id);
        } else {
          Animated.timing(anim, { toValue: 0, duration: 140, useNativeDriver: true }).start();
          if (openSwipeId === id) setOpenSwipeId(null);
        }
      },
    });
  }

  function commitRename(id: string) {
    const trimmed = editingName.trim();
    if (trimmed) onRenameLayer(id, trimmed);
    setEditingId(null);
  }

  function startRename(layer: DesignLayer) {
    setMenuFor(null);
    setEditingId(layer.id);
    setEditingName(layer.name);
  }

  function handleRowPress(layer: DesignLayer) {
    if (openSwipeId) { closeSwipe(openSwipeId); return; }
    if (selectedLayerId === layer.id) {
      setMenuFor(menuFor === layer.id ? null : layer.id);
    } else {
      onSelect(layer.id);
      setMenuFor(null);
    }
  }

  return (
    <View style={s.panel} testID="layers-panel">
      <View style={s.header}>
        <Text style={s.title}>Layers</Text>
        <TouchableOpacity onPress={onClose} accessibilityLabel="Done" accessibilityRole="button" testID="layers-done">
          <Text style={s.doneLabel}>Done</Text>
        </TouchableOpacity>
      </View>

      <View style={s.actionsRow}>
        <TouchableOpacity onPress={onAddLayer} testID="layers-add-layer">
          <Text style={s.actionLabel}>New layer</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.list} contentContainerStyle={s.listContent}>
        {displayed.map((layer, index) => {
          const isSelected = layer.id === selectedLayerId;
          const dragResponder = makeDragResponder(index);
          const swipeResponder = makeSwipeResponder(layer.id);
          const isDragging = dragIndex === index;
          const showDropLine = dragOverIndex === index && dragIndex !== null && dragIndex !== index;
          const anim = swipeAnimFor(layer.id);
          const data: any = layer.data;

          return (
            <View key={layer.id}>
              {showDropLine && <View style={s.dropLine} />}
              <View style={s.rowWrap}>
                <View style={s.swipeActions} testID={`layer-swipe-actions-${layer.id}`}>
                  <TouchableOpacity
                    style={[s.swipeBtn, { backgroundColor: '#2A2A2A' }]}
                    onPress={() => { onToggleLocked(layer.id); closeSwipe(layer.id); }}
                    testID={`layer-swipe-lock-${layer.id}`}
                  >
                    <Feather name={layer.locked ? 'unlock' : 'lock'} size={ICON.xs} color={FG} />
                    <Text style={s.swipeBtnText}>{layer.locked ? 'Unlock' : 'Lock'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.swipeBtn, { backgroundColor: '#3A3A3A' }]}
                    onPress={() => { onDuplicateLayer(layer.id); closeSwipe(layer.id); }}
                    testID={`layer-swipe-duplicate-${layer.id}`}
                  >
                    <Feather name="copy" size={ICON.xs} color={FG} />
                    <Text style={s.swipeBtnText}>Duplicate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.swipeBtn, { backgroundColor: '#8A1F1F' }]}
                    onPress={() => { onDeleteLayer(layer.id); closeSwipe(layer.id); }}
                    testID={`layer-swipe-delete-${layer.id}`}
                  >
                    <Feather name="trash-2" size={ICON.xs} color={FG} />
                    <Text style={s.swipeBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>

                <Animated.View
                  {...swipeResponder.panHandlers}
                  style={[
                    s.row, isSelected && s.rowSelected, isDragging && s.rowDragging,
                    { transform: [{ translateX: anim }] },
                  ]}
                  testID={`layer-row-${layer.id}`}
                >
                  <View {...dragResponder.panHandlers} style={s.dragHandle} testID={`layer-drag-handle-${layer.id}`}>
                    <Feather name="menu" size={ICON.xs} color={isSelected ? BG : SUBTLE} />
                  </View>

                  <View style={s.thumb}>
                    {layer.type === 'image' && data?.uri ? (
                      <RNImage source={{ uri: data.uri }} style={s.thumbImage} resizeMode="cover" />
                    ) : layer.type === 'text' ? (
                      <Text style={[s.thumbGlyph, { color: isSelected ? BG : MUTED }]}>Aa</Text>
                    ) : (
                      <Feather
                        name={layer.type === 'shape' ? 'square' : 'edit-3'}
                        size={ICON.sm}
                        color={isSelected ? BG : MUTED}
                      />
                    )}
                  </View>

                  <Pressable style={s.rowMain} onPress={() => handleRowPress(layer)}>
                    {editingId === layer.id ? (
                      <TextInput
                        value={editingName}
                        onChangeText={setEditingName}
                        onBlur={() => commitRename(layer.id)}
                        onSubmitEditing={() => commitRename(layer.id)}
                        autoFocus
                        style={[s.nameInput, isSelected && { color: BG, borderBottomColor: BG }]}
                        testID={`layer-rename-${layer.id}`}
                      />
                    ) : (
                      <Text style={[s.name, isSelected && s.nameSelected]} numberOfLines={1}>{layer.name}</Text>
                    )}
                  </Pressable>

                  <Text style={[s.blendLetter, isSelected && s.blendLetterSelected]} testID={`layer-blend-letter-${layer.id}`}>
                    {blendLetter(layer.blendMode)}
                  </Text>

                  <TouchableOpacity
                    onPress={() => onToggleVisible(layer.id)}
                    style={[s.checkbox, layer.visible && s.checkboxChecked, isSelected && layer.visible && s.checkboxCheckedOnSelected]}
                    accessibilityLabel="Toggle visibility"
                    accessibilityState={{ checked: layer.visible }}
                    testID={`layer-visibility-${layer.id}`}
                  >
                    {layer.visible && (
                      <View testID={`layer-visibility-check-${layer.id}`}>
                        <Feather name="check" size={12} color={isSelected ? FG : BG} />
                      </View>
                    )}
                  </TouchableOpacity>
                </Animated.View>
              </View>

              {menuFor === layer.id && (
                <View style={s.contextMenu} testID={`layer-context-menu-${layer.id}`}>
                  <TouchableOpacity style={s.menuItem} onPress={() => startRename(layer)} testID={`layer-menu-rename-${layer.id}`}>
                    <Text style={s.menuItemText}>Rename</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.menuItem}
                    onPress={() => { onSelect(layer.id); setMenuFor(null); }}
                    testID={`layer-menu-select-${layer.id}`}
                  >
                    <Text style={s.menuItemText}>Select</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.menuItem}
                    onPress={() => { onDuplicateLayer(layer.id); setMenuFor(null); }}
                    testID={`layer-menu-copy-${layer.id}`}
                  >
                    <Text style={s.menuItemText}>Copy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.menuItem}
                    onPress={() => onToggleAlphaLock(layer.id)}
                    testID={`layer-menu-alphalock-${layer.id}`}
                  >
                    <Text style={s.menuItemText}>Alpha Lock{layer.alphaLocked ? '  ✓' : ''}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.menuItem}
                    onPress={() => onToggleClippingMask(layer.id)}
                    testID={`layer-menu-mask-${layer.id}`}
                  >
                    <Text style={s.menuItemText}>Mask{layer.clippingMask ? '  ✓' : ''}</Text>
                  </TouchableOpacity>

                  <View style={s.blendRow}>
                    {BLEND_MODES.map(mode => (
                      <TouchableOpacity
                        key={mode}
                        onPress={() => onSetBlendMode(layer.id, mode)}
                        style={[s.blendChip, (layer.blendMode ?? 'normal') === mode && s.blendChipActive]}
                        testID={`layer-blend-${mode}-${layer.id}`}
                      >
                        <Text style={[s.blendChipText, (layer.blendMode ?? 'normal') === mode && s.blendChipTextActive]}>{mode}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {/* Pinned "Background colour" row — Procreate always shows this last,
            non-draggable, no blend letter. Reflects the project's real canvas
            background (services/designTypes.ts DesignCanvas.backgroundHex /
            backgroundOpacity), not a fake decorative row. */}
        <View style={[s.row, s.backgroundRow]} testID="layer-row-background">
          <View style={s.dragHandle} />
          <View style={[s.thumb, { backgroundColor: canvasBackgroundHex, borderWidth: 1, borderColor: BORDER_SUBTLE }]} />
          <View style={s.rowMain}>
            <Text style={s.name}>Background colour</Text>
          </View>
          <TouchableOpacity
            onPress={onToggleBackgroundVisible}
            style={[s.checkbox, canvasBackgroundVisible && s.checkboxChecked]}
            accessibilityLabel="Toggle background visibility"
            testID="layer-visibility-background"
          >
            {canvasBackgroundVisible && (
              <View testID="layer-visibility-check-background">
                <Feather name="check" size={12} color={BG} />
              </View>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const SCREEN_H = Dimensions.get('window').height;

const s = StyleSheet.create({
  // Fixed height (not maxHeight-to-content) — Procreate's own Layers sheet
  // always fills most of the screen, even with only a couple of layers; the
  // empty space below the last row is still the panel's own dark surface,
  // not a gap that exposes the canvas/overlay behind it.
  panel: {
    width: '100%', height: Math.round(SCREEN_H * 0.8),
    backgroundColor: CARD_ELEVATED, borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg,
    borderWidth: 1, borderColor: BORDER, borderTopWidth: 0, overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.lg, paddingTop: SP.lg, paddingBottom: SP.sm,
  },
  title: { fontFamily: FONT.bold, fontSize: 28, color: FG, includeFontPadding: false },
  doneLabel: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG, includeFontPadding: false },
  actionsRow: {
    flexDirection: 'row', gap: SP.lg, paddingHorizontal: SP.lg, paddingBottom: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE,
  },
  actionLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED, includeFontPadding: false },
  list: { flex: 1 },
  listContent: { flexGrow: 1 },
  rowWrap: { position: 'relative', overflow: 'hidden' },
  swipeActions: {
    position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row', width: SWIPE_ACTIONS_WIDTH,
  },
  swipeBtn: { width: 56, alignItems: 'center', justifyContent: 'center', gap: 2 },
  swipeBtnText: { fontFamily: FONT.medium, fontSize: 10, color: FG, includeFontPadding: false },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.sm, height: ROW_HEIGHT, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE,
    backgroundColor: CARD_ELEVATED,
  },
  // Procreate's own selected-row emphasis is a solid fill (blue in stock
  // Procreate); reskinned to the app's white/black/silver system — solid
  // white row, black text/icons, per the monochrome reskin rule.
  rowSelected: { backgroundColor: FG },
  rowDragging: { opacity: 0.5 },
  backgroundRow: { borderBottomWidth: 0 },
  dropLine: { height: 2, backgroundColor: FG, marginHorizontal: SP.sm },
  dragHandle: { width: 18, alignItems: 'center' },
  thumb: {
    width: 40, height: 40, borderRadius: RADIUS.xs, backgroundColor: SURFACE,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbGlyph: { fontFamily: FONT.semibold, fontSize: FS.sm, includeFontPadding: false },
  rowMain: { flex: 1, justifyContent: 'center' },
  name: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG, includeFontPadding: false },
  nameSelected: { color: BG },
  nameInput: {
    fontFamily: FONT.medium, fontSize: FS.sm, color: FG, includeFontPadding: false,
    borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE, paddingVertical: 2,
  },
  blendLetter: { fontFamily: FONT.semibold, fontSize: FS.xs, color: SUBTLE, includeFontPadding: false, width: 16, textAlign: 'center' },
  blendLetterSelected: { color: BG },
  checkbox: {
    width: 22, height: 22, borderRadius: RADIUS.xs, borderWidth: 1.5, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: FG, borderColor: FG },
  checkboxCheckedOnSelected: { backgroundColor: BG, borderColor: BG },
  contextMenu: {
    padding: SP.sm, backgroundColor: BG, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE, gap: 2,
  },
  menuItem: { paddingVertical: 8, paddingHorizontal: SP.sm },
  menuItemText: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG, includeFontPadding: false },
  blendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs, marginTop: SP.xs },
  blendChip: {
    paddingHorizontal: SP.sm, paddingVertical: 4, borderRadius: radius.sm,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER_SUBTLE,
  },
  blendChipActive: { backgroundColor: FG, borderColor: FG },
  blendChipText: { fontFamily: FONT.medium, fontSize: 10, color: MUTED, includeFontPadding: false },
  blendChipTextActive: { color: BG },
});
