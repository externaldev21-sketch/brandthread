/**
 * Centered system line in the thread — Instagram DM's "You changed the
 * theme to [Name]. Change" / "You turned on/off disappearing messages.
 * Change"/"Turn on" pattern (mobbin.com/flows/7bcc8b1f-13b7-4656-bb0f-
 * fd5a4fa75108). Not a bubble: plain centered gray text with one tappable
 * word at the end, matching Instagram's own treatment exactly (copy
 * structure kept, "Instagram" itself never appears since these lines never
 * name the app).
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { getConversationTheme } from '@/lib/conversationThemes';
import { FONT, FS, SP } from '@/lib/theme';

/** The minimal shape this component needs — accepts either conversation
 *  screen's own Message-ish type without forcing them onto one shared type. */
export interface SystemLineMessage {
  fromName: string;
  attachment?: { title?: string; meta?: Record<string, string> };
}

export function SystemLine({
  msg, isOwn, theme, onOpenThemePicker, onQuickToggleDisappearing,
}: {
  msg: SystemLineMessage;
  isOwn: boolean;
  theme: AppThemePreset;
  onOpenThemePicker: () => void;
  onQuickToggleDisappearing: () => void;
}) {
  const who = isOwn ? 'You' : (msg.fromName || 'They');
  const kind = msg.attachment?.title;

  if (kind === 'theme_changed') {
    const name = getConversationTheme(msg.attachment?.meta?.themeId)?.name ?? 'Default';
    return (
      <View style={s.wrap} testID="system-line-theme">
        <Text style={[s.text, { color: theme.muted }]}>
          {who} changed the theme to {name}.{' '}
          <Text onPress={onOpenThemePicker} style={[s.link, { color: theme.text }]}>Change</Text>
        </Text>
      </View>
    );
  }

  if (kind === 'disappearing_on') {
    return (
      <View style={s.wrap} testID="system-line-disappearing-on">
        <Text style={[s.text, { color: theme.muted }]}>
          {who} turned on disappearing messages. New messages will disappear after they've been seen.{' '}
          <Text onPress={onQuickToggleDisappearing} style={[s.link, { color: theme.text }]}>Change</Text>
        </Text>
      </View>
    );
  }

  if (kind === 'disappearing_off') {
    return (
      <View style={s.wrap} testID="system-line-disappearing-off">
        <Text style={[s.text, { color: theme.muted }]}>
          {who} turned off disappearing messages.{' '}
          <Text onPress={onQuickToggleDisappearing} style={[s.link, { color: theme.text }]}>Turn on</Text>
        </Text>
      </View>
    );
  }

  return null;
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: SP.xl, paddingVertical: SP.sm, alignItems: 'center' },
  text: { fontFamily: FONT.regular, fontSize: FS.xs, textAlign: 'center', lineHeight: 16 },
  link: { fontFamily: FONT.semibold },
});
