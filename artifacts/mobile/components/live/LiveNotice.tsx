/**
 * The one centered message the LIVE screens use when there is nothing to
 * watch — "LIVE isn't available yet" (no Agora key on the server) and
 * "No one's live right now". Whatnot's Shows empty state: a bold two-line
 * title and one muted line under it, nothing else competing with it.
 * https://mobbin.com/flows/c5bfc22c-2e3b-40f2-8172-00ab1c0a0cbe
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, MEDIA, SP } from '@/lib/theme';

export function LiveNotice({
  title, body, actionLabel, onAction, testID, tone = 'theme',
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
  /** `dark` for screens that are always black (the viewer, the camera). */
  tone?: 'theme' | 'dark';
}) {
  const { theme } = useAppTheme();
  const text = tone === 'dark' ? MEDIA.fg : theme.text;
  const muted = tone === 'dark' ? MEDIA.fgMuted : theme.muted;
  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={[styles.title, { color: text }]}>{title}</Text>
      <Text style={[styles.body, { color: muted }]}>{body}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8} style={styles.action}>
          <Text style={[styles.actionText, { color: muted }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: SP.xl, gap: SP.sm },
  title: { fontFamily: FONT.bold, fontSize: FS.md, lineHeight: 22, textAlign: 'center', maxWidth: 260 },
  body: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, textAlign: 'center', maxWidth: 300 },
  action: { marginTop: SP.xs, paddingVertical: SP.xs },
  actionText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
