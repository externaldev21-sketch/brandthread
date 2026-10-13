/**
 * Brandthread Design System — OptionSheet (Phase 1)
 *
 * A grouped radio-list picker in a bottom sheet: title, optional description,
 * one row per option (icon, label, optional description, trailing radio).
 * Rows copy Instagram's picker sheets (Mobbin: Instagram "Sort by") — an
 * outlined radio on the right that fills when chosen — on the shared
 * `<Sheet>` chrome (left-aligned title, circular close).
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
import { type IconName } from '@/components/ui/Icon';
import { useColors } from '@/hooks/useColors';
import { haptics } from '@/lib/haptics';
import { Sheet, SHEET_GUTTER } from '@/components/ui/BottomSheet';
import { ListRow } from '@/components/ui/ListRow';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';

export interface OptionSheetOption {
  id: string;
  label: string;
  description?: string;
  icon?: IconName;
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
    <Sheet visible={visible} onClose={onClose} title={title} testID={testID} padded={false}>
      {description ? (
        <Text style={[TYPE_SCALE.footnote, styles.description, { color: palette.mutedForeground }]}>{description}</Text>
      ) : null}
      <View style={styles.list}>
        {options.map((opt, i) => (
          <React.Fragment key={opt.id}>
            <ListRow
              icon={opt.icon}
              title={opt.label}
              subtitle={opt.description}
              right={<Radio selected={opt.id === selectedId} color={palette.foreground} />}
              selected={opt.id === selectedId}
              onPress={() => { haptics.selection(); onSelect(opt.id); }}
              testID={`${testID ?? 'option-sheet'}-${opt.id}`}
            />
            {i < options.length - 1 && <View style={[styles.divider, { backgroundColor: palette.border }]} />}
          </React.Fragment>
        ))}
      </View>
    </Sheet>
  );
}

/** Instagram-style radio: an outlined ring, filled with a dot when chosen. */
function Radio({ selected, color }: { selected: boolean; color: string }) {
  return (
    <View
      style={[styles.radio, { borderColor: color }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {selected ? <View style={[styles.radioDot, { backgroundColor: color }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 12, height: 12, borderRadius: 6 },
  description: { paddingHorizontal: SHEET_GUTTER, paddingBottom: SPACING.sm },
  list: { paddingHorizontal: SHEET_GUTTER },
  divider: { height: StyleSheet.hairlineWidth },
});
