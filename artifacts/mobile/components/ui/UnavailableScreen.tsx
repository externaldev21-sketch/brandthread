/**
 * Full-screen "nothing to show here" state for a pushed detail screen that
 * was opened without (or with an unknown) id — a deep link, a stale
 * notification, the web preview typing the route directly. Keeps the shared
 * ScreenHeader (bare back arrow + the screen's own title) so the screen never
 * becomes a headless dead end, and shows one shared EmptyState with a single
 * recovery action instead of an endless spinner, a misleading network error,
 * or placeholder identity ("Unknown", "?", "@unknown").
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { goBackOr } from '@/lib/navigation/goBackOr';

export interface UnavailableScreenProps {
  /** Header title — the screen's own name, e.g. "Order details". */
  title: string;
  /** Empty-state heading, e.g. "Order not found". */
  heading: string;
  /** One short sentence saying what happened / what to do. */
  message: string;
  icon?: keyof typeof Feather.glyphMap;
  /** Defaults to "Go back" (pops, or replaces to `fallback`). */
  actionLabel?: string;
  onAction?: () => void;
  /** Where "Go back" lands when there is no history to pop. */
  fallback?: Href;
  testID?: string;
}

export { isMissingParam } from '@/lib/navigation/isMissingParam';

export function UnavailableScreen({
  title,
  heading,
  message,
  icon = 'alert-circle',
  actionLabel = 'Go back',
  onAction,
  fallback = '/',
  testID = 'unavailable-screen',
}: UnavailableScreenProps) {
  const colors = useColors();
  const router = useRouter();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]} testID={testID}>
      <ScreenHeader title={title} onBack={() => goBackOr(router, fallback)} />
      <View style={styles.body}>
        <EmptyState
          icon={icon}
          title={heading}
          message={message}
          actionLabel={actionLabel}
          onAction={onAction ?? (() => goBackOr(router, fallback))}
          testID={`${testID}-state`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', paddingBottom: 96 },
});
