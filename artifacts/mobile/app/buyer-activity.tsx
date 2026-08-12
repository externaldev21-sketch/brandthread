/**
 * Your Activity — buyer activity dashboard
 */
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, FONT, FS, SP, RADIUS } from '@/lib/theme';

type ActivitySection = {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  items: { label: string; value: string; action?: string }[];
};

const SECTIONS: ActivitySection[] = [
  {
    title: 'Interactions', icon: 'heart',
    items: [
      { label: 'Posts you liked', value: '47 posts', action: 'unlike' },
      { label: 'Comments you left', value: '12 comments', action: 'delete' },
      { label: 'Posts you reposted', value: '8 reposts', action: 'remove' },
      { label: 'Posts you saved', value: '34 saved' },
    ],
  },
  {
    title: 'Search and browsing', icon: 'search',
    items: [
      { label: 'Search history', value: '28 searches', action: 'clear' },
      { label: 'Recently viewed', value: '15 products' },
      { label: 'Links you visited', value: '6 links' },
    ],
  },
  {
    title: 'Account history', icon: 'clock',
    items: [
      { label: 'Account created', value: 'Jan 2026' },
      { label: 'Last profile update', value: '2 days ago' },
      { label: 'Password last changed', value: 'Never' },
    ],
  },
  {
    title: 'Time', icon: 'watch',
    items: [
      { label: 'Today', value: '23 min' },
      { label: 'This week', value: '2h 41min' },
      { label: 'Daily average', value: '38 min' },
    ],
  },
];

const ACTION_LABELS: Record<string, string> = {
  unlike: 'Unlike all',
  delete: 'Delete all',
  remove: 'Remove all',
  clear: 'Clear all',
};

export default function BuyerActivityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleAction = (label: string, action: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      ACTION_LABELS[action],
      `${ACTION_LABELS[action]} ${label.toLowerCase()}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: ACTION_LABELS[action], style: 'destructive', onPress: () => {} },
      ],
    );
  };

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={styles.title}>Your activity</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 48 }}
        showsVerticalScrollIndicator={false}
      >
        {SECTIONS.map(section => (
          <View key={section.title} style={styles.group}>
            <View style={styles.groupHeader}>
              <Feather name={section.icon} size={15} color={PURPLE} />
              <Text style={styles.groupTitle}>{section.title}</Text>
            </View>
            <View style={styles.card}>
              {section.items.map((item, i) => (
                <React.Fragment key={item.label}>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    <View style={styles.rowRight}>
                      <Text style={styles.rowValue}>{item.value}</Text>
                      {item.action && (
                        <TouchableOpacity
                          onPress={() => handleAction(item.label, item.action!)}
                          style={styles.actionBtn}
                        >
                          <Text style={styles.actionText}>{ACTION_LABELS[item.action]}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                  {i < section.items.length - 1 && <View style={styles.divider} />}
                </React.Fragment>
              ))}
            </View>
          </View>
        ))}

        <View style={styles.group}>
          <Text style={styles.footerNote}>
            Activity data is stored locally on your device. Clearing does not affect your account on other devices.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  header: {
    height: 58, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  group: { marginBottom: SP.lg },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SP.sm },
  groupTitle: { color: MUTED, fontFamily: FONT.semibold, fontSize: FS.sm },
  card: {
    backgroundColor: CARD, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: BORDER },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 14, gap: 10,
  },
  rowLabel: { color: FG, fontFamily: FONT.medium, fontSize: 14, flex: 1 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowValue: { color: MUTED, fontFamily: FONT.regular, fontSize: 13 },
  actionBtn: { paddingVertical: 2 },
  actionText: { color: PURPLE, fontFamily: FONT.medium, fontSize: 12 },
  footerNote: {
    color: SUBTLE, fontFamily: FONT.regular, fontSize: 12,
    lineHeight: 18, textAlign: 'center', paddingHorizontal: SP.md,
  },
});
