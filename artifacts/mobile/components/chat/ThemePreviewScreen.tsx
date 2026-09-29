/**
 * Full-screen "Previewing [Theme Name]" — Instagram DM's "Changing theme"
 * flow (mobbin.com/screens/7d276c82-caa4-4b53-b442-e03657240fd4 /
 * 8f3cbab8-57f8-4ab6-a9c2-1b0631274c0d): sample sent/received bubbles
 * rendered in the candidate theme, "Tap Apply to choose this theme or
 * Cancel to preview others" copy, Cancel / Apply. Skin swap: Instagram's
 * colored Apply button → the shared `Button` component's primary white pill
 * (never theme-colored, never Instagram blue).
 */
import React from 'react';
import { View, Text, StyleSheet, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import type { ConversationTheme } from '@/lib/conversationThemes';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';

export function ThemePreviewScreen({
  visible, theme, candidate, applying, onCancel, onApply,
}: {
  visible: boolean;
  theme: AppThemePreset;
  candidate: ConversationTheme | null;
  applying: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const insets = useSafeAreaInsets();
  const topPad = useHeaderTopInset();
  if (!candidate) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={[s.root, { backgroundColor: candidate.gradient[0] }]}>
        <View style={[s.overlay, { backgroundColor: candidate.gradient[1] + '55' }]} />
        <Text style={[s.title, { color: candidate.receivedText, paddingTop: topPad + SP.md }]} testID="theme-preview-title">
          Previewing {candidate.name}
        </Text>

        <View style={s.bubbleCol}>
          <View style={[s.bubble, s.bubbleReceived, { backgroundColor: candidate.receivedBubble }]}>
            <Text style={[s.bubbleText, { color: candidate.receivedText }]}>Every theme creates a unique experience.</Text>
          </View>
          <View style={[s.bubble, s.bubbleReceived, { backgroundColor: candidate.receivedBubble }]}>
            <Text style={[s.bubbleText, { color: candidate.receivedText }]}>You'll see the messages you send in this color.</Text>
          </View>
          <View style={[s.bubble, s.bubbleSent, { backgroundColor: candidate.sentBubble }]}>
            <Text style={[s.bubbleText, { color: candidate.sentText }]}>And the messages you receive from other people in this color.</Text>
          </View>
          <View style={[s.bubble, s.bubbleSent, { backgroundColor: candidate.sentBubble }]}>
            <Text style={[s.bubbleText, { color: candidate.sentText }]}>Tap Apply to choose this theme or Cancel to preview others.</Text>
          </View>
        </View>

        <View style={[s.footer, { paddingBottom: insets.bottom + SP.md }]}>
          <Button label="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} testID="theme-preview-cancel" />
          <Button label="Apply" variant="primary" onPress={onApply} loading={applying} style={{ flex: 1 }} testID="theme-preview-apply" />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  title: { fontFamily: FONT.semibold, fontSize: FS.md, textAlign: 'center', paddingHorizontal: SP.md },
  bubbleCol: { flex: 1, justifyContent: 'center', gap: SP.sm, paddingHorizontal: SP.lg },
  bubble: { maxWidth: '80%', borderRadius: RADIUS.lg, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  bubbleReceived: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleSent: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubbleText: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },
  footer: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.sm },
});
