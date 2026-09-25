/**
 * LayersPanel.tsx — floating layers panel (Procreate-style small popover, not
 * a full-screen modal). Add/duplicate/delete/reorder(drag)/rename/visibility/
 * lock/opacity/blend-mode/alpha-lock/clipping-mask/merge-down.
 *
 * Pure presentational + callback-driven: the host screen (design-canvas.tsx)
 * owns the layer array and undo/autosave wiring, and passes down the current
 * layers plus handlers. This keeps the panel reusable and independently
 * testable without dragging in the whole canvas screen's state machine.
 */

import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, PanResponder, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_SUBTLE, FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import type { DesignLayer, BlendModeKind } from '@/services/designTypes';

const BLEND_MODES: BlendModeKind[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'];

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
}

const ROW_HEIGHT = 64;

export default function LayersPanel(props: LayersPanelProps) {
  const {
    layers, selectedLayerId, onSelect, onAddLayer, onDuplicateLayer, onDeleteLayer,
    onRenameLayer, onToggleVisible, onToggleLocked, onToggleAlphaLock, onToggleClippingMask,
    onSetOpacity, onSetBlendMode, onReorder, onMergeDown, onClose,
  } = props;

  // Non-template layers only, top-first (highest order = drawn last = visually on top).
  const displayed = [...layers]
    .filter(l => !l.isTemplate)
    .sort((a, b) => b.order - a.order);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [blendMenuFor, setBlendMenuFor] = useState<string | null>(null);
  const [opacityDragFor, setOpacityDragFor] = useState<string | null>(null);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragStartY = useRef(0);
  const dragFromIndex = useRef<number | null>(null);

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
        const shift = Math.round(dy / ROW_HEIGHT);
        const target = Math.max(0, Math.min(displayed.length - 1, index + shift));
        setDragOverIndex(target);
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

  function commitRename(id: string) {
    const trimmed = editingName.trim();
    if (trimmed) onRenameLayer(id, trimmed);
    setEditingId(null);
  }

  function opacitySliderResponder(id: string, current: number) {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => setOpacityDragFor(id),
      onPanResponderMove: (_e, g) => {
        const next = Math.max(0, Math.min(1, current + g.dx / 120));
        onSetOpacity(id, next);
      },
      onPanResponderRelease: () => setOpacityDragFor(null),
    });
  }

  return (
    <View style={s.panel} testID="layers-panel">
      <View style={s.header}>
        <Text style={s.title}>Layers</Text>
        <View style={{ flexDirection: 'row', gap: SP.sm }}>
          <TouchableOpacity onPress={onAddLayer} style={s.headerBtn} accessibilityLabel="Add layer" testID="layers-add">
            <Feather name="plus" size={ICON.sm} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={s.headerBtn} accessibilityLabel="Close layers panel" testID="layers-close">
            <Feather name="x" size={ICON.sm} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ maxHeight: 420 }}>
        {displayed.map((layer, index) => {
          const isSelected = layer.id === selectedLayerId;
          const responder = makeDragResponder(index);
          const isDragging = dragIndex === index;
          const showDropLine = dragOverIndex === index && dragIndex !== null && dragIndex !== index;

          return (
            <View key={layer.id}>
              {showDropLine && <View style={s.dropLine} />}
              <View
                {...responder.panHandlers}
                style={[s.row, isSelected && s.rowSelected, isDragging && s.rowDragging]}
                testID={`layer-row-${layer.id}`}
              >
                <View style={s.dragHandle}>
                  <Feather name="menu" size={ICON.xs} color={SUBTLE} />
                </View>

                <Pressable style={s.thumb} onPress={() => onSelect(layer.id)}>
                  <Feather
                    name={layer.type === 'text' ? 'type' : layer.type === 'image' ? 'image' : layer.type === 'shape' ? 'square' : 'edit-3'}
                    size={ICON.sm}
                    color={MUTED}
                  />
                </Pressable>

                <View style={{ flex: 1 }}>
                  {editingId === layer.id ? (
                    <TextInput
                      value={editingName}
                      onChangeText={setEditingName}
                      onBlur={() => commitRename(layer.id)}
                      onSubmitEditing={() => commitRename(layer.id)}
                      autoFocus
                      style={s.nameInput}
                      testID={`layer-rename-${layer.id}`}
                    />
                  ) : (
                    <TouchableOpacity
                      onPress={() => onSelect(layer.id)}
                      onLongPress={() => { setEditingId(layer.id); setEditingName(layer.name); }}
                    >
                      <Text style={s.name} numberOfLines={1}>{layer.name}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => setBlendMenuFor(blendMenuFor === layer.id ? null : layer.id)}>
                    <Text style={s.blendLabel}>{(layer.blendMode ?? 'normal')} · {Math.round(layer.opacity * 100)}%</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity onPress={() => onToggleAlphaLock(layer.id)} style={s.iconBtn} accessibilityLabel="Alpha lock">
                  <Feather name="droplet" size={ICON.xs} color={layer.alphaLocked ? FG : SUBTLE} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onToggleClippingMask(layer.id)} style={s.iconBtn} accessibilityLabel="Clipping mask">
                  <Feather name="corner-left-down" size={ICON.xs} color={layer.clippingMask ? FG : SUBTLE} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onToggleLocked(layer.id)} style={s.iconBtn} accessibilityLabel="Lock layer">
                  <Feather name={layer.locked ? 'lock' : 'unlock'} size={ICON.xs} color={layer.locked ? FG : SUBTLE} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onToggleVisible(layer.id)} style={s.iconBtn} accessibilityLabel="Toggle visibility">
                  <Feather name={layer.visible ? 'eye' : 'eye-off'} size={ICON.xs} color={layer.visible ? FG : SUBTLE} />
                </TouchableOpacity>
              </View>

              {blendMenuFor === layer.id && (
                <View style={s.blendMenu}>
                  <View
                    {...opacitySliderResponder(layer.id, layer.opacity).panHandlers}
                    style={s.opacityTrack}
                    testID={`layer-opacity-${layer.id}`}
                  >
                    <View style={[s.opacityFill, { width: `${Math.round(layer.opacity * 100)}%` }]} />
                  </View>
                  <View style={s.blendRow}>
                    {BLEND_MODES.map(mode => (
                      <TouchableOpacity
                        key={mode}
                        onPress={() => onSetBlendMode(layer.id, mode)}
                        style={[s.blendChip, (layer.blendMode ?? 'normal') === mode && s.blendChipActive]}
                      >
                        <Text style={[s.blendChipText, (layer.blendMode ?? 'normal') === mode && s.blendChipTextActive]}>{mode}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={s.actionRow}>
                    <TouchableOpacity onPress={() => onDuplicateLayer(layer.id)} style={s.actionBtn}>
                      <Feather name="copy" size={ICON.xs} color={FG} />
                      <Text style={s.actionText}>Duplicate</Text>
                    </TouchableOpacity>
                    {index < displayed.length - 1 && (
                      <TouchableOpacity onPress={() => onMergeDown(layer.id)} style={s.actionBtn}>
                        <Feather name="arrow-down" size={ICON.xs} color={FG} />
                        <Text style={s.actionText}>Merge down</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => onDeleteLayer(layer.id)} style={s.actionBtn}>
                      <Feather name="trash-2" size={ICON.xs} color={FG} />
                      <Text style={s.actionText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  panel: {
    width: 280, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE,
  },
  title: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, includeFontPadding: false },
  headerBtn: { width: 28, height: 28, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: SURFACE },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.sm, height: ROW_HEIGHT, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE,
  },
  rowSelected: { backgroundColor: 'rgba(255,255,255,0.06)' },
  rowDragging: { opacity: 0.5 },
  dropLine: { height: 2, backgroundColor: FG, marginHorizontal: SP.sm },
  dragHandle: { width: 18, alignItems: 'center' },
  thumb: {
    width: 36, height: 36, borderRadius: RADIUS.xs, backgroundColor: SURFACE,
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG, includeFontPadding: false },
  nameInput: {
    fontFamily: FONT.medium, fontSize: FS.sm, color: FG, includeFontPadding: false,
    borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE, paddingVertical: 2,
  },
  blendLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, includeFontPadding: false, marginTop: 2 },
  iconBtn: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  blendMenu: { padding: SP.sm, backgroundColor: BG, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE, gap: SP.sm },
  opacityTrack: { height: 6, borderRadius: 3, backgroundColor: SURFACE, overflow: 'hidden' },
  opacityFill: { height: '100%', backgroundColor: FG },
  blendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs },
  blendChip: {
    paddingHorizontal: SP.sm, paddingVertical: 4, borderRadius: RADIUS.pill,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER_SUBTLE,
  },
  blendChipActive: { backgroundColor: FG, borderColor: FG },
  blendChipText: { fontFamily: FONT.medium, fontSize: 10, color: MUTED, includeFontPadding: false },
  blendChipTextActive: { color: BG },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { fontFamily: FONT.medium, fontSize: FS.xs, color: FG, includeFontPadding: false },
});
