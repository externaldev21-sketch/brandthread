import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder, Alert, ScrollView } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';

type Stroke = { d: string; color: string; width: number };

const PALETTE = ['#0D0D0D', '#FFFFFF', '#EF4444', '#F59E0B', '#EAB308', '#22C55E', '#0EA5E9', '#9F7AEA', '#EC4899'];
const WIDTHS = [2, 4, 8, 16];

export default function DesignCanvasScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ label?: string; dims?: string; ratio?: string }>();
  const title = params.label ?? 'Untitled Artwork';
  const dims = params.dims;
  const ratio = params.ratio ? parseFloat(params.ratio) : undefined;
  const isFullBleed = !ratio || params.label === 'Screen Size';

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [color, setColor] = useState(PALETTE[0]);
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[1]);
  const [currentD, setCurrentD] = useState('');
  const pointsRef = useRef<string[]>([]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        pointsRef.current = [`M${locationX.toFixed(1)},${locationY.toFixed(1)}`];
        setCurrentD(pointsRef.current.join(' '));
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        pointsRef.current.push(`L${locationX.toFixed(1)},${locationY.toFixed(1)}`);
        setCurrentD(pointsRef.current.join(' '));
      },
      onPanResponderRelease: () => {
        if (pointsRef.current.length > 1) {
          setStrokes((prev) => [...prev, { d: pointsRef.current.join(' '), color, width: strokeWidth }]);
          setRedoStack([]);
        }
        pointsRef.current = [];
        setCurrentD('');
      },
    }),
  ).current;

  function undo() {
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      setRedoStack((r) => [...r, prev[prev.length - 1]]);
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function redo() {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      setStrokes((s) => [...s, prev[prev.length - 1]]);
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function clearAll() {
    if (strokes.length === 0) return;
    Alert.alert('Clear canvas', 'Erase everything you\u2019ve drawn?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => { setStrokes([]); setRedoStack([]); } },
    ]);
  }

  function save() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Saved', `"${title}" was saved to your artwork gallery.`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={() => router.back()}>
          <Feather name="chevron-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {dims != null && <Text style={styles.subtitle} numberOfLines={1}>{dims}</Text>}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} onPress={undo} disabled={strokes.length === 0}>
            <Feather name="rotate-ccw" size={19} color={strokes.length === 0 ? '#4A4A4A' : '#FFF'} />
          </TouchableOpacity>
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} onPress={redo} disabled={redoStack.length === 0}>
            <Feather name="rotate-cw" size={19} color={redoStack.length === 0 ? '#4A4A4A' : '#FFF'} />
          </TouchableOpacity>
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} onPress={clearAll}>
            <Feather name="trash-2" size={18} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveBtn} activeOpacity={0.85} onPress={save}>
            <Text style={styles.saveBtnText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Canvas */}
      <View style={styles.canvasWrap}>
        <View
          style={[
            styles.canvas,
            isFullBleed ? { flex: 1, width: '100%' } : { width: '100%', aspectRatio: ratio, flex: undefined },
          ]}
          {...panResponder.panHandlers}
        >
          <Svg style={StyleSheet.absoluteFill}>
            {strokes.map((s, i) => (
              <Path key={i} d={s.d} stroke={s.color} strokeWidth={s.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {currentD !== '' && (
              <Path d={currentD} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </Svg>
        </View>
      </View>

      {/* Toolbar */}
      <View style={[styles.toolbar, { paddingBottom: insets.bottom + 12 }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatchRow}>
          {PALETTE.map((c) => (
            <TouchableOpacity
              key={c}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setColor(c); }}
              style={[
                styles.swatch,
                { backgroundColor: c, borderColor: color === c ? '#9F7AEA' : '#3A3A3A' },
              ]}
            />
          ))}
        </ScrollView>
        <View style={styles.widthRow}>
          {WIDTHS.map((w) => (
            <TouchableOpacity
              key={w}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStrokeWidth(w); }}
              style={[styles.widthBtn, strokeWidth === w && styles.widthBtnActive]}
            >
              <View style={{ width: w, height: w, borderRadius: w / 2, backgroundColor: '#FFF' }} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12, gap: 10,
  },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { textAlign: 'center', fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#FFF' },
  subtitle: { textAlign: 'center', fontSize: 11, fontFamily: 'Inter_400Regular', color: '#8A8A8A', marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  saveBtn: { backgroundColor: '#9F7AEA', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginLeft: 2 },
  saveBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FFF' },

  canvasWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14 },
  canvas: { flex: 1, width: '100%', backgroundColor: '#FFFFFF', borderRadius: 10, overflow: 'hidden' },

  toolbar: { paddingHorizontal: 16, paddingTop: 10, gap: 12, borderTopWidth: 1, borderTopColor: '#232323' },
  swatchRow: { gap: 10, alignItems: 'center' },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2 },
  widthRow: { flexDirection: 'row', justifyContent: 'center', gap: 22 },
  widthBtn: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1E1E1E', borderWidth: 1, borderColor: 'transparent',
  },
  widthBtnActive: { borderColor: '#9F7AEA', backgroundColor: '#2A2140' },
});
