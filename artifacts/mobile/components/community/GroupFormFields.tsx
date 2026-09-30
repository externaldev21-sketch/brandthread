/** Shared fields for creating / editing a group: photo, name, description, Public vs Private, approval. */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { HapticSwitch, PressableScale } from '@/components/BrandthreadUI';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { CommunityAvatar } from '@/components/community/CommunityAvatar';
import { useColors } from '@/hooks/useColors';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { DESCRIPTION_MAX, NAME_MAX } from '@/lib/communities/validation';
import type { CommunityVisibility } from '@/lib/communities/types';
import { COMP, FONT, FS, RADIUS, SP } from '@/lib/theme';

export interface GroupFormValue {
  name: string;
  description: string;
  visibility: CommunityVisibility;
  requireApproval: boolean;
  /** Local preview uri or hosted url of the chosen photo. */
  photoUri?: string;
}

export interface GroupFormErrors { name?: string | null; description?: string | null; photo?: string | null }

interface Props {
  value: GroupFormValue;
  onChange: (patch: Partial<GroupFormValue>) => void;
  errors?: GroupFormErrors;
  uploading?: boolean;
  onPickPhoto: () => void;
  onRemovePhoto: () => void;
  /** Hide Public/Private + approval (official groups are never edited here). */
  hideVisibility?: boolean;
}

export function GroupFormFields({ value, onChange, errors = {}, uploading, onPickPhoto, onRemovePhoto, hideVisibility }: Props) {
  const colors = useColors();
  const field = [styles.field, { backgroundColor: colors.card, color: colors.foreground }, WEB_INPUT_RESET];
  return (
    <View style={{ gap: SP.md }}>
      <View style={styles.photoRow}>
        <PressableScale onPress={onPickPhoto} disabled={uploading} accessibilityRole="button" accessibilityLabel="Choose group photo">
          <View>
            {value.photoUri ? (
              <CommunityAvatar community={{ name: value.name || 'Group', iconUrl: value.photoUri }} size={84} />
            ) : (
              <View style={[styles.photoEmpty, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="camera" size={24} color={colors.mutedForeground} />
              </View>
            )}
            {uploading ? (
              <View style={[StyleSheet.absoluteFill, styles.photoBusy, { backgroundColor: colors.background + 'B3' }]}>
                <ActivityIndicator color={colors.foreground} />
              </View>
            ) : null}
          </View>
        </PressableScale>
        <View style={{ flex: 1, gap: 2 }}>
          <PressableScale onPress={onPickPhoto} disabled={uploading} style={styles.textBtn} accessibilityRole="button">
            <Text style={[styles.textBtnLabel, { color: colors.foreground }]}>{value.photoUri ? 'Change photo' : 'Add a photo'}</Text>
          </PressableScale>
          {value.photoUri ? (
            <PressableScale onPress={onRemovePhoto} disabled={uploading} style={styles.textBtn} accessibilityRole="button">
              <Text style={[styles.textBtnLabel, { color: colors.mutedForeground }]}>Remove</Text>
            </PressableScale>
          ) : null}
        </View>
      </View>
      {errors.photo ? <Text style={[styles.note, { color: colors.mutedForeground }]}>{errors.photo}</Text> : null}

      <View style={{ gap: 6 }}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: colors.foreground }]}>Group name</Text>
          <Text style={[styles.count, { color: colors.mutedForeground }]}>{value.name.trim().length}/{NAME_MAX}</Text>
        </View>
        <TextInput
          value={value.name}
          onChangeText={(name) => onChange({ name })}
          placeholder="Graphic Design Community"
          placeholderTextColor={colors.subtle}
          maxLength={NAME_MAX + 10}
          style={field}
          accessibilityLabel="Group name"
          returnKeyType="next"
        />
        {errors.name ? <Text style={[styles.note, { color: colors.mutedForeground }]}>{errors.name}</Text> : null}
      </View>

      <View style={{ gap: 6 }}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: colors.foreground }]}>Description</Text>
          <Text style={[styles.count, { color: colors.mutedForeground }]}>{value.description.length}/{DESCRIPTION_MAX}</Text>
        </View>
        <TextInput
          value={value.description}
          onChangeText={(description) => onChange({ description })}
          placeholder="What is this group about?"
          placeholderTextColor={colors.subtle}
          multiline
          maxLength={DESCRIPTION_MAX + 20}
          style={[...field, styles.multiline]}
          accessibilityLabel="Group description"
        />
        {errors.description ? <Text style={[styles.note, { color: colors.mutedForeground }]}>{errors.description}</Text> : null}
      </View>

      {hideVisibility ? null : (
        <View style={{ gap: SP.sm }}>
          <Text style={[styles.label, { color: colors.foreground }]}>Who can join</Text>
          <SegmentedControl
            options={[{ id: 'public', label: 'Public' }, { id: 'private', label: 'Private' }]}
            selectedId={value.visibility}
            onChange={(id) => onChange({ visibility: id as CommunityVisibility })}
          />
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {value.visibility === 'public'
              ? 'Listed in Community search. Anyone can join.'
              : 'Only people with your invite link or QR code can join, or ask to.'}
          </Text>
          {value.visibility === 'private' ? (
            <View style={[styles.toggleRow, { backgroundColor: colors.card }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.toggleTitle, { color: colors.foreground }]}>Approve new members</Text>
                <Text style={[styles.note, { color: colors.mutedForeground, marginTop: 2 }]}>
                  Admins review each request before someone joins.
                </Text>
              </View>
              <HapticSwitch
                value={value.requireApproval}
                onValueChange={(requireApproval) => onChange({ requireApproval })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.background}
                accessibilityLabel="Approve new members"
              />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  photoEmpty: { width: 84, height: 84, borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  photoBusy: { borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  textBtn: { minHeight: COMP.minTouchTarget, justifyContent: 'center' },
  textBtnLabel: { fontFamily: FONT.semibold, fontSize: FS.base },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontFamily: FONT.semibold, fontSize: FS.base },
  count: { fontFamily: FONT.regular, fontSize: FS.meta },
  field: { minHeight: COMP.inputH, borderRadius: RADIUS.md, paddingHorizontal: SP.md, fontFamily: FONT.regular, fontSize: FS.base },
  multiline: { minHeight: 96, paddingTop: SP.md - 2, textAlignVertical: 'top' },
  note: { fontFamily: FONT.regular, fontSize: FS.meta, lineHeight: 17 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, padding: SP.md, borderRadius: RADIUS.md },
  toggleTitle: { fontFamily: FONT.semibold, fontSize: FS.base },
});
