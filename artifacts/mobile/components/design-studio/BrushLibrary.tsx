/**
 * BrushLibrary.tsx — Procreate's own full-screen "Brushes" picker, not a
 * ~72%-height bottom sheet with a single scrolling list. Confirmed against
 * Mobbin's Procreate Pocket captures: a left sidebar of brush-set
 * categories (icon + label, vertical list) and a right pane showing only
 * the selected set's brushes, each as a full-width row (name above a real
 * stroke preview), the active brush highlighted. Swiping a row left
 * reveals Share / Duplicate / Delete — all three wired to real behaviour
 * (Share uses the OS share sheet; Duplicate/Delete mutate the actual brush
 * list via `lib/brushLibraryModel.ts`).
 *
 * Full per-brush parameter editing ("Brush Studio": Stroke Path / Shape /
 * Grain / Rendering / Wet Mix / Color Dynamics) is explicitly OUT of scope
 * for this component — see the PR this shipped in. So are "New set" /
 * "New brush" / "Import" (Procreate's own header row for those): a real
 * "New brush" needs Brush Studio to configure it, and "Import" needs an
 * actual brush file format this app doesn't have — both left for that
 * larger follow-up rather than faked here.
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, PanResponder, ScrollView, Share,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon, type IconName } from '@/components/ui/Icon';
import {
  BG, SURFACE, CARD_ELEVATED, BORDER, BORDER_SUBTLE, FG, MUTED, SUBTLE, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrushDef, groupBrushesByCategory } from '@/lib/brushLibraryModel';

const CATEGORY_ICONS: Record<string, IconName> = {
  Sketching: 'edit-3',
  Inking: 'feather',
  Painting: 'droplet',
  Airbrushing: 'wind',
  Marker: 'edit-2',
};

export interface BrushLibraryProps {
  brushes: BrushDef[];
  activeBrushId: string;
  strokeColor: string;
  onSelectBrush: (id: string) => void;
  onDuplicateBrush: (id: string) => void;
  onDeleteBrush: (id: string) => void;
  onClose: () => void;
}

const SWIPE_ACTIONS_WIDTH = 150; // 3 × 50pt action buttons

export default function BrushLibrary(props: BrushLibraryProps) {
  const { brushes, activeBrushId, strokeColor, onSelectBrush, onDuplicateBrush, onDeleteBrush, onClose } = props;

  const groups = useMemo(() => groupBrushesByCategory(brushes), [brushes]);
  const activeBrush = brushes.find(b => b.id === activeBrushId) ?? brushes[0];
  const [selectedCategory, setSelectedCategory] = useState(activeBrush?.category ?? groups[0]?.category ?? '');
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);

  const visibleGroup = groups.find(g => g.category === selectedCategory) ?? groups[0];

  function shareBrush(b: BrushDef) {
    Share.share({ message: `${b.name} — a ${b.category.toLowerCase()} brush from Brandthread's Design Studio.` }).catch(() => {});
  }

  return (
    <View style={s.panel} testID="brush-library">
      <View style={s.header}>
        <Text style={s.title}>Brushes</Text>
        <TouchableOpacity onPress={onClose} testID="brush-library-done">
          <Text style={s.doneLabel}>Done</Text>
        </TouchableOpacity>
      </View>

      <View style={s.body}>
        <ScrollView style={s.sidebar} testID="brush-library-sidebar" showsVerticalScrollIndicator={false}>
          {groups.map(g => (
            <TouchableOpacity
              key={g.category}
              style={[s.sidebarItem, selectedCategory === g.category && s.sidebarItemActive]}
              onPress={() => { setSelectedCategory(g.category); setOpenSwipeId(null); }}
              testID={`brush-category-${g.category}`}
            >
              <Icon
                name={CATEGORY_ICONS[g.category] ?? 'edit-3'}
                size={ICON.sm}
                color={selectedCategory === g.category ? FG : SUBTLE}
              />
              <Text
                style={[s.sidebarLabel, selectedCategory === g.category && s.sidebarLabelActive]}
                numberOfLines={1}
              >
                {g.category}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView style={s.list} contentContainerStyle={s.listContent} testID="brush-library-list">
          {(visibleGroup?.brushes ?? []).map(b => (
            <BrushRow
              key={b.id}
              brush={b}
              isActive={b.id === activeBrushId}
              strokeColor={strokeColor}
              isSwipeOpen={openSwipeId === b.id}
              onOpenSwipe={() => setOpenSwipeId(b.id)}
              onCloseSwipe={() => setOpenSwipeId(id => (id === b.id ? null : id))}
              onSelect={() => { onSelectBrush(b.id); setOpenSwipeId(null); }}
              onShare={() => shareBrush(b)}
              onDuplicate={() => { onDuplicateBrush(b.id); setOpenSwipeId(null); }}
              onDelete={() => { onDeleteBrush(b.id); setOpenSwipeId(null); }}
              canDelete={brushes.length > 1}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

interface BrushRowProps {
  brush: BrushDef;
  isActive: boolean;
  strokeColor: string;
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
  const {
    brush, isActive, strokeColor, isSwipeOpen, onOpenSwipe, onCloseSwipe,
    onSelect, onShare, onDuplicate, onDelete, canDelete,
  } = props;

  const translateX = useRef(new Animated.Value(0)).current;
  const dragStartX = useRef(0);
  // Set true the moment a drag crosses the PanResponder's own move
  // threshold, cleared right after the following tap is swallowed. Needed
  // because on web, releasing the drag still lands the mouseup over the
  // "select" TouchableOpacity underneath (its hit area moved WITH the
  // dragged row), which synthesizes its own onPress — that onPress called
  // onSelect, whose closeSwipe side effect immediately re-closed the row
  // this exact gesture had just swiped open. A real, reproducible bug this
  // rebuild's e2e swipe test caught (not a flake): the drag visibly reached
  // -150px mid-gesture but the row always snapped back to closed on
  // release.
  const didDragRef = useRef(false);

  function animateTo(toValue: number, after?: () => void) {
    Animated.timing(translateX, { toValue, duration: 180, useNativeDriver: true }).start(after);
  }

  React.useEffect(() => {
    animateTo(isSwipeOpen ? -SWIPE_ACTIONS_WIDTH : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSwipeOpen]);

  const responder = useRef(
    PanResponder.create({
      // Resets the stale-flag guard at the start of every fresh touch
      // sequence (not just when it drags) so an earlier drag whose
      // trailing click never arrived can't swallow a later, unrelated tap.
      onStartShouldSetPanResponder: () => { didDragRef.current = false; return false; },
      onMoveShouldSetPanResponder: (_e, g) => {
        const isDrag = Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy);
        if (isDrag) didDragRef.current = true;
        return isDrag;
      },
      onPanResponderGrant: () => {
        dragStartX.current = isSwipeOpen ? -SWIPE_ACTIONS_WIDTH : 0;
      },
      onPanResponderMove: (_e, g) => {
        const next = Math.max(-SWIPE_ACTIONS_WIDTH, Math.min(0, dragStartX.current + g.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        const shouldOpen = dragStartX.current + g.dx < -SWIPE_ACTIONS_WIDTH / 2;
        if (shouldOpen) onOpenSwipe(); else onCloseSwipe();
      },
    })
  ).current;

  function handleSelectPress() {
    // Swallow the press that the browser synthesizes on mouseup right
    // after a real drag — see didDragRef's comment above.
    if (didDragRef.current) { didDragRef.current = false; return; }
    onSelect();
  }

  const widthPx = Math.min(10, brush.widthMult * 3);
  const d = 'M8,16 Q20,4 40,12 Q60,20 72,8';

  return (
    <View style={s.rowWrap} testID={`brush-row-${brush.id}`}>
      <View style={s.swipeActions} pointerEvents={isSwipeOpen ? 'auto' : 'none'}>
        <TouchableOpacity style={s.swipeBtn} onPress={onShare} testID={`brush-share-${brush.id}`} accessibilityLabel={`Share ${brush.name}`}>
          <Icon name="share" size={ICON.sm} color={FG} />
        </TouchableOpacity>
        <TouchableOpacity style={s.swipeBtn} onPress={onDuplicate} testID={`brush-duplicate-${brush.id}`} accessibilityLabel={`Duplicate ${brush.name}`}>
          <Icon name="copy" size={ICON.sm} color={FG} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.swipeBtn, s.swipeBtnDelete, !canDelete && s.swipeBtnDisabled]}
          onPress={canDelete ? onDelete : undefined}
          testID={`brush-delete-${brush.id}`}
          accessibilityLabel={`Delete ${brush.name}`}
        >
          <Icon name="trash-2" size={ICON.sm} color={FG} />
        </TouchableOpacity>
      </View>

      <Animated.View
        {...responder.panHandlers}
        style={[s.row, isActive && s.rowActive, { transform: [{ translateX }] }]}
        testID={`brush-row-card-${brush.id}`}
      >
        <TouchableOpacity style={{ flex: 1 }} onPress={handleSelectPress} testID={`brush-select-${brush.id}`}>
          <Text style={[s.brushName, isActive && s.brushNameActive]} numberOfLines={1}>{brush.name}</Text>
          <Svg width="100%" height={28} viewBox="0 0 80 24" preserveAspectRatio="none">
            <Path
              d={d}
              stroke={isActive ? BG : strokeColor}
              strokeWidth={widthPx}
              fill="none"
              strokeLinecap={brush.linecap}
              strokeLinejoin="round"
              opacity={brush.opacityMult}
            />
          </Svg>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  panel: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.lg, paddingTop: SP.lg, paddingBottom: SP.sm,
    borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE,
  },
  title: { fontFamily: FONT.bold, fontSize: 28, color: FG, includeFontPadding: false },
  doneLabel: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG, includeFontPadding: false },

  body: { flex: 1, flexDirection: 'row' },

  // flexGrow/flexShrink: 0 matter here, not just width: 96 — a ScrollView
  // on web defaults to flexGrow: 1, so without pinning it explicitly, this
  // sidebar and the right-pane list (`list`, flex: 1 below) split the
  // remaining row space roughly evenly instead of the sidebar staying a
  // fixed 96pt. That silently squeezed the right pane down to about half
  // its intended width, which is what was truncating brush names like
  // "Soft Brush Copy" — a real layout bug, not a copy/font-size issue.
  sidebar: { width: 96, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderRightColor: BORDER_SUBTLE },
  sidebarItem: { alignItems: 'center', gap: 4, paddingVertical: SP.sm, paddingHorizontal: 4 },
  sidebarItemActive: { backgroundColor: 'rgba(255,255,255,0.08)' },
  sidebarLabel: { fontFamily: FONT.medium, fontSize: 10, color: SUBTLE, includeFontPadding: false, textAlign: 'center' },
  sidebarLabelActive: { color: FG },

  list: { flex: 1 },
  listContent: { paddingVertical: SP.sm },

  rowWrap: { position: 'relative', marginHorizontal: SP.md, marginBottom: SP.sm, borderRadius: RADIUS.sm, overflow: 'hidden' },
  swipeActions: {
    position: 'absolute', right: 0, top: 0, bottom: 0, width: SWIPE_ACTIONS_WIDTH,
    flexDirection: 'row',
  },
  swipeBtn: {
    width: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: SURFACE,
    borderLeftWidth: 1, borderLeftColor: BORDER_SUBTLE,
  },
  swipeBtnDelete: { backgroundColor: '#3A1414' },
  swipeBtnDisabled: { opacity: 0.3 },

  row: {
    backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER_SUBTLE, borderRadius: RADIUS.sm,
    padding: SP.sm,
  },
  rowActive: { backgroundColor: FG, borderColor: FG },
  brushName: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, includeFontPadding: false, marginBottom: 4 },
  brushNameActive: { color: BG },
});
