import React, { useState } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { reloadAppAsync } from 'expo';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { FONT } from '@/lib/theme';

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
  /**
   * 'app' (default) — the root, whole-app boundary: "Try again" reloads the
   * app, since the provider tree itself may be what broke.
   * 'screen' — a per-screen / per-tab boundary (Expo Router's
   * `unstable_screenErrorBoundary`): "Try again" re-renders just the failed
   * screen via `resetError` (the router's `retry`), content respects the
   * safe area, and a back arrow is shown whenever there is somewhere to go
   * back to, so the user is never stuck on a crashed screen.
   */
  scope?: 'app' | 'screen';
};

function safeCanGoBack(): boolean {
  try {
    return router.canGoBack();
  } catch {
    return false;
  }
}

export function ErrorFallback({ error, resetError, scope = 'app' }: ErrorFallbackProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isScreen = scope === 'screen';
  const canGoBack = isScreen && safeCanGoBack();

  const [isModalVisible, setIsModalVisible] = useState(false);

  const handleRetry = () => {
    if (isScreen) {
      resetError();
      return;
    }
    void handleRestart();
  };

  const handleRestart = async () => {
    try {
      await reloadAppAsync();
    } catch (restartError) {
      console.error('Failed to restart app:', restartError);
      resetError();
    }
  };

  const formatErrorDetails = (): string => {
    let details = `Error: ${error.message}\n\n`;
    if (error.stack) {
      details += `Stack Trace:\n${error.stack}`;
    }
    return details;
  };

  const monoFont = Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  });

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background },
        isScreen
          ? { paddingTop: insets.top + SPACING.xl, paddingBottom: insets.bottom + SPACING.xl }
          : null,
      ]}
    >
      {canGoBack ? (
        <IconButton
          name="arrow-left"
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          color={colors.foreground}
          variant="plain"
          style={[styles.backButton, { top: insets.top + SPACING.xs }]}
          testID="error-fallback-back"
        />
      ) : null}
      <View style={styles.content}>
        <View style={[styles.iconCircle, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="alert-triangle" size={28} color={colors.mutedForeground} />
        </View>

        <Text style={[TYPE_SCALE.title1, styles.title, { color: colors.foreground }]}>
          Something went wrong
        </Text>

        <Text style={[TYPE_SCALE.body, styles.message, { color: colors.mutedForeground }]}>
          Please try again, or head back home.
        </Text>

        <View style={styles.actions}>
          <Button
            label="Try again"
            onPress={handleRetry}
            testID="error-fallback-retry"
            variant="primary"
            style={styles.button}
          />
          <Button
            label="Go home"
            onPress={() => router.replace('/' as never)}
            variant="tertiary"
            style={styles.button}
          />
        </View>

        {/* Raw error text/stack trace is never shown by default — only in
            __DEV__, and only behind this explicit tap, per the standard
            every other error surface in the app follows. */}
        {__DEV__ ? (
          <Button
            label="Details"
            onPress={() => setIsModalVisible(true)}
            variant="tertiary"
            size="compact"
            style={styles.detailsButton}
            accessibilityLabel="View error details"
          />
        ) : null}
      </View>

      {__DEV__ ? (
        <Modal
          visible={isModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setIsModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.modalContainer,
                { backgroundColor: colors.background },
              ]}
            >
              <View
                style={[
                  styles.modalHeader,
                  { borderBottomColor: colors.border },
                ]}
              >
                <Text style={[TYPE_SCALE.headline, { color: colors.foreground }]}>
                  Error Details
                </Text>
                <IconButton
                  name="x"
                  onPress={() => setIsModalVisible(false)}
                  accessibilityLabel="Close error details"
                  color={colors.foreground}
                  variant="plain"
                />
              </View>

              <ScrollView
                style={styles.modalScrollView}
                contentContainerStyle={[
                  styles.modalScrollContent,
                  { paddingBottom: insets.bottom + SPACING.md },
                ]}
                showsVerticalScrollIndicator
              >
                <View
                  style={[
                    styles.errorContainer,
                    { backgroundColor: colors.card },
                  ]}
                >
                  <Text
                    style={[
                      TYPE_SCALE.footnote,
                      styles.errorText,
                      {
                        color: colors.foreground,
                        fontFamily: monoFont,
                      },
                    ]}
                    selectable
                  >
                    {formatErrorDetails()}
                  </Text>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  backButton: {
    position: 'absolute',
    left: SPACING.md,
    zIndex: 1,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    width: '100%',
    maxWidth: 600,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xxs,
  },
  title: {
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  button: {
    minWidth: 200,
  },
  detailsButton: {
    marginTop: SPACING.xs,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    width: '100%',
    height: '90%',
    borderTopLeftRadius: RADII.sheet,
    borderTopRightRadius: RADII.sheet,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalScrollView: {
    flex: 1,
  },
  modalScrollContent: {
    padding: SPACING.md,
  },
  errorContainer: {
    width: '100%',
    borderRadius: RADII.chip,
    overflow: 'hidden',
    padding: SPACING.md,
  },
  errorText: {
    fontFamily: FONT.regular,
    width: '100%',
  },
});
