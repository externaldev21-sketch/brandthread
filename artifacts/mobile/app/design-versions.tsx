/**
 * Design Versions — /design-versions?projectId=…
 *
 * Lists the snapshots created by the canvas's Share → Save version action.
 * Restore writes a snapshot back over the project (after snapshotting the
 * current state so the restore itself can be undone); Duplicate creates a new
 * project from the version's snapshot, not from the project's current state.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Icon as Feather } from '@/components/ui/Icon';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, ORANGE,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, SecondaryButton, EmptyState, StatusBadge,
} from '@/components/BrandthreadUI';
import { createVersion, getVersions, restoreVersion, duplicateVersion } from '@/services/designService';
import { DesignVersion } from '@/services/designTypes';
import { ScreenHeader } from '@/components/ScreenHeader';
import DesignLayerCompositor from '@/components/DesignLayerCompositor';

const THUMB_SIZE = 56;

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' · '
      + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export default function DesignVersionsScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT } = theme;
  const styles = createStyles(theme);
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  const [versions, setVersions]   = useState<DesignVersion[]>([]);
  const [loading, setLoading]     = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    try {
      const list = await getVersions(projectId);
      setVersions([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void loadVersions(); }, [loadVersions]);

  const handleRestore = useCallback((version: DesignVersion) => {
    Alert.alert(
      'Restore version',
      `Replace the current project with "${version.label}"? Its current state is saved as a version first, so you can undo this.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: async () => {
            setRestoring(version.id);
            try {
              await createVersion(version.projectId, 'Before restore', true);
              const restored = await restoreVersion(version.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.replace(`/design-canvas?id=${restored.id}` as never);
            } catch {
              Alert.alert('Could not restore', 'The project was not changed. Please try again.');
              void loadVersions();
            } finally {
              setRestoring(null);
            }
          },
        },
      ]
    );
  }, [router, loadVersions]);

  const handleDuplicate = useCallback(async (version: DesignVersion) => {
    if (duplicating) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDuplicating(version.id);
    try {
      const newProject = await duplicateVersion(version.id);
      router.push(`/design-canvas?id=${newProject.id}` as never);
    } catch {
      Alert.alert('Could not duplicate', 'No new project was created. Please try again.');
    } finally {
      setDuplicating(null);
    }
  }, [router, duplicating]);

  const renderItem = ({ item }: { item: DesignVersion }) => (
    <BrandthreadCard style={styles.versionCard}>
      <View style={styles.versionTop}>
        <DesignLayerCompositor project={item.snapshot} displaySize={THUMB_SIZE} />
        <View style={styles.versionInfo}>
          {item.autoSaved && (
            <StatusBadge label="Auto-saved" variant="info" small />
          )}
          <Text style={styles.versionLabel}>{item.label}</Text>
          <Text style={styles.versionDate}>{formatDate(item.createdAt)}</Text>
        </View>
        {(restoring === item.id || duplicating === item.id) && (
          <ActivityIndicator color={PURPLE} size="small" />
        )}
      </View>
      <View style={styles.versionActions}>
        <TouchableOpacity
          onPress={() => handleRestore(item)}
          style={styles.actionBtn}
          activeOpacity={0.8}
          disabled={restoring !== null}
          accessibilityRole="button"
          accessibilityLabel={`Restore ${item.label}`}
          testID={`design-version-restore-${item.id}`}
        >
          <Feather name="rotate-ccw" size={14} color={PURPLE_LIGHT} />
          <Text style={[styles.actionText, { color: PURPLE_LIGHT }]}>Restore</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleDuplicate(item)}
          style={styles.actionBtn}
          activeOpacity={0.8}
          disabled={duplicating !== null}
          accessibilityRole="button"
          accessibilityLabel={`Duplicate ${item.label} as a new project`}
          testID={`design-version-duplicate-${item.id}`}
        >
          <Feather name="copy" size={14} color={ORANGE} />
          <Text style={[styles.actionText, { color: ORANGE }]}>Duplicate</Text>
        </TouchableOpacity>
      </View>
    </BrandthreadCard>
  );

  return (
    <View style={styles.root}>
      <ScreenHeader title="Version History" onBack={() => goBackOr(router)} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={PURPLE} />
        </View>
      ) : (
        <FlatList
          data={versions}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            projectId ? (
              <EmptyState
                icon="clock"
                title="No saved versions yet"
                description="In the canvas, open Modify → Actions → Share and tap Save version."
                action={{ label: 'Back to canvas', onPress: () => goBackOr(router) }}
                style={styles.emptyState}
                testID="design-versions-empty"
              />
            ) : (
              <EmptyState
                icon="clock"
                title="No design selected"
                description="Open a design in Design Studio to see its version history."
                action={{ label: 'Open Design Studio', onPress: () => router.replace('/design' as never) }}
                style={styles.emptyState}
                testID="design-versions-no-project"
              />
            )
          }
          ListFooterComponent={
            versions.length > 0 ? (
              <View style={styles.autosaveNote}>
                <Feather name="info" size={12} color={SUBTLE} />
                <Text style={styles.autosaveText}>
                  Versions are saved on this device. Restoring saves the current state as a version first.
                </Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT } = theme;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: SP.md, paddingBottom: 120 },
  emptyState: { marginTop: 60 },

  versionCard: { marginBottom: SP.sm },
  versionTop: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  versionInfo: { flex: 1, gap: 4 },
  versionLabel: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  versionDate: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  versionActions: { flexDirection: 'row', gap: SP.md },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { fontSize: FS.xs, fontFamily: FONT.semibold },

  autosaveNote: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    marginTop: SP.md, paddingHorizontal: SP.sm,
  },
  autosaveText: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  });
};
