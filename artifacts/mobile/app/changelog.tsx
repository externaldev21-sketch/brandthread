/**
 * Change log — release notes for the app (Settings → Resources → Change log).
 * Replaces a link to brandthread.app/changelog, which never existed; on the
 * web that URL now lands here too.
 */
import React, { useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { BrandthreadCard, EmptyState, SectionHeader } from '@/components/BrandthreadUI';
import { FONT, FS, SP } from '@/lib/theme';
import { sortedChangelog } from '@/lib/changelog';

export default function ChangelogScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const entries = sortedChangelog();
  const version = Constants.expoConfig?.version ?? null;

  return (
    <View style={s.root}>
      <ScreenHeader title="Change log" />
      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: 100, gap: SP.lg }} showsVerticalScrollIndicator={false}>
        {version ? <Text style={s.version} testID="changelog-version">You're on version {version}</Text> : null}

        {entries.length === 0 ? (
          <EmptyState
            icon="git-merge"
            title="No release notes yet"
            description="Notes for each update will be listed here."
            testID="changelog-empty"
          />
        ) : (
          entries.map((entry) => (
            <View key={`${entry.version}-${entry.date}`} style={{ gap: SP.sm }}>
              <SectionHeader title={`Version ${entry.version} · ${entry.date}`} />
              <BrandthreadCard style={{ gap: SP.xs }}>
                {entry.notes.map((note) => (
                  <Text key={note} style={s.note}>• {note}</Text>
                ))}
              </BrandthreadCard>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  version: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted },
  note: { fontFamily: FONT.regular, fontSize: FS.md, color: theme.text, lineHeight: 22 },
});
