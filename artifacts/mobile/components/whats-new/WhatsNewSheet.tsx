/**
 * "What's new" sheet, copied from Brink's "Latest Changes" sheet
 * (https://mobbin.com/screens/6ce682e7-7484-4653-b71d-262d30544ea7):
 * app icon, "What's new in Brandthread", the version under it, one row per
 * change (icon, bold title, one grey line) and a full-width Continue button.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import type { WhatsNewNotes } from '@/content/whatsNew';

const APP_ICON = require('../../assets/images/icon.png');

export function WhatsNewSheet({ visible, notes, onClose }: {
  visible: boolean;
  notes: WhatsNewNotes;
  onClose: () => void;
}) {
  const palette = useColors();
  const version = Constants.expoConfig?.version;

  return (
    <BottomSheet visible={visible} onClose={onClose} testID="whats-new-sheet">
      <View style={styles.body}>
        <Image source={APP_ICON} style={styles.icon} contentFit="cover" accessibilityIgnoresInvertColors />
        <Text style={[TYPE_SCALE.title2, styles.title, { color: palette.text }]} accessibilityRole="header">
          What's new in Brandthread
        </Text>
        {version ? (
          <Text style={[TYPE_SCALE.footnote, styles.version, { color: palette.mutedForeground }]}>Version {version}</Text>
        ) : null}

        <View style={styles.list}>
          {notes.items.map((item) => (
            <View key={item.title} style={styles.row}>
              <Feather name={item.icon} size={26} color={palette.text} style={styles.rowIcon} />
              <View style={styles.rowText}>
                <Text style={[TYPE_SCALE.headline, { color: palette.text }]}>{item.title}</Text>
                <Text style={[TYPE_SCALE.footnote, { color: palette.mutedForeground, marginTop: 2 }]}>{item.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <Button label="Continue" onPress={onClose} fullWidth testID="whats-new-continue" />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.sm, alignItems: 'center' },
  icon: { width: 72, height: 72, borderRadius: 16 },
  title: { marginTop: SPACING.md, textAlign: 'center' },
  version: { marginTop: SPACING.xs, textAlign: 'center' },
  list: { alignSelf: 'stretch', marginTop: SPACING.lg, marginBottom: SPACING.lg, gap: SPACING.lg },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  rowIcon: { width: 32, marginRight: SPACING.md, marginTop: 2 },
  rowText: { flex: 1 },
});
