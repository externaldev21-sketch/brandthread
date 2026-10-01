/**
 * TikTok-style destination bar: labels in a horizontal, snapping strip, the
 * active one centred in white with a dot beneath, the rest silver. Swipe it or
 * tap a label. Which modes appear is decided by the caller from the account's
 * role (constants/postLimits.ts → CREATE_MODES_BY_ROLE).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { FONT } from '@/lib/theme';
import { MODE_LABEL, type CreateMode } from '@/constants/postLimits';
import { CP } from '@/components/create-post/ui';

const ITEM_W = 80;

export function ModeBar({ modes, active, onChange }: {
  modes: CreateMode[]; active: CreateMode; onChange: (mode: CreateMode) => void;
}) {
  const [width, setWidth] = useState(0);
  const ref = useRef<ScrollView>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIndex = Math.max(0, modes.indexOf(active));

  useEffect(() => {
    if (width > 0) ref.current?.scrollTo({ x: activeIndex * ITEM_W, animated: true });
  }, [activeIndex, width]);
  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);

  function commit(x: number) {
    const index = Math.max(0, Math.min(modes.length - 1, Math.round(x / ITEM_W)));
    if (modes[index] !== active) { Haptics.selectionAsync().catch(() => {}); onChange(modes[index]); }
    else ref.current?.scrollTo({ x: index * ITEM_W, animated: true });
  }

  const pad = Math.max(0, (width - ITEM_W) / 2);
  return (
    <View style={s.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} testID="create-mode-bar">
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={ITEM_W}
        decelerationRate="fast"
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: pad }}
        onScroll={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          if (settle.current) clearTimeout(settle.current);
          settle.current = setTimeout(() => commit(x), 140);
        }}
      >
        {modes.map((mode) => {
          const on = mode === active;
          return (
            <Pressable
              key={mode}
              testID={`create-mode-${mode}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={MODE_LABEL[mode]}
              onPress={() => commit(modes.indexOf(mode) * ITEM_W)}
              style={s.item}
            >
              <Text style={[s.label, { color: on ? CP.white : CP.silverDim }]}>{MODE_LABEL[mode]}</Text>
              <View style={[s.dot, { backgroundColor: on ? CP.white : 'transparent' }]} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { height: 40, alignSelf: 'stretch' },
  item: { width: ITEM_W, alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: { fontFamily: FONT.bold, fontSize: 15, letterSpacing: 0.4 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});
