/**
 * Sign-up agreement: an explicit checkbox for the Terms of Service and
 * Community Guidelines with the Privacy Policy acknowledgement. Account
 * creation buttons stay disabled until it is checked, and the agreed version
 * is recorded on the account once it exists (see lib/legalConsent.ts).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { haptics } from '@/lib/haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';

export function LegalConsent({
  checked,
  onChange,
  showError = false,
  style,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Highlight the box after someone tries to continue without agreeing. */
  showError?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const link = (label: string, route: string) => (
    <Text
      style={[styles.link, { color: theme.text }]}
      onPress={() => router.push(route as never)}
      accessibilityRole="link"
      suppressHighlighting
    >
      {label}
    </Text>
  );

  return (
    <View style={style}>
      <Pressable
        onPress={() => { haptics.selection(); onChange(!checked); }}
        style={styles.row}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel="I agree to the Terms of Service and Community Guidelines and acknowledge the Privacy Policy"
        hitSlop={{ top: 6, bottom: 6 }}
        testID="legal-consent-checkbox"
      >
        <View
          style={[
            styles.box,
            { borderColor: showError && !checked ? theme.error : theme.border },
            checked && { backgroundColor: theme.accent, borderColor: theme.accent },
          ]}
        >
          {checked ? <Feather name="check" size={13} color={theme.onAccent} /> : null}
        </View>
        <Text style={[styles.text, { color: theme.muted }]}>
          I agree to the {link('Terms of Service', '/terms')} and {link('Community Guidelines', '/community-guidelines')}, including zero tolerance for abusive or objectionable content, and I’ve read the {link('Privacy Policy', '/privacy')}.
        </Text>
      </Pressable>
      {showError && !checked ? (
        <Text style={[styles.error, { color: theme.error }]}>Please agree to continue.</Text>
      ) : null}
    </View>
  );
}

/**
 * Sign-up: one line of linked text under the account-creation buttons.
 * Continuing is the agreement (no checkbox, no pop-up); the sign-up handlers
 * call rememberPendingConsent() when someone continues, and
 * LegalAcceptanceGate records the version and time once the account exists.
 * The checkbox above remains only for the existing "updated terms" gate.
 */
export function LegalContinueNotice({ style }: { style?: StyleProp<TextStyle> }) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const link = (label: string, route: string) => (
    <Text
      style={[styles.link, { color: theme.text }]}
      onPress={() => router.push(route as never)}
      accessibilityRole="link"
      suppressHighlighting
    >
      {label}
    </Text>
  );
  return (
    <Text style={[styles.notice, { color: theme.muted }, style]} testID="legal-consent-line">
      By continuing you agree to our {link('Terms', '/terms')}, {link('Privacy Policy', '/privacy')} and {link('Community Guidelines', '/community-guidelines')}.
    </Text>
  );
}

const styles = StyleSheet.create({
  notice: { fontFamily: FONT.regular, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 4 },
  box: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', marginTop: 0,
  },
  text: { flex: 1, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19 },
  link: { fontFamily: FONT.semibold, textDecorationLine: 'underline' },
  error: { fontFamily: FONT.medium, fontSize: 12, marginTop: 6, marginLeft: 34 },
});
