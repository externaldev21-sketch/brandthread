/**
 * Flows a vertical stack of cards into side-by-side columns inside the
 * desktop web shell, when the content column is wide enough; everywhere else
 * it renders its children exactly as given (no wrapper at all), so phone and
 * tablet layouts are untouched.
 *
 * Cards are dealt left-to-right in their original order into independent
 * columns (not rows), so a tall card never leaves a gap beside a short one.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SP } from '@/lib/theme';
import { useDesktopShell } from './DesktopShellContext';

/** Narrower than this, a desktop content column keeps one stack. */
const MIN_TWO_COLUMN_WIDTH = 900;

export function DesktopColumns({ children, columns = 2 }: { children: React.ReactNode; columns?: number }) {
  const shell = useDesktopShell();
  if (!shell || shell.contentWidth < MIN_TWO_COLUMN_WIDTH) return <>{children}</>;
  const items = React.Children.toArray(children).filter(React.isValidElement);
  const stacks = Array.from({ length: columns }, (_, col) => items.filter((_, i) => i % columns === col));
  return (
    <View style={styles.row} testID="desktop-columns">
      {stacks.map((stack, col) => (
        <View key={col} style={styles.column}>{stack}</View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.lg },
  column: { flex: 1, minWidth: 0 },
});
