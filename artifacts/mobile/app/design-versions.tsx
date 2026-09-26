/**
 * Design Versions — /design-versions
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, ORANGE,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, SecondaryButton, EmptyState, StatusBadge,
} from '@/components/BrandthreadUI';
import { getVersions, restoreVersion, duplicateProject } from '@/services/designService';
import { DesignVersion } from '@/services/designTypes';
import { Header } from '@/components/layout';

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
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const styles = createStyles(theme);
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  const [versions, setVersions]   = useState<DesignVersion[]>([]);
  const [loading, setLoading]     = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    getVersions(projectId).then(v => { setVersions(v); setLoading(false); });
  }, [projectId]);

  const handlePreview = useCallback((version: DesignVersion) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Version Preview', 'Version preview — open editor to compare versions side by side.');
  }, []);

  const handleRestore = useCallback((version: DesignVersion) => {
    Alert.alert(
      'Restore Version',
      `Restore "${version.label}"? This will create a new project from this version.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: async () => {
            setRestoring(version.id);
            try {
              const restored = await restoreVersion(version.id);
              if (restored) {
                Alert.alert('Version restored', 'A new project has been created from this version.');
                router.replace(`/design-canvas?id=${restored.id}` as never);
              } else {
                Alert.alert('Error', 'Failed to restore version.');
              }
            } finally {
              setRestoring(null);
            }
          },
        },
      ]
    );
  }, [router]);

  const handleDuplicate = useCallback(async (version: DesignVersion) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newProject = await duplicateProject(version.projectId);
    if (newProject) {
      router.push(`/design-canvas?id=${newProject.id}` as never);
    } else {
      Alert.alert('Error', 'Failed to duplicate project.');
    }
  }, [router]);

  const renderItem = ({ item }: { item: DesignVersion }) => (
    <BrandthreadCard style={styles.versionCard}>
      <View style={styles.versionTop}>
        <View style={styles.versionInfo}>
          {item.autoSaved && (
            <StatusBadge label="Auto-saved" variant="info" small />
          )}
          <Text style={styles.versionLabel}>{item.label}</Text>
          <Text style={styles.versionDate}>{formatDate(item.createdAt)}</Text>
        </View>
        {restoring === item.id && (
          <ActivityIndicator color={PURPLE} size="small" />
        )}
      </View>
      <View style={styles.versionActions}>
        <TouchableOpacity
          onPress={() => handlePreview(item)}
          style={styles.actionBtn}
          activeOpacity={0.8}
        >
          <Feather name="eye" size={14} color={CYAN} />
          <Text style={[styles.actionText, { color: CYAN }]}>Preview</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleRestore(item)}
          style={styles.actionBtn}
          activeOpacity={0.8}
          disabled={restoring === item.id}
        >
          <Feather name="rotate-ccw" size={14} color={PURPLE_LIGHT} />
          <Text style={[styles.actionText, { color: PURPLE_LIGHT }]}>Restore</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleDuplicate(item)}
          style={styles.actionBtn}
          activeOpacity={0.8}
        >
          <Feather name="copy" size={14} color={ORANGE} />
          <Text style={[styles.actionText, { color: ORANGE }]}>Duplicate</Text>
        </TouchableOpacity>
      </View>
    </BrandthreadCard>
  );

  return (
    <View style={styles.root}>
      <Header title="Version History" />

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
              description="Save your project to create a version."
              action={{ label: 'Save now', onPress: () => goBackOr(router) }}
              style={styles.emptyState}
            />
          }
          ListFooterComponent={
            versions.length > 0 ? (
              <View style={styles.autosaveNote}>
                <Feather name="info" size={12} color={SUBTLE} />
                <Text style={styles.autosaveText}>
                  Auto-saves are created every 30 seconds while editing.
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
  versionTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: SP.sm },
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
