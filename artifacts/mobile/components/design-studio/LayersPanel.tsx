import { Button } from '@/components/ui/Button';
import { MEDIA } from '@/lib/theme';
/**
 * LayersPanel.tsx — Procreate's own Layers panel: a full-height dark sheet
 * (not a small floating popover), title "Layers" + Done, a "New layer" text
 * action, rows with a real thumbnail + name + blend-mode letter + visibility
 * checkbox, a pinned non-draggable "Background colour" row at the bottom,
 * swipe-left-to-reveal Lock/Duplicate/Delete per row, drag-to-reorder via the
 * handle, and tapping the ALREADY-selected row — or long-pressing any row —
 * opens a context menu (Rename/Select/Copy/Alpha Lock/Mask/Delete), so every
 * row action is reachable without the swipe gesture (which can't be found
 * with a mouse on web).
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
import { Icon } from '@/components/ui/Icon';
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
  /** Live pixel thumbnail for a layer (drawing layers), or null to fall back to the type glyph. */
  thumbnailFor?: (layer: DesignLayer) => string | null;
  /** Layer menu → Fill Layer / Clear (drawing layers). */
  onFillLayer?: (id: string) => void;
  onClearLayer?: (id: string) => void;
}

const BLEND_MODES: BlendModeKind[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'];
const ROW_HEIGHT = 64;
const SWIPE_ACTIONS_WIDTH = 168; // Lock (56) + Duplicate (56) + Delete (56)
const SWIPE_OPEN_THRESHOLD = 44;


export default function LayersPanel(props: LayersPanelProps) {
  const {
    layers, selectedLayerId, onSelect, onAddLayer, onDuplicateLayer, onDeleteLayer,
    onRenameLayer, onToggleVisible, onToggleLocked, onToggleAlphaLock, onToggleClippingMask,
    onSetBlendMode, onReorder, onClose, onSetOpacity, onMergeDown, thumbnailFor, onFillLayer, onClearLayer,
    canvasBackgroundHex, canvasBackgroundVisible, onToggleBackgroundVisible,
  } = props;

  // Non-template layers only, top-first (highest order = drawn last = visually on top).
  const displayed = [...layers]
    .filter(l => !l.isTemplate)
    .sort((a, b) => b.order - a.order);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Procreate's "N" popover (opacity + blend modes) for one layer.
  const [blendFor, setBlendFor] = useState<string | null>(null);
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

  function handleRowLongPress(layer: DesignLayer) {
    if (openSwipeId) closeSwipe(openSwipeId);
    if (selectedLayerId !== layer.id) onSelect(layer.id);
    setMenuFor(layer.id);
  }

  return (
    <View style={s.panel} testID="layers-panel">
      <View style={s.header}>
        <Text style={s.title}>Layers</Text>
        <TouchableOpacity onPress={onClose} accessibilityLabel="Done" accessibilityRole="button" testID="layers-done" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={s.doneLabel}>Done</Text>
        </TouchableOpacity>
      </View>

      <View style={s.actionsRow}>
        <TouchableOpacity onPress={onAddLayer} testID="layers-add-layer" accessibilityRole="button" hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
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
                    style={[s.swipeBtn, { backgroundColor: MEDIA.background }]}
                    onPress={() => { onToggleLocked(layer.id); closeSwipe(layer.id); }}
                    testID={`layer-swipe-lock-${layer.id}`}
                    accessibilityRole="button"
                  >
                    <Icon name={layer.locked ? 'unlock' : 'lock'} size={ICON.xs} color={FG} />
                    <Text style={s.swipeBtnText}>{layer.locked ? 'Unlock' : 'Lock'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.swipeBtn, { backgroundColor: MEDIA.background }]}
                    onPress={() => { onDuplicateLayer(layer.id); closeSwipe(layer.id); }}
                    testID={`layer-swipe-duplicate-${layer.id}`}
                    accessibilityRole="button"
                  >
                    <Icon name="copy" size={ICON.xs} color={FG} />
                    <Text style={s.swipeBtnText}>Duplicate</Text>
                  </TouchableOpacity>
                  <Button label="Delete" icon="trash-2" variant="destructive" size="compact"
                    style={s.swipeBtn}
                    onPress={() => { onDeleteLayer(layer.id); closeSwipe(layer.id); }}
                    testID={`layer-swipe-delete-${layer.id}`}
                  />
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
                    <Icon name="menu" size={ICON.xs} color={isSelected ? BG : SUBTLE} />
                  </View>

                  <View style={s.thumb}>
                    {layer.type === 'drawing' && thumbnailFor?.(layer) ? (
                      <View style={s.thumbChecker}>
                        <RNImage source={{ uri: thumbnailFor(layer)! }} style={s.thumbImage} resizeMode="contain" testID={`layer-thumb-${layer.id}`} />
                      </View>
                    ) : layer.type === 'image' && data?.uri ? (
                      <RNImage source={{ uri: data.uri }} style={s.thumbImage} resizeMode="cover" />
                    ) : layer.type === 'text' ? (
                      <Text style={[s.thumbGlyph, { color: MUTED }]}>Aa</Text>
                    ) : (
                      <Icon
                        name={layer.type === 'shape' ? 'square' : 'edit-3'}
                        size={ICON.sm}
                        color={MUTED}
                      />
                    )}
                  </View>

                  <Pressable
                    style={s.rowMain}
                    onPress={() => handleRowPress(layer)}
                    onLongPress={() => handleRowLongPress(layer)}
                    delayLongPress={350}
                    accessibilityRole="button"
                    accessibilityLabel={layer.name}
                    accessibilityHint={isSelected ? 'Opens layer options' : 'Selects this layer. Long-press for layer options'}
                    accessibilityState={{ selected: isSelected, expanded: menuFor === layer.id }}
                    testID={`layer-row-main-${layer.id}`}
                  >
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

                  <TouchableOpacity
                    onPress={() => { setMenuFor(null); setBlendFor(blendFor === layer.id ? null : layer.id); }}
                    hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Blend mode and opacity for ${layer.name}`}
                    testID={`layer-blend-button-${layer.id}`}
                  >
                    <Text style={[s.blendLetter, isSelected && s.blendLetterSelected]} testID={`layer-blend-letter-${layer.id}`}>
                      {blendLetter(layer.blendMode)}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => onToggleVisible(layer.id)}
                    style={[s.checkbox, layer.visible && s.checkboxChecked, isSelected && layer.visible && s.checkboxCheckedOnSelected]}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`Show ${layer.name}`}
                    accessibilityState={{ checked: layer.visible }}
                    hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
                    testID={`layer-visibility-${layer.id}`}
                  >
                    {layer.visible && (
                      <View testID={`layer-visibility-check-${layer.id}`}>
                        <Icon name="check" size={12} color={isSelected ? FG : BG} />
                      </View>
                    )}
                  </TouchableOpacity>
                </Animated.View>
              </View>

              {blendFor === layer.id && (
                <View style={s.blendPopover} testID={`layer-blend-popover-${layer.id}`}>
                  <OpacitySlider
                    value={layer.opacity ?? 1}
                    onCommit={v => onSetOpacity(layer.id, v)}
                    testID={`layer-opacity-${layer.id}`}
                  />
                  {BLEND_MODES.map(mode => {
                    const on = (layer.blendMode ?? 'normal') === mode;
                    return (
                      <TouchableOpacity
                        key={mode}
                        style={[s.blendListRow, on && s.blendListRowOn]}
                        onPress={() => onSetBlendMode(layer.id, mode)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        testID={`layer-blendmode-${mode}-${layer.id}`}
                      >
                        <Text style={[s.blendListText, on && s.blendListTextOn]}>{mode.charAt(0).toUpperCase() + mode.slice(1)}</Text>
                        <Text style={[s.blendListLetter, on && s.blendListTextOn]}>{blendLetter(mode)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {menuFor === layer.id && (
                <View style={s.contextMenu} testID={`layer-context-menu-${layer.id}`}>
                  <TouchableOpacity style={s.menuItem} onPress={() => startRename(layer)} testID={`layer-menu-rename-${layer.id}`}
                    accessibilityRole="button">
                    <Text style={s.menuItemText}>Rename</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.menuItem}
                    onPress={() => { onSelect(layer.id); setMenuFor(null); }}
                    testID={`layer-menu-select-${layer.id}`}
                    accessibilityRole="button"
                  >
                    <Text style={s.menuItemText}>Select</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.menuItem}
                    onPress={() => { onDuplicateLayer(layer.id); setMenuFor(null); }}
                    testID={`layer-menu-copy-${layer.id}`}
                    accessibilityRole="button"
                  >
                    <Text style={s.menuItemText}>Copy</Text>
                  </TouchableOpacity>
                  {layer.type === 'drawing' && onFillLayer && (
                    <TouchableOpacity style={s.menuItem} onPress={() => { onFillLayer(layer.id); setMenuFor(null); }} testID={`layer-menu-fill-${layer.id}`} accessibilityRole="button">
                      <Text style={s.menuItemText}>Fill Layer</Text>
                    </TouchableOpacity>
                  )}
                  {layer.type === 'drawing' && onClearLayer && (
                    <TouchableOpacity style={s.menuItem} onPress={() => { onClearLayer(layer.id); setMenuFor(null); }} testID={`layer-menu-clear-${layer.id}`} accessibilityRole="button">
                      <Text style={s.menuItemText}>Clear</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={s.menuItem}
                    onPress={() => onToggleAlphaLock(layer.id)}
                    testID={`layer-menu-alphalock-${layer.id}`}
                    accessibilityRole="button"
                  >
                    <Text style={s.menuItemText}>Alpha Lock{layer.alphaLocked ? '  ✓' : ''}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.menuItem}
                    onPress={() => onToggleClippingMask(layer.id)}
                    testID={`layer-menu-mask-${layer.id}`}
                    accessibilityRole="button"
                  >
                    <Text style={s.menuItemText}>Mask{layer.clippingMask ? '  ✓' : ''}</Text>
                  </TouchableOpacity>
                  {layer.type === 'drawing' && (
                    <TouchableOpacity style={s.menuItem} onPress={() => { setMenuFor(null); onMergeDown(layer.id); }} testID={`layer-menu-merge-${layer.id}`} accessibilityRole="button">
                      <Text style={s.menuItemText}>Merge Down</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={s.menuItem}
                    onPress={() => { setMenuFor(null); onDeleteLayer(layer.id); }}
                    testID={`layer-menu-delete-${layer.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${layer.name}`}
                  >
                    <Text style={s.menuItemText}>Delete</Text>
                  </TouchableOpacity>

                  <View style={s.blendRow}>
                    {BLEND_MODES.map(mode => (
                      <TouchableOpacity
                        key={mode}
                        onPress={() => onSetBlendMode(layer.id, mode)}
                        style={[s.blendChip, (layer.blendMode ?? 'normal') === mode && s.blendChipActive]}
                        testID={`layer-blend-${mode}-${layer.id}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: (layer.blendMode ?? 'normal') === mode }}
                      >
                        <Text style={[s.blendChipText, (layer.blendMode ?? 'normal') === mode && s.blendChipTextActive]}>{mode.charAt(0).toUpperCase() + mode.slice(1)}</Text>
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
            accessibilityRole="checkbox"
            accessibilityLabel="Show background colour"
            accessibilityState={{ checked: canvasBackgroundVisible }}
            hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
            testID="layer-visibility-background"
          >
            {canvasBackgroundVisible && (
              <View testID="layer-visibility-check-background">
                <Icon name="check" size={12} color={BG} />
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
  swipeBtnText: { fontFamily: FONT.medium, fontSize: FS.xs, color: FG, includeFontPadding: false },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    // Same side inset as the header (SP.lg) so the visibility checkbox lines
    // up under "Done" instead of sitting 9pt from the panel edge.
    paddingHorizontal: SP.lg, height: ROW_HEIGHT, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE,
    backgroundColor: CARD_ELEVATED,
  },
  // Procreate's own selected-row emphasis is a solid fill (blue in stock
  // Procreate); reskinned to the app's white/black/silver system — solid
  // white row, black text/icons, per the monochrome reskin rule.
  rowSelected: { backgroundColor: FG },
  rowDragging: { opacity: 0.5 },
  backgroundRow: { borderBottomWidth: 0 },
  dropLine: { height: 2, backgroundColor: FG, marginHorizontal: SP.lg },
  dragHandle: { width: 18, alignItems: 'center' },
  thumb: {
    width: 40, height: 40, borderRadius: RADIUS.xs, backgroundColor: SURFACE,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  // Drawing-layer thumbnails are transparent PNGs: a light backdrop like Procreate's.
  thumbChecker: { width: '100%', height: '100%', backgroundColor: '#E6E6E6' },
  blendPopover: {
    marginHorizontal: SP.md, marginTop: 4, marginBottom: SP.sm, paddingVertical: 6,
    backgroundColor: '#1C1C1C', borderRadius: 12, borderWidth: 1, borderColor: BORDER_SUBTLE,
  },
  blendListRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: 9 },
  blendListRowOn: { backgroundColor: 'rgba(255,255,255,0.10)' },
  blendListText: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  blendListLetter: { fontFamily: FONT.semibold, fontSize: FS.sm, color: SUBTLE },
  blendListTextOn: { color: FG },
  opacityRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  opacityLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG, width: 58 },
  opacityValue: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, width: 44, textAlign: 'right' },
  opacityTrack: { flex: 1, height: 28, justifyContent: 'center' },
  opacityRail: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  opacityFill: { position: 'absolute', left: 0, height: 3, borderRadius: 2, backgroundColor: FG },
  opacityKnob: { position: 'absolute', width: 18, height: 18, marginLeft: -9, borderRadius: 9, backgroundColor: FG, top: 5 },
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
  menuItem: { paddingVertical: 8, paddingHorizontal: SP.lg - SP.sm },
  menuItemText: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG, includeFontPadding: false },
  blendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs, marginTop: SP.xs },
  blendChip: {
    paddingHorizontal: SP.sm, paddingVertical: 4, borderRadius: radius.sm,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER_SUBTLE,
  },
  blendChipActive: { backgroundColor: FG, borderColor: FG },
  blendChipText: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED, includeFontPadding: false },
  blendChipTextActive: { color: BG },
});

