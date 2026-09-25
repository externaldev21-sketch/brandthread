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

        <Button
          label="Try Again"
          onPress={handleRestart}
          variant="primary"
          style={styles.button}
        />
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
    position: 'absolute',
    right: SPACING.md,
    zIndex: 10,
  },
  button: {
    marginTop: SPACING.xs,
    minWidth: 200,
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
