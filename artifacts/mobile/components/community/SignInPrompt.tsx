/** Calm "Sign in to join" card for signed-out / preview visitors. Routes into the app's normal sign-in flow. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export function SignInPrompt({ message = 'Sign in to join groups and chat with the community.', onBeforeNavigate }: { message?: string; onBeforeNavigate?: () => void | Promise<void> }) {
  const colors = useColors();
  const router = useRouter();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.text, { color: colors.foreground }]}>{message}</Text>
      <Button
        label="Sign in"
        size="small"
        variant="secondary"
        onPress={async () => {
          try { await onBeforeNavigate?.(); } catch { /* stash is best-effort */ }
          router.push('/sign-in' as never);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS.lg, padding: SP.md, gap: SP.sm, alignItems: 'flex-start' },
  text: { fontFamily: FONT.medium, fontSize: FS.base, lineHeight: 21 },
});
