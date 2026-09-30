/**
 * Brandthread AI Tools — full-screen swipeable result viewer (shared)
 *
 * Tap a finished result tile → this opens full-screen with horizontal
 * swipe between every finished result in the batch, a Before/After
 * toggle, and a bottom glass action bar. Shared between every AI tool in
 * this family that shows a results grid.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '@/components/ui/Glass';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import type { AiResultSlot } from './AiResultTypes';

const { width: SW, height: SH } = Dimensions.get('window');

export interface AiResultViewerAction {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: (item: AiResultSlot) => void;
  loading?: (item: AiResultSlot) => boolean;
}

interface AiResultViewerProps {
  visible: boolean;
  items: AiResultSlot[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  actions: AiResultViewerAction[];
}

export function AiResultViewer({ visible, items, index, onIndexChange, onClose, actions }: AiResultViewerProps) {
  const insets = useSafeAreaInsets();
  const [showBefore, setShowBefore] = useState(false);
  const current = items[index];

  useEffect(() => { setShowBefore(false); }, [index]);

  if (!visible || !current) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={s.root}>
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          horizontal
          pagingEnabled
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: SW, offset: SW * i, index: i })}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / SW);
            if (items[i]) onIndexChange(i);
          }}
          renderItem={({ item }) => (
            <View style={{ width: SW, height: SH, alignItems: 'center', justifyContent: 'center' }}>
              <Image
                source={{ uri: showBefore && item.id === current.id ? item.sourceUri : item.imageUri }}
                style={s.image}
                resizeMode="contain"
              />
            </View>
          )}
        />

        <View style={[s.topBar, { paddingTop: insets.top + SP.sm }]}>
          <Glass variant="regular" radius={RADIUS.pill} style={s.glassBtn}>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close" style={s.glassBtnInner}>
              <Feather name="x" size={ICON.md} color="#fff" />
            </TouchableOpacity>
          </Glass>
          <Text style={s.counter}>{index + 1} / {items.length}</Text>
          {current.sourceUri ? (
            <Glass variant="regular" radius={RADIUS.pill} style={s.glassBtn}>
              <TouchableOpacity
                onPress={() => setShowBefore((v) => !v)}
                accessibilityLabel={showBefore ? 'Show generated photo' : 'Show original photo'}
                style={s.glassBtnInner}
              >
                <Text style={s.beforeAfterText}>{showBefore ? 'Before' : 'After'}</Text>
              </TouchableOpacity>
            </Glass>
          ) : (
            <View style={s.glassBtn} />
          )}
        </View>

        <View style={[s.bottomBar, { paddingBottom: insets.bottom + SP.md }]}>
          <Glass variant="regular" radius={RADIUS.xl} style={s.actionBar}>
            {actions.map((a) => {
              const loading = a.loading?.(current) ?? false;
              return (
                <TouchableOpacity
                  key={a.label}
                  style={s.actionBarBtn}
                  onPress={() => a.onPress(current)}
                  accessibilityLabel={a.label}
                  disabled={loading}
                >
                  {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name={a.icon} size={ICON.md} color="#fff" />}
                  <Text style={s.actionBarLabel}>{a.label}</Text>
                </TouchableOpacity>
              );
            })}
          </Glass>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, width: SW, height: SH, backgroundColor: '#000' },
  image: { width: SW, height: SH },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md,
  },
  glassBtn: { width: 40, height: 40, overflow: 'hidden' },
  glassBtnInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  counter: { color: '#fff', fontFamily: FONT.semibold, fontSize: FS.sm },
  beforeAfterText: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.xs },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: SP.md },
  actionBar: { flexDirection: 'row', paddingVertical: SP.sm, overflow: 'hidden' },
  actionBarBtn: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: SP.xs },
  actionBarLabel: { color: '#fff', fontFamily: FONT.medium, fontSize: FS.xs },
});