/** The "N" popover's Opacity slider: live while dragging, committed (one undo step) on release. */
function OpacitySlider({ value, onCommit, testID }: { value: number; onCommit: (v: number) => void; testID?: string }) {
  const [live, setLive] = useState<number | null>(null);
  const width = useRef(1);
  const startX = useRef(0);
  const latest = useRef(value);
  const shown = live ?? value;
  const set = (x: number) => {
    const v = Math.max(0, Math.min(1, x / width.current));
    latest.current = v;
    setLive(v);
  };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: e => { startX.current = e.nativeEvent.locationX; set(startX.current); },
    onPanResponderMove: (_e, g) => set(startX.current + g.dx),
    onPanResponderRelease: () => { onCommit(latest.current); setLive(null); },
    onPanResponderTerminate: () => { onCommit(latest.current); setLive(null); },
  })).current;
  return (
    <View style={s.opacityRow}>
      <Text style={s.opacityLabel}>Opacity</Text>
      <View
        style={s.opacityTrack}
        onLayout={e => { width.current = Math.max(1, e.nativeEvent.layout.width); }}
        {...responder.panHandlers}
        testID={testID}
        accessibilityRole="adjustable"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
      >
        <View style={s.opacityRail} pointerEvents="none" />
        <View style={[s.opacityFill, { width: `${shown * 100}%` }]} pointerEvents="none" />
        <View style={[s.opacityKnob, { left: `${shown * 100}%` }]} pointerEvents="none" />
      </View>
      <Text style={s.opacityValue}>{Math.round(shown * 100)}%</Text>
    </View>
  );
}
