/**
 * Full-height sheet with one message field and one pinned action — used by
 * the freelancer job delivery flow (BT-446):
 *  - freelancer "Deliver work" (optional message),
 *  - hirer "Request revision" (required),
 *  - hirer "Report a problem" (required).
 * Layout follows Fiverr's "Delivery" sheet: close X + centered title, a
 * message box with a character count, the action pinned at the bottom.
 */
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, Platform, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, SP, RADIUS } from '@/lib/theme';

const FIELD_BG = '#1C1C1E';

export type JobNoteSheetProps = {
  visible: boolean;
  title: string;
  /** One line above the field (e.g. revisions left). */
  hint?: string;
  placeholder: string;
  submitLabel: string;
  required?: boolean;
  maxLength?: number;
  busy?: boolean;
  onSubmit: (text: string) => void;
  onClose: () => void;
};

export function JobNoteSheet({
  visible, title, hint, placeholder, submitLabel, required, maxLength = 2000, busy, onSubmit, onClose,
}: JobNoteSheetProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const valid = !required || text.trim().length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.root, { backgroundColor: theme.background, paddingBottom: insets.bottom + SP.md }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, Platform.OS !== 'ios' && { paddingTop: insets.top + SP.sm }]}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.close}
          >
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
          <View style={styles.close} />
        </View>

        <View style={styles.body}>
          {hint ? <Text style={[styles.hint, { color: theme.muted }]}>{hint}</Text> : null}
          <View style={[styles.field, { backgroundColor: FIELD_BG }]}>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              value={text}
              onChangeText={setText}
              placeholder={placeholder}
              placeholderTextColor={theme.subtle}
              multiline
              maxLength={maxLength}
              autoFocus
              accessibilityLabel={title}
            />
            <Text style={[styles.count, { color: theme.subtle }]}>
              {text.length} / {maxLength}
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <PrimaryButton
            label={submitLabel}
            onPress={() => onSubmit(text.trim())}
            disabled={!valid}
            loading={busy}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.sm,
  },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontFamily: FONT.semibold, flex: 1, textAlign: 'center' },
  body: { flex: 1, paddingHorizontal: SP.md, paddingTop: SP.md },
  hint: { fontSize: 15, fontFamily: FONT.regular, marginBottom: SP.sm },
  field: { borderRadius: RADIUS.md, padding: SP.md, minHeight: 200 },
  input: { flex: 1, fontSize: 17, fontFamily: FONT.regular, textAlignVertical: 'top', minHeight: 160 },
  count: { alignSelf: 'flex-end', fontSize: 13, fontFamily: FONT.regular, fontVariant: ['tabular-nums'], marginTop: SP.sm },
  footer: { paddingHorizontal: SP.md, paddingTop: SP.sm },
});
