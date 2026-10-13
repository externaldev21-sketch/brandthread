/**
 * KeyboardStickyFooter: a form's primary button pinned to the bottom of the
 * screen that rides up on top of the keyboard while you type (less-AI pass,
 * item 105). The reference is Depop's "Sell an item": "Save to drafts" /
 * "Post listing" stay pinned at the bottom and sit right above the keyboard.
 *
 * Uses react-native-keyboard-controller's KeyboardStickyView (the app's
 * root KeyboardProvider is already mounted in app/_layout.tsx). When the
 * native module isn't in the client (older Expo Go), it falls back to a
 * plain footer pinned above the home indicator, which still never sits
 * inside the scroll content.
 */
import React from 'react';
import { NativeModules, Platform, StyleSheet, TurboModuleRegistry, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SP } from '@/lib/theme';

type StickyViewProps = React.PropsWithChildren<{ offset?: { closed?: number; opened?: number } }>;

let stickyView: React.ComponentType<StickyViewProps> | null | undefined;
function getStickyView(): React.ComponentType<StickyViewProps> | null {
  if (stickyView !== undefined) return stickyView;
  const available = Platform.OS === 'web'
    || NativeModules.KeyboardController
    || TurboModuleRegistry.get('KeyboardController');
  if (!available) return (stickyView = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    stickyView = (require('react-native-keyboard-controller') as { KeyboardStickyView?: React.ComponentType<StickyViewProps> }).KeyboardStickyView ?? null;
  } catch {
    stickyView = null;
  }
  return stickyView;
}

export function KeyboardStickyFooter({ children, style, testID }: React.PropsWithChildren<{ style?: StyleProp<ViewStyle>; testID?: string }>) {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const Sticky = getStickyView();
  const bottom = Math.max(insets.bottom, SP.md);
  const footer = (
    <View testID={testID} style={[styles.footer, { paddingBottom: bottom, backgroundColor: theme.background }, style]}>
      {children}
    </View>
  );
  // With the keyboard up the home-indicator padding isn't needed, so the
  // footer drops by it and the button sits SP.md above the keyboard.
  return Sticky ? <Sticky offset={{ closed: 0, opened: bottom - SP.md }}>{footer}</Sticky> : footer;
}

const styles = StyleSheet.create({
  footer: { paddingHorizontal: SP.md, paddingTop: SP.sm },
});
