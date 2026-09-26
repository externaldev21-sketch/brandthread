import React, { useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
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
};

export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [isModalVisible, setIsModalVisible] = useState(false);

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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {__DEV__ ? (
        <IconButton
          name="alert-circle"
          onPress={() => setIsModalVisible(true)}
          accessibilityLabel="View error details"
          color={colors.foreground}
          style={[styles.topButton, { top: insets.top + SPACING.md }]}
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
          Please reload the app to continue.
        </Text>
        {__DEV__ ? (
          <Text style={[TYPE_SCALE.footnote, styles.devMessage, { color: colors.mutedForeground }]}>
            {error.message}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            label="Try Again"
            onPress={handleRestart}
            variant="primary"
            style={styles.button}
          />
          <View style={styles.secondaryRow}>
            <Button
              label="Go back"
              onPress={() => {
                if (router.canGoBack()) goBackOr(router);
                else router.replace('/' as never);
              }}
              variant="secondary"
              style={styles.halfButton}
            />
            <Button
              label="Go home"
              onPress={() => router.replace('/' as never)}
              variant="secondary"
              style={styles.halfButton}
            />
          </View>
        </View>
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
  devMessage: {
    textAlign: 'center',
    maxWidth: 320,
  },
  topButton: {
    // Clear of the centered icon/title block above at any screen height —
    // pinned to the top-right corner rather than floating near the content.
    position: 'absolute',
    right: SPACING.md,
    zIndex: 10,
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
  secondaryRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    width: '100%',
    maxWidth: 320,
  },
  halfButton: {
    flex: 1,
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
