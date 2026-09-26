/**
 * Brandthread Design System — OptionSheet (Phase 1)
 *
 * A grouped radio-list picker in a bottom sheet: title, optional description,
 * one row per option (icon, label, optional description, trailing check).
 * Replaces `Alert.alert(...)` button-list pickers used for settings like
 * "Profile visibility" or "Who can message you" — those render as a native
 * OS alert with Title Case buttons and no room for a description, unlike the
 * grouped, sentence-case picker sheets every reference app uses (Mobbin:
 * AllTrails "List privacy level", X "Who sees this").
 *
 * Usage:
 *   <OptionSheet
 *     visible={pickerOpen}
 *     onClose={() => setPickerOpen(false)}
 *     title="Who can message you"
 *     options={[{ id: 'everyone', label: 'Everyone', description: '…' }, …]}
 *     selectedId={dmPrivacy}
 *     onSelect={(id) => { setDmPrivacy(id); setPickerOpen(false); }}
 *   />
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { hapticLight } from '@/lib/haptics';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ListRow } from '@/components/ui/ListRow';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';

export interface OptionSheetOption {
  id: string;
  label: string;
  description?: string;
  icon?: keyof typeof Feather.glyphMap;
}

export interface OptionSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  options: OptionSheetOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  testID?: string;
}

export function OptionSheet({ visible, onClose, title, description, options, selectedId, onSelect, testID }: OptionSheetProps) {
  const palette = useColors();

  return (
    <BottomSheet visible={visible} onClose={onClose} testID={testID}>
      <View style={styles.header}>
        <Text style={[TYPE_SCALE.headline, { color: palette.foreground }]}>{title}</Text>
        {description ? (
          <Text style={[TYPE_SCALE.footnote, { color: palette.mutedForeground, marginTop: 4 }]}>{description}</Text>
        ) : null}
      </View>
      <View style={styles.list}>
        {options.map((opt, i) => (
          <React.Fragment key={opt.id}>
            <ListRow
              icon={opt.icon}
              title={opt.label}
              subtitle={opt.description}
              right={opt.id === selectedId ? <Feather name="check" size={18} color={palette.accent} /> : undefined}
              onPress={() => { hapticLight(); onSelect(opt.id); }}
              testID={`${testID ?? 'option-sheet'}-${opt.id}`}
            />
            {i < options.length - 1 && <View style={[styles.divider, { backgroundColor: palette.border }]} />}
          </React.Fragment>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  list: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  divider: { height: StyleSheet.hairlineWidth },
});
