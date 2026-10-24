import { Icon as Feather } from '@/components/ui/Icon';
/**
 * Design Versions — /design-versions?projectId=<id>
 *
 * Reached from the Design Studio canvas's Export sheet ("Version history").
 * Versions are snapshots saved on this device (designService createVersion);
 * the server keeps no per-version image, so Preview renders the snapshot's
 * own layers with the shared DesignLayerCompositor.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Modal, Pressable, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DesignLayerCompositor from '@/components/DesignLayerCompositor';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, SecondaryButton, EmptyState, StatusBadge,
} from '@/components/BrandthreadUI';
import { createVersion, getVersions, restoreVersion, duplicateVersion } from '@/services/designService';
import { ORANGE } from '@/lib/theme';
import { DesignVersion } from '@/services/designTypes';
import { ScreenHeader } from '@/components/ScreenHeader';
import { UnavailableScreen, isMissingParam } from '@/components/ui/UnavailableScreen';

const ACTION_HIT = { top: 13, bottom: 13, left: 8, right: 8 };
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
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const styles = createStyles(theme);
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  const [versions, setVersions]   = useState<DesignVersion[]>([]);
  const [loading, setLoading]     = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<DesignVersion | null>(null);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const loadVersions = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    getVersions(projectId)
      .then(v => setVersions([...v].sort((a, b) => b.createdAt.localeCompare(a.createdAt))))
      .catch(() => setVersions([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { void loadVersions(); }, [loadVersions]);

  const handlePreview = useCallback((version: DesignVersion) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPreviewing(version);
  }, []);

  const handleRestore = useCallback((version: DesignVersion) => {
    Alert.alert(
      'Restore Version',
      `Restore "${version.label}"? Your project will be replaced with this version.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: async () => {
            setRestoring(version.id);
            try {
              await createVersion(version.projectId, 'Before restore', true);
              const restored = await restoreVersion(version.id);
              Alert.alert('Version restored', 'Your project now matches this version.');
              router.replace(`/design-canvas?id=${restored.id}` as never);
            } catch {
              Alert.alert('Error', 'Failed to restore version. Please try again.');
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
          onPress={() => handlePreview(item)}
          style={styles.actionBtn}
          activeOpacity={0.8}
          hitSlop={ACTION_HIT}
          accessibilityRole="button"
          accessibilityLabel={`Preview ${item.label}`}
        >
          <Icon name="eye" size={14} color={CYAN} />
          <Text style={[styles.actionText, { color: CYAN }]}>Preview</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleRestore(item)}
          style={styles.actionBtn}
          activeOpacity={0.8}
          disabled={restoring === item.id}
          hitSlop={ACTION_HIT}
          accessibilityRole="button"
          accessibilityLabel={`Restore ${item.label}`}
        >
          <Icon name="rotate-ccw" size={14} color={PURPLE_LIGHT} />
          <Text style={[styles.actionText, { color: PURPLE_LIGHT }]}>Restore</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleDuplicate(item)}
          style={styles.actionBtn}
          activeOpacity={0.8}
          hitSlop={ACTION_HIT}
          accessibilityRole="button"
          accessibilityLabel={`Duplicate ${item.label}`}
        >
          <Icon name="copy" size={14} color={ORANGE} />
          <Text style={[styles.actionText, { color: ORANGE }]}>Duplicate</Text>
        </TouchableOpacity>
      </View>
    </BrandthreadCard>
  );

  // No project open (direct link / preview) → nothing to list or save.
  if (isMissingParam(projectId)) {
    return (
      <UnavailableScreen
        title="Version history"
        heading="No project open"
        message="Open a project to see its saved versions."
        icon="clock"
      />
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Version history" />

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
            <EmptyState
              icon="clock"
              title="No saved versions yet"
              description={projectId ? 'Saved versions of this project will appear here.' : 'Open a project to see its version history.'}
              action={{ label: projectId ? 'Back to project' : 'Go back', onPress: () => goBackOr(router) }}
              style={styles.emptyState}
            />
          }
          ListFooterComponent={
            versions.length > 0 ? (
              <View style={styles.autosaveNote}>
                <Icon name="info" size={12} color={SUBTLE} />
                <Text style={styles.autosaveText}>
                  A version is saved each time you tap Save in the editor. Versions are kept on this device.
                </Text>
              </View>
            ) : null
          }
        />
      )}

      {/* Version preview — renders the snapshot's own layers */}
      <Modal visible={!!previewing} transparent animationType="fade" onRequestClose={() => setPreviewing(null)}>
        <Pressable
          style={[styles.previewOverlay, { backgroundColor: `${theme.background}E6`, paddingBottom: insets.bottom + SP.md }]}
          onPress={() => setPreviewing(null)}
          accessibilityRole="button"
          accessibilityLabel="Close preview"
        >
          {previewing && (
            <View style={styles.previewInner}>
              <DesignLayerCompositor
                project={previewing.snapshot}
                displaySize={Math.min(windowWidth - SP.md * 2, 420)}
                borderRadius={RADIUS.md}
              />
              <Text style={styles.versionLabel}>{previewing.label}</Text>
              <Text style={styles.versionDate}>
                {formatDate(previewing.createdAt)} · {previewing.snapshot.layers?.length ?? 0} layer{(previewing.snapshot.layers?.length ?? 0) === 1 ? '' : 's'}
              </Text>
              <View style={styles.versionActions}>
                <TouchableOpacity onPress={() => { const v = previewing; setPreviewing(null); handleRestore(v); }} style={styles.actionBtn}>
                  <Feather name="rotate-ccw" size={14} color={PURPLE_LIGHT} />
                  <Text style={[styles.actionText, { color: PURPLE_LIGHT }]}>Restore as new project</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPreviewing(null)} style={styles.actionBtn}>
                  <Feather name="x" size={14} color={MUTED} />
                  <Text style={[styles.actionText, { color: MUTED }]}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Pressable>
      </Modal>
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

  previewOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.md },
  previewInner: { alignItems: 'center', gap: SP.sm },
  });
};
