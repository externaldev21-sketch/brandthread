/**
 * The pre-permission sheet for notifications, shown at a meaningful moment
 * (first follow, first order, first message) before the system dialog.
 * Reference: Givingli's contextual nudge sheet
 * (https://mobbin.com/screens/502f2a58-a768-4285-8fdb-8a94a165103f), reskinned
 * black/white/silver without the illustration: title, one line, the primary
 * button, "Not now", and a note that it can be changed in Settings.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet, Button, Icon } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { prePromptCopy, registerPushPrePrompt, type PushPrePromptReason } from '@/lib/pushPrePrompt';

export function PushPrePromptHost() {
  const palette = useColors();
  const [reason, setReason] = useState<PushPrePromptReason | null>(null);
  const resolver = useRef<((accepted: boolean) => void) | null>(null);

  useEffect(() => registerPushPrePrompt((next) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setReason(next);
  })), []);

  const close = (accepted: boolean) => {
    resolver.current?.(accepted);
    resolver.current = null;
    setReason(null);
  };

  const copy = prePromptCopy(reason ?? 'general');
  return (
    <BottomSheet visible={reason !== null} onClose={() => close(false)} testID="push-pre-prompt">
      <View style={styles.body}>
        <Icon name="bell" size={24} color={palette.foreground} />
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{copy.title}</Text>
        <Text style={[styles.text, { color: palette.mutedForeground }]}>{copy.body}</Text>
        <Button label="Turn on notifications" onPress={() => close(true)} fullWidth testID="push-pre-prompt-allow" style={styles.primary} />
        <Button label="Not now" variant="tertiary" onPress={() => close(false)} fullWidth testID="push-pre-prompt-not-now" />
        <Text style={[styles.note, { color: palette.mutedForeground }]}>You can change this anytime in Settings.</Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  title: { ...TEXT.title2, textAlign: 'center', marginTop: SPACING.sm },
  text: { ...TEXT.subhead, textAlign: 'center', marginTop: SPACING.xs },
  primary: { marginTop: SPACING.xl },
  note: { ...TEXT.footnote, textAlign: 'center', marginTop: SPACING.xs },
});
