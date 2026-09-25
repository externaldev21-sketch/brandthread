/**
 * Sign-up agreement: an explicit checkbox for the Terms of Service and
 * Community Guidelines with the Privacy Policy acknowledgement. Account
 * creation buttons stay disabled until it is checked, and the agreed version
 * is recorded on the account once it exists (see lib/legalConsent.ts).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';

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
        onPress={() => { Haptics.selectionAsync(); onChange(!checked); }}
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
            checked && { backgroundColor: theme.text, borderColor: theme.text },
          ]}
        >
          {checked ? <Feather name="check" size={13} color={theme.background} /> : null}
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 4 },
  box: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', marginTop: 0,
  },
  text: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  link: { fontFamily: 'Inter_600SemiBold', textDecorationLine: 'underline' },
  error: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 6, marginLeft: 34 },
});
